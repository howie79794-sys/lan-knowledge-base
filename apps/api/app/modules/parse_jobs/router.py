from __future__ import annotations

from fastapi import APIRouter, Header, Request

from app.core.config import settings
from app.modules.audit.service import write_audit
from app.modules.parse_jobs.schemas import (
    BatchCreateParseJobsRequest,
    BatchCreateParseJobsResponse,
    ClaimParseJobsResponse,
    CompleteParseJobRequest,
    FailParseJobRequest,
    ParseQueueResponse,
    ParseJobSummary,
)
from app.modules.parse_jobs.service import (
    claim_next_jobs,
    complete_parse_job,
    create_batch_parse_jobs,
    create_parse_job,
    fail_parse_job,
    list_parse_queue,
)


router = APIRouter(prefix="/api/v1", tags=["parse-jobs"])


def verify_worker_token(authorization: str | None) -> None:
    token = settings.agent_read_token
    if not token:
        return
    expected = f"Bearer {token}"
    if authorization != expected:
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="Qoder Work Token 不正确。")


@router.post("/documents/{document_id}/parse-jobs", response_model=ParseJobSummary)
def create_document_parse_job(document_id: str, request: Request):
    job = create_parse_job(document_id, requested_by="web")
    write_audit("create_parse_job", document_id=document_id, ip=request.client.host if request.client else None, message=job["id"])
    return job


@router.post("/parse-jobs/batch", response_model=BatchCreateParseJobsResponse)
def create_parse_jobs_batch(payload: BatchCreateParseJobsRequest, request: Request):
    result = create_batch_parse_jobs(
        document_ids=payload.document_ids,
        purpose=payload.purpose,
        limit=payload.limit,
        include_failed=payload.include_failed,
        requested_by=payload.requested_by or "web",
    )
    write_audit(
        "create_parse_jobs_batch",
        ip=request.client.host if request.client else None,
        message=f"queued={result['queued']}",
    )
    return result


@router.get("/parse-jobs/queue", response_model=ParseQueueResponse)
def parse_queue(limit: int = 200, offset: int = 0):
    return list_parse_queue(limit=limit, offset=offset)


@router.get("/parse-jobs/next", response_model=ClaimParseJobsResponse)
def claim_parse_jobs(
    request: Request,
    limit: int = 5,
    worker: str | None = "qoder-work",
    authorization: str | None = Header(default=None),
):
    verify_worker_token(authorization)
    jobs = claim_next_jobs(limit=limit, worker=worker, request=request)
    write_audit("claim_parse_jobs", actor=worker, ip=request.client.host if request.client else None, message=f"claimed={len(jobs)}")
    return {"jobs": jobs}


@router.post("/parse-jobs/{job_id}/complete", response_model=ParseJobSummary)
def complete_job(job_id: str, payload: CompleteParseJobRequest, request: Request, authorization: str | None = Header(default=None)):
    verify_worker_token(authorization)
    job = complete_parse_job(job_id, markdown=payload.markdown, text=payload.text, metadata=payload.metadata, worker=payload.worker)
    write_audit("complete_parse_job", document_id=job["document_id"], actor=payload.worker, ip=request.client.host if request.client else None, message=job_id)
    return job


@router.post("/parse-jobs/{job_id}/fail", response_model=ParseJobSummary)
def fail_job(job_id: str, payload: FailParseJobRequest, request: Request, authorization: str | None = Header(default=None)):
    verify_worker_token(authorization)
    job = fail_parse_job(job_id, error_message=payload.error_message, worker=payload.worker)
    write_audit("fail_parse_job", document_id=job["document_id"], actor=payload.worker, ip=request.client.host if request.client else None, message=job_id)
    return job
