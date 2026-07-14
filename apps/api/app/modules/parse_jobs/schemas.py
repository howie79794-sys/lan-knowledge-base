from pydantic import BaseModel, Field


class ParseJobSummary(BaseModel):
    id: str
    document_id: str
    status: str
    worker: str | None = None
    job_type: str = "standard"
    attempts: int
    requested_by: str | None = None
    error_message: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str


class ParseJobWorkItem(ParseJobSummary):
    title: str
    original_filename: str
    file_format: str
    file_ext: str
    folder_path: str
    purpose: str
    size_bytes: int
    raw_url: str
    raw_path: str
    source_kind: str = "file"
    source_manifest_url: str | None = None
    output_requirement: str | None = None


class ParseQueueItem(BaseModel):
    document_id: str
    title: str
    original_filename: str
    file_format: str
    source_kind: str = "file"
    job_type: str | None = None
    folder_path: str
    purpose: str
    size_bytes: int
    document_status: str
    document_updated_at: str
    job_id: str | None = None
    job_status: str | None = None
    worker: str | None = None
    attempts: int | None = None
    error_message: str | None = None
    job_updated_at: str | None = None


class ParseQueueResponse(BaseModel):
    total: int
    items: list[ParseQueueItem]


class BatchCreateParseJobsRequest(BaseModel):
    document_ids: list[str] | None = None
    purpose: str | None = None
    limit: int = Field(default=10, ge=1, le=100)
    include_failed: bool = False
    requested_by: str | None = None


class BatchCreateParseJobsResponse(BaseModel):
    queued: int
    job_ids: list[str]
    document_ids: list[str]


class ClaimSelectedParseJobsRequest(BaseModel):
    job_ids: list[str] = Field(default_factory=list, min_length=1, max_length=20)
    worker: str | None = None


class ClaimParseJobsResponse(BaseModel):
    jobs: list[ParseJobWorkItem]


class CompleteParseJobRequest(BaseModel):
    markdown: str
    text: str | None = None
    metadata: dict | None = None
    worker: str | None = None


class FailParseJobRequest(BaseModel):
    error_message: str
    worker: str | None = None
