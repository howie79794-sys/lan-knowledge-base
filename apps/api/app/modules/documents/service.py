from __future__ import annotations

import hashlib
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.core.config import ALLOWED_EXTENSIONS, DOCUMENT_PURPOSES, PURPOSE_ALIASES, settings
from app.db.session import db_session


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def checksum_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_upload(file: UploadFile, purpose: str) -> tuple[str, str, str]:
    filename = file.filename or "unnamed"
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"暂不支持 {ext or '无后缀'} 文件。")
    if purpose not in DOCUMENT_PURPOSES:
        raise HTTPException(status_code=400, detail="文件作用分类不在允许范围内。")
    return filename, ext, ALLOWED_EXTENSIONS[ext]


def normalize_folder_path(folder_path: str | None) -> str:
    value = (folder_path or "/").strip().replace("\\", "/")
    if not value:
        return "/"
    parts = [part.strip() for part in value.split("/") if part.strip()]
    if any(part in {".", ".."} for part in parts):
        raise HTTPException(status_code=400, detail="文件夹路径不能包含 . 或 ..。")
    if not parts:
        return "/"
    return "/" + "/".join(parts)


def normalize_purpose(purpose: str) -> str:
    display = display_purpose(purpose)
    if display not in DOCUMENT_PURPOSES:
        raise HTTPException(status_code=400, detail="文件作用分类不在允许范围内。")
    return display


def ensure_purpose_folder_path(purpose: str, folder_path: str | None) -> str:
    canonical_purpose = normalize_purpose(purpose)
    normalized = normalize_folder_path(folder_path)
    root = f"/{canonical_purpose}"
    if normalized == "/":
        return root
    root_prefix = f"{root}/"
    if normalized == root or normalized.startswith(root_prefix):
        return normalized
    first_part = normalized.strip("/").split("/", 1)[0]
    if first_part in DOCUMENT_PURPOSES:
        return root
    relative = normalized.strip("/")
    return f"{root}/{relative}" if relative else root


def insert_folder_paths(conn, purpose: str, folder_path: str) -> None:
    canonical_purpose = normalize_purpose(purpose)
    normalized = ensure_purpose_folder_path(canonical_purpose, folder_path)
    now = utc_now()
    parts = normalized.strip("/").split("/")
    for index in range(1, len(parts) + 1):
        path = "/" + "/".join(parts[:index])
        conn.execute(
            """
            INSERT OR IGNORE INTO document_folders (id, purpose, path, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (f"fld_{uuid4().hex}", canonical_purpose, path, now),
        )


def create_folder(purpose: str, parent_path: str | None, name: str) -> dict:
    canonical_purpose = normalize_purpose(purpose)
    clean_name = name.strip().replace("\\", "/").strip("/")
    if not clean_name:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空。")
    if "/" in clean_name or clean_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="文件夹名称不能包含 /、. 或 ..。")
    if len(clean_name) > 80:
        raise HTTPException(status_code=400, detail="文件夹名称不能超过 80 个字符。")

    parent = ensure_purpose_folder_path(canonical_purpose, parent_path)
    path = normalize_folder_path(f"{parent}/{clean_name}")
    with db_session() as conn:
        insert_folder_paths(conn, canonical_purpose, path)
    return {"name": clean_name, "path": path}


def delete_folder(purpose: str, folder_path: str) -> dict:
    canonical_purpose = normalize_purpose(purpose)
    path = ensure_purpose_folder_path(canonical_purpose, folder_path)
    root = f"/{canonical_purpose}"
    if path == root:
        raise HTTPException(status_code=400, detail="不能删除左侧固定二级目录。")
    prefix = f"{path}/"
    with db_session() as conn:
        folder = conn.execute(
            "SELECT * FROM document_folders WHERE purpose = ? AND path = ?",
            (canonical_purpose, path),
        ).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="文件夹不存在，或不是自定义文件夹。")

        document_count = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE d.status != 'deleted'
              AND m.purpose IN ({})
              AND (d.folder_path = ? OR d.folder_path LIKE ?)
            """.format(",".join("?" for _ in purpose_filter_values(canonical_purpose))),
            [*purpose_filter_values(canonical_purpose), path, f"{prefix}%"],
        ).fetchone()["count"]
        if document_count:
            raise HTTPException(status_code=400, detail="文件夹内还有文件，不能删除。")

        child_count = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM document_folders
            WHERE purpose = ? AND path LIKE ?
            """,
            (canonical_purpose, f"{prefix}%"),
        ).fetchone()["count"]
        if child_count:
            raise HTTPException(status_code=400, detail="文件夹内还有下级文件夹，不能删除。")

        conn.execute(
            "DELETE FROM document_folders WHERE purpose = ? AND path = ?",
            (canonical_purpose, path),
        )
    return {"name": path.rsplit("/", 1)[-1], "path": path}


def purpose_filter_values(purpose: str) -> list[str]:
    values = [purpose]
    values.extend(old for old, new in PURPOSE_ALIASES.items() if new == purpose)
    return values


def display_purpose(purpose: str) -> str:
    return PURPOSE_ALIASES.get(purpose, purpose)


def create_document(
    file: UploadFile,
    purpose: str,
    title: str | None,
    source: str | None,
    project: str | None,
    uploader_name: str | None,
    confidentiality: str,
    folder_path: str | None,
    overwrite: bool = False,
) -> str:
    filename, ext, file_format = normalize_upload(file, purpose)
    canonical_purpose = normalize_purpose(purpose)
    normalized_folder = ensure_purpose_folder_path(canonical_purpose, folder_path)
    duplicates = find_duplicate_documents(canonical_purpose, normalized_folder, filename)
    if duplicates and not overwrite:
        raise HTTPException(status_code=409, detail=f"{filename} 文件已经存在。")

    document_id = f"doc_{uuid4().hex}"
    now = utc_now()
    date_dir = datetime.now().strftime("%Y/%m")
    storage_dir = Path(settings.upload_dir) / date_dir / document_id
    storage_dir.mkdir(parents=True, exist_ok=True)
    storage_path = Path(date_dir) / document_id / filename
    target_path = Path(settings.upload_dir) / storage_path

    max_bytes = settings.max_upload_mb * 1024 * 1024
    written = 0
    with target_path.open("wb") as handle:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                handle.close()
                target_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=f"单文件不能超过 {settings.max_upload_mb}MB。")
            handle.write(chunk)

    checksum = checksum_file(target_path)
    display_title = (title or Path(filename).stem).strip()
    with db_session() as conn:
        insert_folder_paths(conn, canonical_purpose, normalized_folder)
        conn.execute(
            """
            INSERT INTO documents (
                id, title, original_filename, file_ext, file_format, mime_type, size_bytes,
                checksum_sha256, storage_path, folder_path, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)
            """,
            (
                document_id,
                display_title,
                filename,
                ext.lstrip("."),
                file_format,
                file.content_type,
                written,
                checksum,
                str(storage_path),
                normalized_folder,
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO document_metadata (
                document_id, purpose, source, project, confidentiality, uploader_name
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (document_id, canonical_purpose, source, project, confidentiality or "internal", uploader_name),
        )
    if overwrite:
        for duplicate in duplicates:
            soft_delete_document(duplicate["id"])
    return document_id


def find_duplicate_documents(purpose: str, folder_path: str | None, original_filename: str) -> list[dict]:
    canonical_purpose = normalize_purpose(purpose)
    normalized_folder = ensure_purpose_folder_path(canonical_purpose, folder_path)
    filename = (original_filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="文件名不能为空。")
    values = purpose_filter_values(canonical_purpose)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE d.status != 'deleted'
              AND d.folder_path = ?
              AND d.original_filename = ?
              AND m.purpose IN ({','.join('?' for _ in values)})
            ORDER BY d.updated_at DESC
            """,
            [normalized_folder, filename, *values],
        ).fetchall()
    return [row_to_summary(row) for row in rows]


def row_to_summary(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "original_filename": row["original_filename"],
        "file_format": row["file_format"],
        "file_ext": row["file_ext"],
        "folder_path": row["folder_path"],
        "size_bytes": row["size_bytes"],
        "status": row["status"],
        "purpose": display_purpose(row["purpose"]),
        "uploader_name": row["uploader_name"],
        "confidentiality": row["confidentiality"],
        "content_excerpt": row["content_excerpt"],
        "error_message": row["error_message"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_documents(
    purpose: str | None,
    file_format: str | None,
    q: str | None,
    status: str | None,
    folder_path: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> tuple[int, list[dict]]:
    filters = ["d.status != 'deleted'"]
    params: list[str] = []
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)
    if folder_path is not None:
        filters.append("d.folder_path = ?")
        params.append(normalize_folder_path(folder_path))
    if purpose:
        values = purpose_filter_values(purpose)
        filters.append(f"m.purpose IN ({','.join('?' for _ in values)})")
        params.extend(values)
    if file_format:
        filters.append("d.file_format = ?")
        params.append(file_format)
    if status:
        filters.append("d.status = ?")
        params.append(status)
    if q:
        filters.append("(d.title LIKE ? OR d.original_filename LIKE ? OR d.search_text LIKE ?)")
        needle = f"%{q}%"
        params.extend([needle, needle, needle])
    where_clause = " AND ".join(filters)
    with db_session() as conn:
        total = conn.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE {where_clause}
            """,
            params,
        ).fetchone()["count"]
        rows = conn.execute(
            f"""
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE {where_clause}
            ORDER BY d.updated_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        ).fetchall()
    return total, [row_to_summary(row) for row in rows]


def list_folder(folder_path: str | None, purpose: str | None = None) -> dict:
    current = ensure_purpose_folder_path(purpose, folder_path) if purpose else normalize_folder_path(folder_path)
    prefix = "/" if current == "/" else f"{current}/"
    canonical_purpose = normalize_purpose(purpose) if purpose else None
    with db_session() as conn:
        folder_params: list[str] = []
        folder_filters: list[str] = []
        if canonical_purpose:
            folder_filters.append("purpose = ?")
            folder_params.append(canonical_purpose)
        folder_where = f"WHERE {' AND '.join(folder_filters)}" if folder_filters else ""
        folder_rows = conn.execute(
            f"""
            SELECT path AS folder_path FROM document_folders
            {folder_where}
            UNION
            SELECT DISTINCT d.folder_path AS folder_path
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE d.status != 'deleted'
            {f"AND m.purpose IN ({','.join('?' for _ in purpose_filter_values(canonical_purpose))})" if canonical_purpose else ""}
            ORDER BY folder_path ASC
            """,
            [*folder_params, *(purpose_filter_values(canonical_purpose) if canonical_purpose else [])],
        ).fetchall()
        doc_params: list[str] = [current]
        purpose_clause = ""
        if canonical_purpose:
            values = purpose_filter_values(canonical_purpose)
            purpose_clause = f"AND m.purpose IN ({','.join('?' for _ in values)})"
            doc_params.extend(values)
        doc_rows = conn.execute(
            f"""
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE d.status != 'deleted' AND d.folder_path = ?
            {purpose_clause}
            ORDER BY d.updated_at DESC
            """,
            doc_params,
        ).fetchall()

    child_folders: dict[str, str] = {}
    root_path = f"/{canonical_purpose}" if canonical_purpose else None
    for row in folder_rows:
        path = row["folder_path"]
        if path == current or not path.startswith(prefix):
            continue
        rest = path[len(prefix) :]
        child = rest.split("/", 1)[0]
        if current == root_path and child in DOCUMENT_PURPOSES and child != canonical_purpose:
            continue
        child_path = f"/{child}" if current == "/" else f"{current}/{child}"
        child_folders[child] = child_path

    parent = None
    if current != "/":
        parent_parts = current.strip("/").split("/")[:-1]
        parent = "/" + "/".join(parent_parts) if parent_parts else "/"

    return {
        "path": current,
        "parent": parent,
        "folders": [{"name": name, "path": path} for name, path in sorted(child_folders.items())],
        "documents": [row_to_summary(row) for row in doc_rows],
    }


def move_document(document_id: str, folder_path: str) -> dict:
    doc = get_document(document_id)
    purpose = normalize_purpose(doc["purpose"])
    target_path = ensure_purpose_folder_path(purpose, folder_path)
    now = utc_now()
    with db_session() as conn:
        insert_folder_paths(conn, purpose, target_path)
        conn.execute(
            "UPDATE documents SET folder_path = ?, updated_at = ? WHERE id = ?",
            (target_path, now, document_id),
        )
    return get_document(document_id)


def unprocessed_document_ids() -> list[str]:
    with db_session() as conn:
        rows = conn.execute(
            "SELECT id FROM documents WHERE status = 'uploaded' ORDER BY created_at ASC"
        ).fetchall()
    return [row["id"] for row in rows]


def list_knowledge(q: str | None = None, folder_path: str | None = None, purpose: str | None = None) -> tuple[int, list[dict]]:
    filters = ["d.status = 'ready'"]
    params: list[str] = []
    if folder_path:
        filters.append("d.folder_path = ?")
        params.append(normalize_folder_path(folder_path))
    if purpose:
        values = purpose_filter_values(purpose)
        filters.append(f"m.purpose IN ({','.join('?' for _ in values)})")
        params.extend(values)
    if q:
        filters.append("(d.title LIKE ? OR d.original_filename LIKE ? OR d.search_text LIKE ?)")
        needle = f"%{q}%"
        params.extend([needle, needle, needle])
    where_clause = " AND ".join(filters)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE {where_clause}
            ORDER BY d.updated_at DESC
            """,
            params,
        ).fetchall()
    return len(rows), [row_to_summary(row) for row in rows]


def get_document(document_id: str) -> dict:
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT d.*, m.purpose, m.source, m.project, m.uploader_name, m.confidentiality
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE d.id = ? AND d.status != 'deleted'
            """,
            (document_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="文件不存在。")
    result = dict(row)
    result["purpose"] = display_purpose(result["purpose"])
    return result


def raw_file_path(document_id: str) -> Path:
    doc = get_document(document_id)
    path = Path(settings.upload_dir) / doc["storage_path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="原文件不存在。")
    return path


def content_file_path(document_id: str) -> Path:
    path = Path(settings.processed_dir) / document_id / "content.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="清洗内容还没有生成。")
    return path


def soft_delete_document(document_id: str) -> None:
    doc = get_document(document_id)
    raw_path = Path(settings.upload_dir) / doc["storage_path"]
    processed_path = Path(settings.processed_dir) / document_id

    if raw_path.parent.exists():
        shutil.rmtree(raw_path.parent, ignore_errors=True)
    elif raw_path.exists():
        raw_path.unlink(missing_ok=True)
    shutil.rmtree(processed_path, ignore_errors=True)

    now = utc_now()
    with db_session() as conn:
        conn.execute("DELETE FROM processed_artifacts WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM parse_jobs WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM conversion_jobs WHERE document_id = ?", (document_id,))
        conn.execute(
            """
            UPDATE documents
            SET status = 'deleted',
                content_excerpt = NULL,
                search_text = NULL,
                error_message = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (now, document_id),
        )
