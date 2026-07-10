from pydantic import BaseModel


class WorkGuideSummary(BaseModel):
    slug: str
    title: str
    summary: str
    categories: list[str]
    version: str | None = None
    effective_date: str | None = None
    updated_at: str
    status: str
    pinned: bool = False


class WorkGuideDetail(WorkGuideSummary):
    content: str


class WorkGuideListResponse(BaseModel):
    total: int
    categories: list[str]
    guides: list[WorkGuideSummary]
