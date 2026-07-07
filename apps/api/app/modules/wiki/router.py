from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.config import settings
from app.modules.audit.service import write_audit
from app.modules.wiki.service import (
    claim_next_smart_compile_jobs,
    claim_selected_smart_compile_jobs,
    compile_wiki,
    complete_smart_compile_job,
    create_smart_compile_jobs,
    fail_smart_compile_job,
    get_wiki_page,
    list_smart_compile_queue,
    release_failed_smart_compile_job,
    wiki_context,
    wiki_index,
)


router = APIRouter(prefix="/api/v1/wiki", tags=["wiki"])


class CreateSmartCompileJobsRequest(BaseModel):
    document_ids: list[str] | None = None
    purpose: str | None = None
    include_current: bool = False
    requested_by: str | None = "web"
    limit: int = Field(default=10000, ge=1, le=10000)


class ClaimSmartCompileJobsRequest(BaseModel):
    job_ids: list[str]
    worker: str | None = "qoder-work"


class CompleteSmartCompileJobRequest(BaseModel):
    summary: str
    content: str | None = None
    keywords: list[str] | None = None
    worker: str | None = "qoder-work"


class FailSmartCompileJobRequest(BaseModel):
    error_message: str
    worker: str | None = "qoder-work"


def verify_worker_token(authorization: str | None) -> None:
    token = settings.agent_read_token
    if not token or token == "change-me":
        return
    expected = f"Bearer {token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Qoder Work Token 不正确。")


@router.post("/compile")
def compile_wiki_route(request: Request, purpose: str | None = None):
    job = compile_wiki(purpose=purpose)
    write_audit(
        "compile_wiki",
        ip=request.client.host if request.client else None,
        message=f"pages={job['compiled_pages']},docs={job['total_documents']}",
    )
    return job


@router.post("/compile-jobs/batch")
def create_smart_compile_jobs_route(payload: CreateSmartCompileJobsRequest, request: Request):
    result = create_smart_compile_jobs(
        document_ids=payload.document_ids,
        purpose=payload.purpose,
        include_current=payload.include_current,
        requested_by=payload.requested_by or "web",
        limit=payload.limit,
    )
    if result["queued"]:
        write_audit("create_wiki_compile_jobs", ip=request.client.host if request.client else None, message=f"queued={result['queued']}")
    return result


@router.get("/compile-jobs/queue")
def smart_compile_queue(limit: int = 200, offset: int = 0, authorization: str | None = Header(default=None)):
    verify_worker_token(authorization)
    return list_smart_compile_queue(limit=limit, offset=offset)


@router.get("/compile-jobs/next")
def claim_next_smart_compile_jobs_route(
    request: Request,
    limit: int = 5,
    worker: str | None = "qoder-work",
    authorization: str | None = Header(default=None),
):
    verify_worker_token(authorization)
    jobs = claim_next_smart_compile_jobs(limit=limit, worker=worker, request=request)
    return {"jobs": jobs}


@router.post("/compile-jobs/claim")
def claim_selected_smart_compile_jobs_route(payload: ClaimSmartCompileJobsRequest, request: Request, authorization: str | None = Header(default=None)):
    verify_worker_token(authorization)
    jobs = claim_selected_smart_compile_jobs(job_ids=payload.job_ids, worker=payload.worker, request=request)
    for job in jobs:
        write_audit("claim_wiki_compile_job", document_id=job["source_document_id"], actor=payload.worker or "qoder-work", ip=request.client.host if request.client else None, message=job["id"])
    return {"jobs": jobs}


@router.post("/compile-jobs/{job_id}/complete")
def complete_smart_compile_job_route(job_id: str, payload: CompleteSmartCompileJobRequest, request: Request, authorization: str | None = Header(default=None)):
    verify_worker_token(authorization)
    job = complete_smart_compile_job(job_id, summary=payload.summary, content=payload.content, keywords=payload.keywords, worker=payload.worker)
    write_audit("complete_wiki_compile_job", document_id=job["source_document_id"], actor=payload.worker, ip=request.client.host if request.client else None, message=job_id)
    return job


@router.post("/compile-jobs/{job_id}/fail")
def fail_smart_compile_job_route(job_id: str, payload: FailSmartCompileJobRequest, request: Request, authorization: str | None = Header(default=None)):
    verify_worker_token(authorization)
    job = fail_smart_compile_job(job_id, error_message=payload.error_message, worker=payload.worker)
    write_audit("fail_wiki_compile_job", document_id=job["source_document_id"], actor=payload.worker, ip=request.client.host if request.client else None, message=job_id)
    return job


@router.post("/compile-jobs/{job_id}/release")
def release_failed_smart_compile_job_route(job_id: str, request: Request, authorization: str | None = Header(default=None)):
    verify_worker_token(authorization)
    job = release_failed_smart_compile_job(job_id)
    write_audit("release_wiki_compile_job", document_id=job["source_document_id"], ip=request.client.host if request.client else None, message=job_id)
    return job


@router.get("/index")
def wiki_index_route(request: Request):
    return add_page_urls(wiki_index(), request)


@router.get("/pages/{page_id}")
def wiki_page_route(page_id: str, request: Request):
    page = get_wiki_page(page_id)
    return add_single_page_urls(page, request)


@router.get("/context")
def wiki_context_route(request: Request, query: str, purpose: str | None = None, limit: int = 8):
    context = wiki_context(query=query, purpose=purpose, limit=limit)
    for page in context["pages"]:
        add_single_page_urls(page, request)
    for source in context["sources"]:
        document_id = source["document_id"]
        source["content_url"] = str(request.url_for("document_content", document_id=document_id)) + "?format=markdown"
        source["raw_url"] = str(request.url_for("download_raw", document_id=document_id))
    return context


def add_page_urls(payload: dict, request: Request) -> dict:
    for page in payload.get("overview_pages", []):
        add_single_page_urls(page, request)
    return payload


def add_single_page_urls(page: dict, request: Request) -> dict:
    page["page_url"] = str(request.url_for("wiki_page_route", page_id=page["id"]))
    if page.get("source_document_id"):
        document_id = page["source_document_id"]
        page["content_url"] = str(request.url_for("document_content", document_id=document_id)) + "?format=markdown"
        page["raw_url"] = str(request.url_for("download_raw", document_id=document_id))
    return page
