from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.core.config import ALLOWED_EXTENSIONS, DOCUMENT_PURPOSES, settings
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


def create_document(
    file: UploadFile,
    purpose: str,
    title: str | None,
    source: str | None,
    project: str | None,
    uploader_name: str | None,
    confidentiality: str,
    folder_path: str | None,
) -> str:
    filename, ext, file_format = normalize_upload(file, purpose)
    normalized_folder = normalize_folder_path(folder_path)
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
            (document_id, purpose, source, project, confidentiality or "internal", uploader_name),
        )
    return document_id


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
        "purpose": row["purpose"],
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
) -> tuple[int, list[dict]]:
    filters = ["d.status != 'deleted'"]
    params: list[str] = []
    if folder_path is not None:
        filters.append("d.folder_path = ?")
        params.append(normalize_folder_path(folder_path))
    if purpose:
        filters.append("m.purpose = ?")
        params.append(purpose)
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


def list_folder(folder_path: str | None) -> dict:
    current = normalize_folder_path(folder_path)
    prefix = "/" if current == "/" else f"{current}/"
    with db_session() as conn:
        folder_rows = conn.execute(
            "SELECT DISTINCT folder_path FROM documents WHERE status != 'deleted' ORDER BY folder_path ASC"
        ).fetchall()
        doc_rows = conn.execute(
            """
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE d.status != 'deleted' AND d.folder_path = ?
            ORDER BY d.updated_at DESC
            """,
            (current,),
        ).fetchall()

    child_folders: dict[str, str] = {}
    for row in folder_rows:
        path = row["folder_path"]
        if path == current or not path.startswith(prefix):
            continue
        rest = path[len(prefix) :]
        child = rest.split("/", 1)[0]
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


def unprocessed_document_ids() -> list[str]:
    with db_session() as conn:
        rows = conn.execute(
            "SELECT id FROM documents WHERE status = 'uploaded' ORDER BY created_at ASC"
        ).fetchall()
    return [row["id"] for row in rows]


def list_knowledge(q: str | None = None, folder_path: str | None = None) -> tuple[int, list[dict]]:
    filters = ["d.status = 'ready'"]
    params: list[str] = []
    if folder_path:
        filters.append("d.folder_path = ?")
        params.append(normalize_folder_path(folder_path))
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
    return dict(row)


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
    get_document(document_id)
    with db_session() as conn:
        conn.execute("UPDATE documents SET status = 'deleted', updated_at = ? WHERE id = ?", (utc_now(), document_id))
