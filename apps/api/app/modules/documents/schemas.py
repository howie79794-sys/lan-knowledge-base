from pydantic import BaseModel


class DocumentSummary(BaseModel):
    id: str
    title: str
    original_filename: str
    file_format: str
    file_ext: str
    size_bytes: int
    status: str
    purpose: str
    uploader_name: str | None = None
    confidentiality: str
    content_excerpt: str | None = None
    error_message: str | None = None
    created_at: str
    updated_at: str


class DocumentListResponse(BaseModel):
    total: int
    documents: list[DocumentSummary]


class CategoryResponse(BaseModel):
    purposes: list[str]
    formats: list[str]
