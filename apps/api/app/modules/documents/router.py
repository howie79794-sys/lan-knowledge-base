from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from app.core.config import ALLOWED_EXTENSIONS, DOCUMENT_PURPOSES
from app.db.session import db_session
from app.modules.audit.service import write_audit
from app.modules.documents.schemas import CategoryResponse, DocumentListResponse
from app.modules.documents.service import (
    content_file_path,
    create_document,
    get_document,
    list_documents,
    raw_file_path,
    soft_delete_document,
)
from app.workers.conversion_worker import process_document


router = APIRouter(prefix="/api/v1", tags=["documents"])


@router.get("/categories", response_model=CategoryResponse)
def categories() -> CategoryResponse:
    return CategoryResponse(
        purposes=DOCUMENT_PURPOSES,
        formats=sorted(set(ALLOWED_EXTENSIONS.values())),
    )


@router.post("/documents")
def upload_document(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...),
    purpose: str = Form(...),
    title: str | None = Form(None),
    source: str | None = Form(None),
    project: str | None = Form(None),
    uploader_name: str | None = Form(None),
    confidentiality: str = Form("internal"),
):
    document_id = create_document(file, purpose, title, source, project, uploader_name, confidentiality)
    write_audit("upload", document_id=document_id, actor=uploader_name, ip=request.client.host if request.client else None)
    background_tasks.add_task(process_document, document_id)
    return {"id": document_id, "status": "uploaded"}


@router.get("/documents", response_model=DocumentListResponse)
def documents(purpose: str | None = None, format: str | None = None, q: str | None = None, status: str | None = None) -> DocumentListResponse:
    total, rows = list_documents(purpose=purpose, file_format=format, q=q, status=status)
    return DocumentListResponse(total=total, documents=rows)


@router.get("/documents/{document_id}")
def document_detail(document_id: str):
    doc = get_document(document_id)
    return doc


@router.get("/documents/{document_id}/raw")
def download_raw(document_id: str, request: Request):
    doc = get_document(document_id)
    write_audit("download", document_id=document_id, ip=request.client.host if request.client else None)
    return FileResponse(raw_file_path(document_id), filename=doc["original_filename"])


@router.get("/documents/{document_id}/content")
def document_content(document_id: str, format: str = "markdown"):
    if format != "markdown":
        return PlainTextResponse("Only markdown content is available in MVP.", status_code=400)
    return PlainTextResponse(content_file_path(document_id).read_text(encoding="utf-8"), media_type="text/markdown; charset=utf-8")


@router.post("/documents/{document_id}/reprocess")
def reprocess_document(document_id: str, background_tasks: BackgroundTasks):
    get_document(document_id)
    background_tasks.add_task(process_document, document_id)
    write_audit("reprocess", document_id=document_id)
    return {"id": document_id, "status": "queued"}


@router.delete("/documents/{document_id}")
def delete_document(document_id: str):
    soft_delete_document(document_id)
    write_audit("delete", document_id=document_id)
    return {"id": document_id, "status": "deleted"}


@router.get("/audit-logs")
def audit_logs():
    with db_session() as conn:
        rows = conn.execute("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100").fetchall()
    return {"logs": [dict(row) for row in rows]}
