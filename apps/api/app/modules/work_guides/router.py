from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.modules.work_guides.schemas import WorkGuideDetail, WorkGuideListResponse
from app.modules.work_guides.service import get_work_guide, list_work_guides, work_guide_asset_path


router = APIRouter(prefix="/api/v1/work-guides", tags=["work-guides"])


@router.get("", response_model=WorkGuideListResponse)
def work_guides(q: str | None = None, category: str | None = None) -> WorkGuideListResponse:
    return WorkGuideListResponse(**list_work_guides(q=q, category=category))


@router.get("/{slug}/assets/{asset_path:path}")
def work_guide_asset(slug: str, asset_path: str):
    try:
        path = work_guide_asset_path(slug, asset_path)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return FileResponse(path, headers={"X-Content-Type-Options": "nosniff"})


@router.get("/{slug}", response_model=WorkGuideDetail)
def work_guide(slug: str) -> WorkGuideDetail:
    try:
        return WorkGuideDetail(**get_work_guide(slug))
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
