from __future__ import annotations

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from app.core.config import ALLOWED_EXTENSIONS, DOCUMENT_PURPOSES
from app.db.session import db_session
from app.modules.audit.service import AUDITED_ACTIONS, delete_audit_logs_older_than, write_audit
from app.modules.documents.schemas import CategoryResponse, CreateFolderRequest, DocumentListResponse, FolderEntry, FolderResponse, MoveDocumentRequest
from app.modules.documents.service import (
    content_file_path,
    create_folder,
    create_document,
    delete_folder,
    find_duplicate_documents,
    get_document,
    list_knowledge,
    list_folder,
    list_documents,
    move_document,
    raw_file_path,
    soft_delete_document,
)
from app.modules.parse_jobs.service import create_batch_parse_jobs, create_parse_job


router = APIRouter(prefix="/api/v1", tags=["documents"])


@router.get("/categories", response_model=CategoryResponse)
def categories() -> CategoryResponse:
    return CategoryResponse(
        purposes=DOCUMENT_PURPOSES,
        formats=sorted(set(ALLOWED_EXTENSIONS.values())),
    )


@router.post("/documents")
def upload_document(
    request: Request,
    file: UploadFile = File(...),
    purpose: str = Form("业务知识"),
    folder_path: str = Form("/"),
    title: str | None = Form(None),
    source: str | None = Form(None),
    project: str | None = Form(None),
    uploader_name: str | None = Form(None),
    confidentiality: str = Form("internal"),
    overwrite: bool = Form(False),
):
    document_id = create_document(file, purpose, title, source, project, uploader_name, confidentiality, folder_path, overwrite)
    write_audit("overwrite_upload" if overwrite else "upload", document_id=document_id, actor=uploader_name, ip=request.client.host if request.client else None)
    return {"id": document_id, "status": "uploaded"}


@router.get("/documents", response_model=DocumentListResponse)
def documents(
    purpose: str | None = None,
    format: str | None = None,
    q: str | None = None,
    status: str | None = None,
    folder: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> DocumentListResponse:
    total, rows = list_documents(
        purpose=purpose,
        file_format=format,
        q=q,
        status=status,
        folder_path=folder,
        limit=limit,
        offset=offset,
    )
    return DocumentListResponse(total=total, documents=rows)


@router.get("/folders", response_model=FolderResponse)
def folder(path: str = "/", purpose: str | None = None) -> FolderResponse:
    return FolderResponse(**list_folder(path, purpose=purpose))


@router.get("/documents/duplicates")
def document_duplicates(purpose: str, folder: str, filename: str):
    return {"documents": find_duplicate_documents(purpose, folder, filename)}


@router.post("/folders", response_model=FolderEntry)
def create_folder_route(payload: CreateFolderRequest, request: Request) -> FolderEntry:
    folder_entry = create_folder(payload.purpose, payload.parent_path, payload.name)
    write_audit(
        "create_folder",
        ip=request.client.host if request.client else None,
        message=f"{payload.purpose}:{folder_entry['path']}",
    )
    return FolderEntry(**folder_entry)


@router.delete("/folders", response_model=FolderEntry)
def delete_folder_route(purpose: str, path: str, request: Request) -> FolderEntry:
    folder_entry = delete_folder(purpose, path)
    write_audit(
        "delete_folder",
        ip=request.client.host if request.client else None,
        message=f"{purpose}:{folder_entry['path']}",
    )
    return FolderEntry(**folder_entry)


@router.get("/documents/{document_id}")
def document_detail(document_id: str):
    doc = get_document(document_id)
    return doc


@router.get("/knowledge", response_model=DocumentListResponse)
def knowledge(q: str | None = None, folder: str | None = None, purpose: str | None = None) -> DocumentListResponse:
    total, rows = list_knowledge(q=q, folder_path=folder, purpose=purpose)
    return DocumentListResponse(total=total, documents=rows)


@router.get("/documents/{document_id}/raw")
def download_raw(document_id: str, request: Request):
    doc = get_document(document_id)
    return FileResponse(raw_file_path(document_id), filename=doc["original_filename"])


@router.get("/documents/{document_id}/content")
def document_content(document_id: str, format: str = "markdown"):
    if format != "markdown":
        return PlainTextResponse("Only markdown content is available in MVP.", status_code=400)
    return PlainTextResponse(content_file_path(document_id).read_text(encoding="utf-8"), media_type="text/markdown; charset=utf-8")


@router.post("/documents/{document_id}/reprocess")
def reprocess_document(document_id: str, request: Request):
    job = create_parse_job(document_id, requested_by="web")
    write_audit("create_parse_job", document_id=document_id, ip=request.client.host if request.client else None, message=job["id"])
    return {"id": document_id, "status": "queued", "job_id": job["id"]}


@router.patch("/documents/{document_id}/folder")
def move_document_route(document_id: str, payload: MoveDocumentRequest, request: Request):
    doc = move_document(document_id, payload.folder_path)
    write_audit(
        "move_document",
        document_id=document_id,
        ip=request.client.host if request.client else None,
        message=doc["folder_path"],
    )
    return doc


@router.post("/processing/run-unprocessed")
def process_unprocessed(request: Request):
    result = create_batch_parse_jobs(document_ids=None, purpose=None, limit=10000, include_failed=False, requested_by="web")
    if result["queued"]:
        write_audit("create_parse_jobs_batch", ip=request.client.host if request.client else None, message=f"queued={result['queued']}")
    return {"queued": result["queued"], "document_ids": result["document_ids"], "job_ids": result["job_ids"]}


@router.delete("/documents/{document_id}")
def delete_document(document_id: str):
    soft_delete_document(document_id)
    write_audit("delete", document_id=document_id)
    return {"id": document_id, "status": "deleted"}


@router.get("/audit-logs")
def audit_logs():
    with db_session() as conn:
        actions = sorted(AUDITED_ACTIONS)
        rows = conn.execute(
            f"""
            SELECT * FROM audit_logs
            WHERE action IN ({','.join('?' for _ in actions)})
            ORDER BY created_at DESC
            LIMIT 100
            """,
            actions,
        ).fetchall()
    return {"logs": [dict(row) for row in rows]}


@router.delete("/audit-logs/older-than")
def delete_old_audit_logs(days: int = 7):
    return delete_audit_logs_older_than(days)
