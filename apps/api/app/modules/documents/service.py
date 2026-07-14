from __future__ import annotations

import hashlib
import json
import mimetypes
import shutil
import zipfile
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


def create_markdown_knowledge(
    file: UploadFile | None,
    markdown: str | None,
    filename: str | None,
    purpose: str,
    title: str | None,
    source: str | None,
    project: str | None,
    uploader_name: str | None,
    confidentiality: str,
    folder_path: str | None,
    overwrite: bool = False,
) -> str:
    canonical_purpose = normalize_purpose(purpose)
    normalized_folder = ensure_purpose_folder_path(canonical_purpose, folder_path)
    upload_filename = safe_filename((file.filename if file else filename) or markdown_filename_from_title(title))
    ext = Path(upload_filename).suffix.lower()
    if ext not in {".md", ".markdown"}:
        raise HTTPException(status_code=400, detail="Markdown 知识只支持 .md 或 .markdown 文件。")

    duplicates = find_duplicate_documents(canonical_purpose, normalized_folder, upload_filename)
    if duplicates and not overwrite:
        raise HTTPException(status_code=409, detail=f"{upload_filename} 文件已经存在。")

    if file:
        content_bytes = read_upload_bytes(file)
        try:
            markdown_text = content_bytes.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=400, detail="Markdown 文件必须是 UTF-8 文本。") from exc
    else:
        markdown_text = (markdown or "").strip()
        if not markdown_text:
            raise HTTPException(status_code=400, detail="Markdown 正文不能为空。")
        content_bytes = markdown_text.encode("utf-8")
        if len(content_bytes) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"单文件不能超过 {settings.max_upload_mb}MB。")

    document_id = f"doc_{uuid4().hex}"
    now = utc_now()
    date_dir = datetime.now().strftime("%Y/%m")
    storage_dir = Path(settings.upload_dir) / date_dir / document_id
    storage_dir.mkdir(parents=True, exist_ok=True)
    storage_path = Path(date_dir) / document_id / upload_filename
    target_path = Path(settings.upload_dir) / storage_path
    target_path.write_bytes(content_bytes)

    output_dir = Path(settings.processed_dir) / document_id
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "content.md").write_text(markdown_text, encoding="utf-8")
    (output_dir / "content.txt").write_text(markdown_text, encoding="utf-8")
    (output_dir / "metadata.json").write_text(
        json.dumps(
            {
                "parser": "markdown-import",
                "source": "direct-markdown",
                "filename": upload_filename,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    display_title = (title or Path(upload_filename).stem).strip()
    file_format = "markdown"
    with db_session() as conn:
        insert_folder_paths(conn, canonical_purpose, normalized_folder)
        conn.execute(
            """
            INSERT INTO documents (
                id, title, original_filename, file_ext, file_format, mime_type, size_bytes,
                checksum_sha256, storage_path, folder_path, status, content_excerpt, search_text,
                error_message, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, NULL, ?, ?)
            """,
            (
                document_id,
                display_title,
                upload_filename,
                ext.lstrip("."),
                file_format,
                file.content_type if file else "text/markdown",
                len(content_bytes),
                checksum_file(target_path),
                str(storage_path),
                normalized_folder,
                markdown_text[:400],
                markdown_text[:20000],
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
        conn.execute(
            """
            INSERT INTO processed_artifacts (id, document_id, artifact_type, path, parser, parse_status, created_at)
            VALUES (?, ?, 'markdown', ?, 'markdown-import', 'ready', ?)
            """,
            (str(uuid4()), document_id, f"{document_id}/content.md", now),
        )
    if overwrite:
        for duplicate in duplicates:
            soft_delete_document(duplicate["id"])
    return document_id


def _safe_zip_member_path(name: str) -> Path:
    candidate = Path(name.replace("\\", "/"))
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise HTTPException(status_code=400, detail=f"压缩包包含不安全的文件路径：{name}")
    return candidate


def _zip_member_source_path(member: zipfile.ZipInfo) -> Path:
    name = member.filename
    if not member.flag_bits & 0x800:
        try:
            raw_name = name.encode("cp437")
        except UnicodeEncodeError:
            raw_name = None
        if raw_name is not None:
            for encoding in ("utf-8", "gb18030"):
                try:
                    name = raw_name.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
    return _safe_zip_member_path(name)


def _is_ignored_zip_metadata(path: Path) -> bool:
    return (
        "__MACOSX" in path.parts
        or path.name.startswith("._")
        or path.name in {".DS_Store", "Thumbs.db", "desktop.ini"}
    )


def _read_markdown_text(path: Path, display_name: str) -> str:
    content = path.read_bytes()
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=400, detail=f"无法识别 Markdown 编码：{display_name}。请使用 UTF-8 或 GBK/GB18030。")


def _short_storage_segment(segment: str, max_bytes: int = 180) -> str:
    if len(segment.encode("utf-8")) <= max_bytes:
        return segment
    suffix = Path(segment).suffix
    if len(suffix.encode("utf-8")) > 32:
        suffix = ""
    digest = hashlib.sha256(segment.encode("utf-8")).hexdigest()[:16]
    remaining = max_bytes - len(suffix.encode("utf-8")) - len(digest) - 1
    shortened = ""
    for char in Path(segment).stem:
        if len((shortened + char).encode("utf-8")) > remaining:
            break
        shortened += char
    return f"{shortened or 'asset'}-{digest}{suffix}"


def _storage_zip_member_path(member_path: Path) -> Path:
    return Path(*(_short_storage_segment(part) for part in member_path.parts))


def _markdown_image_references(markdown: str) -> list[str]:
    import re

    references: list[str] = []
    for matched in re.finditer(r"!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)", markdown):
        value = (matched.group(1) or matched.group(2) or "").strip()
        if value and value not in references:
            references.append(value)
    return references


def _bundle_asset_target(
    bundle_dir: Path,
    markdown_relative_path: Path,
    reference: str,
    source_to_storage_paths: dict[str, Path],
) -> Path | None:
    if reference.startswith(("http://", "https://", "data:", "/")):
        return None
    relative = Path(reference.split("?", 1)[0].split("#", 1)[0].replace("\\", "/"))
    parts: list[str] = []
    for part in [*markdown_relative_path.parent.parts, *relative.parts]:
        if part in {"", "."}:
            continue
        if part == "..":
            if not parts:
                return None
            parts.pop()
            continue
        parts.append(part)
    source_target = Path(*parts)
    storage_target = source_to_storage_paths.get(source_target.as_posix())
    if not storage_target:
        return None
    target = (bundle_dir / storage_target).resolve()
    if bundle_dir.resolve() not in target.parents and target != bundle_dir.resolve():
        return None
    return target


def create_markdown_bundle(
    file: UploadFile,
    purpose: str,
    folder_path: str | None,
    source: str | None,
    project: str | None,
    uploader_name: str | None,
    confidentiality: str,
) -> dict:
    filename = safe_filename(file.filename or "markdown-bundle.zip")
    if Path(filename).suffix.lower() != ".zip":
        raise HTTPException(status_code=400, detail="Markdown 文档包请上传 .zip 文件。")
    content = read_upload_bytes(file)
    canonical_purpose = normalize_purpose(purpose)
    normalized_folder = ensure_purpose_folder_path(canonical_purpose, folder_path)
    bundle_id = f"bundle_{uuid4().hex}"
    bundle_relative_dir = Path("bundles") / bundle_id
    bundle_dir = Path(settings.upload_dir) / bundle_relative_dir
    bundle_dir.mkdir(parents=True, exist_ok=True)
    archive_path = Path(settings.tmp_dir) / f"{bundle_id}.zip"
    archive_path.write_bytes(content)

    try:
        with zipfile.ZipFile(archive_path) as archive:
            member_paths = [
                (member, _zip_member_source_path(member))
                for member in archive.infolist()
                if not member.is_dir()
            ]
            member_paths = [(member, path) for member, path in member_paths if not _is_ignored_zip_metadata(path)]
            if not member_paths:
                raise HTTPException(status_code=400, detail="压缩包中没有文件。")
            total_uncompressed = sum(member.file_size for member, _ in member_paths)
            max_uncompressed = settings.max_upload_mb * 1024 * 1024 * 8
            if total_uncompressed > max_uncompressed:
                raise HTTPException(status_code=400, detail="压缩包解压后的体积过大，请按模块拆分上传。")
            source_to_storage_paths = {
                source_path.as_posix(): _storage_zip_member_path(source_path) for _, source_path in member_paths
            }
            for member, source_path in member_paths:
                target = bundle_dir / source_to_storage_paths[source_path.as_posix()]
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source_handle, target.open("wb") as target_handle:
                    shutil.copyfileobj(source_handle, target_handle)
    except zipfile.BadZipFile as exc:
        shutil.rmtree(bundle_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="上传文件不是有效的 ZIP 文档包。") from exc
    except OSError as exc:
        shutil.rmtree(bundle_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"无法解压 ZIP 文档包：{exc}") from exc
    finally:
        archive_path.unlink(missing_ok=True)

    markdown_paths = sorted(
        (
            (bundle_dir / source_to_storage_paths[source_path.as_posix()], source_path)
            for _, source_path in member_paths
            if source_path.suffix.lower() in {".md", ".markdown"}
        ),
        key=lambda item: item[1].as_posix(),
    )
    if not markdown_paths:
        shutil.rmtree(bundle_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="压缩包中没有 .md 或 .markdown 文件。")

    relative_markdown_paths = [source_path for _, source_path in markdown_paths]
    top_level_parts = {path.parts[0] for path in relative_markdown_paths if len(path.parts) > 1}
    import_folder = normalized_folder
    if len(top_level_parts) == 1 and all(len(path.parts) > 1 for path in relative_markdown_paths):
        root_name = next(iter(top_level_parts))
        if normalized_folder.rstrip("/").rsplit("/", 1)[-1] != root_name:
            import_folder = ensure_purpose_folder_path(canonical_purpose, f"{normalized_folder}/{root_name}")

    now = utc_now()
    document_ids: list[str] = []
    image_references = 0
    missing_references: list[dict[str, str]] = []
    with db_session() as conn:
        insert_folder_paths(conn, canonical_purpose, import_folder)
        for markdown_path, source_markdown_path in markdown_paths:
            markdown_text = _read_markdown_text(markdown_path, source_markdown_path.name)
            markdown_path.write_text(markdown_text, encoding="utf-8")
            document_id = f"doc_{uuid4().hex}"
            storage_markdown_path = source_to_storage_paths[source_markdown_path.as_posix()]
            storage_path = bundle_relative_dir / storage_markdown_path
            conn.execute(
                """
                INSERT INTO documents (
                    id, title, original_filename, file_ext, file_format, mime_type, size_bytes,
                    checksum_sha256, storage_path, source_kind, bundle_id, folder_path, status, created_at, updated_at
                ) VALUES (?, ?, ?, 'md', 'markdown', 'text/markdown', ?, ?, ?, 'markdown_bundle', ?, ?, 'uploaded', ?, ?)
                """,
                (
                    document_id,
                    source_markdown_path.stem,
                    source_markdown_path.name,
                    markdown_path.stat().st_size,
                    checksum_file(markdown_path),
                    str(storage_path),
                    bundle_id,
                    import_folder,
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO document_metadata (document_id, purpose, source, project, confidentiality, uploader_name)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (document_id, canonical_purpose, source, project, confidentiality or "internal", uploader_name),
            )
            for reference in _markdown_image_references(markdown_text):
                image_references += 1
                target = _bundle_asset_target(bundle_dir, source_markdown_path, reference, source_to_storage_paths)
                exists = target is not None and target.is_file()
                asset_relative = str(target.relative_to(bundle_dir.resolve())) if exists and target else None
                conn.execute(
                    """
                    INSERT INTO markdown_bundle_assets (
                        id, document_id, source_ref, asset_path, asset_sha256, mime_type, is_missing, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"asset_{uuid4().hex}",
                        document_id,
                        reference,
                        asset_relative,
                        checksum_file(target) if exists and target else None,
                        mimetypes.guess_type(str(target))[0] if exists and target else None,
                        0 if exists else 1,
                        now,
                    ),
                )
                if not exists:
                    missing_references.append({"document": str(source_markdown_path), "reference": reference})
            document_ids.append(document_id)
    return {
        "bundle_id": bundle_id,
        "document_ids": document_ids,
        "documents": len(document_ids),
        "image_references": image_references,
        "missing_references": missing_references,
        "folder_path": import_folder,
    }


def read_upload_bytes(file: UploadFile) -> bytes:
    max_bytes = settings.max_upload_mb * 1024 * 1024
    content = file.file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"单文件不能超过 {settings.max_upload_mb}MB。")
    return content


def safe_filename(filename: str) -> str:
    clean_name = Path(filename.replace("\\", "/")).name.strip()
    if not clean_name or clean_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="文件名不能为空。")
    return clean_name


def markdown_filename_from_title(title: str | None) -> str:
    clean_title = (title or "未命名知识").strip().replace("\\", "_").replace("/", "_")
    stem = Path(clean_title or "未命名知识").stem
    return f"{stem or '未命名知识'}.md"


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
    keys = row.keys()
    return {
        "id": row["id"],
        "title": row["title"],
        "original_filename": row["original_filename"],
        "file_format": row["file_format"],
        "file_ext": row["file_ext"],
        "source_kind": row["source_kind"] if "source_kind" in keys else "file",
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
        "wiki_compiled": bool(row["wiki_compiled"]) if "wiki_compiled" in keys else False,
        "wiki_updated_at": row["wiki_updated_at"] if "wiki_updated_at" in keys else None,
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
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality,
                   CASE WHEN w.id IS NOT NULL AND w.updated_at >= d.updated_at AND w.compile_method = 'smart' THEN 1 ELSE 0 END AS wiki_compiled,
                   w.updated_at AS wiki_updated_at
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            LEFT JOIN wiki_pages w ON w.source_document_id = d.id AND w.page_type = 'document_summary'
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
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality,
                   CASE WHEN w.id IS NOT NULL AND w.updated_at >= d.updated_at AND w.compile_method = 'smart' THEN 1 ELSE 0 END AS wiki_compiled,
                   w.updated_at AS wiki_updated_at
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            LEFT JOIN wiki_pages w ON w.source_document_id = d.id AND w.page_type = 'document_summary'
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


def list_knowledge(
    q: str | None = None,
    folder_path: str | None = None,
    purpose: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> tuple[int, list[dict]]:
    filters = ["d.status = 'ready'"]
    params: list[str] = []
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)
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
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality,
                   CASE WHEN w.id IS NOT NULL AND w.updated_at >= d.updated_at AND w.compile_method = 'smart' THEN 1 ELSE 0 END AS wiki_compiled,
                   w.updated_at AS wiki_updated_at
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            LEFT JOIN wiki_pages w ON w.source_document_id = d.id AND w.page_type = 'document_summary'
            WHERE {where_clause}
            ORDER BY d.updated_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        ).fetchall()
    return total, [row_to_summary(row) for row in rows]


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


def markdown_bundle_manifest(document_id: str) -> dict:
    doc = get_document(document_id)
    if doc.get("source_kind") != "markdown_bundle":
        raise HTTPException(status_code=400, detail="该文件不是 Markdown 文档包。")
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT id, source_ref, asset_path, asset_sha256, mime_type, is_missing
            FROM markdown_bundle_assets WHERE document_id = ? ORDER BY source_ref ASC
            """,
            (document_id,),
        ).fetchall()
    return {
        "document_id": document_id,
        "source_kind": "markdown_bundle",
        "markdown_url": f"/api/v1/documents/{document_id}/raw",
        "assets": [
            {
                "id": row["id"],
                "source_ref": row["source_ref"],
                "sha256": row["asset_sha256"],
                "mime_type": row["mime_type"],
                "status": "missing" if row["is_missing"] else "ready",
                "asset_url": None if row["is_missing"] else f"/api/v1/documents/{document_id}/assets/{row['id']}",
            }
            for row in rows
        ],
    }


def markdown_bundle_asset_path(document_id: str, asset_id: str) -> Path:
    doc = get_document(document_id)
    if doc.get("source_kind") != "markdown_bundle":
        raise HTTPException(status_code=404, detail="图片资源不存在。")
    with db_session() as conn:
        row = conn.execute(
            "SELECT asset_path, is_missing FROM markdown_bundle_assets WHERE id = ? AND document_id = ?",
            (asset_id, document_id),
        ).fetchone()
    if not row or row["is_missing"] or not row["asset_path"]:
        raise HTTPException(status_code=404, detail="图片资源不存在。")
    bundle_path = Path(settings.upload_dir) / "bundles" / str(doc["bundle_id"])
    target = (bundle_path / row["asset_path"]).resolve()
    if bundle_path.resolve() not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="图片资源不存在。")
    return target


def soft_delete_document(document_id: str) -> None:
    doc = get_document(document_id)
    raw_path = Path(settings.upload_dir) / doc["storage_path"]
    processed_path = Path(settings.processed_dir) / document_id

    if doc.get("source_kind") != "markdown_bundle":
        if raw_path.parent.exists():
            shutil.rmtree(raw_path.parent, ignore_errors=True)
        elif raw_path.exists():
            raw_path.unlink(missing_ok=True)
    shutil.rmtree(processed_path, ignore_errors=True)

    now = utc_now()
    with db_session() as conn:
        conn.execute("DELETE FROM processed_artifacts WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM parse_jobs WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM markdown_bundle_assets WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM conversion_jobs WHERE document_id = ?", (document_id,))
        conn.execute("DELETE FROM wiki_pages WHERE source_document_id = ?", (document_id,))
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
        if doc.get("source_kind") == "markdown_bundle" and doc.get("bundle_id"):
            remaining = conn.execute(
                "SELECT COUNT(*) AS count FROM documents WHERE bundle_id = ? AND status != 'deleted'",
                (doc["bundle_id"],),
            ).fetchone()["count"]
            if not remaining:
                shutil.rmtree(Path(settings.upload_dir) / "bundles" / doc["bundle_id"], ignore_errors=True)
