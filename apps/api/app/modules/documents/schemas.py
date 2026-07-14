from pydantic import BaseModel


class DocumentSummary(BaseModel):
    id: str
    title: str
    original_filename: str
    file_format: str
    file_ext: str
    source_kind: str = "file"
    folder_path: str
    size_bytes: int
    status: str
    purpose: str
    uploader_name: str | None = None
    confidentiality: str
    content_excerpt: str | None = None
    error_message: str | None = None
    wiki_compiled: bool = False
    wiki_updated_at: str | None = None
    created_at: str
    updated_at: str


class DocumentListResponse(BaseModel):
    total: int
    documents: list[DocumentSummary]


class CategoryResponse(BaseModel):
    purposes: list[str]
    formats: list[str]


class FolderEntry(BaseModel):
    name: str
    path: str


class FolderResponse(BaseModel):
    path: str
    parent: str | None
    folders: list[FolderEntry]
    documents: list[DocumentSummary]


class CreateFolderRequest(BaseModel):
    purpose: str
    parent_path: str = "/"
    name: str


class MoveDocumentRequest(BaseModel):
    folder_path: str
