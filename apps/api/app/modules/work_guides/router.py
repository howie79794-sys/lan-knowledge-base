from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.config import settings
from app.modules.work_guides.schemas import (
    WorkGuideAssetPublishResponse,
    WorkGuideDetail,
    WorkGuideListResponse,
    WorkGuidePublishRequest,
)
from app.modules.work_guides.service import (
    get_work_guide,
    list_work_guides,
    publish_work_guide,
    publish_work_guide_asset,
    work_guide_asset_path,
)


router = APIRouter(prefix="/api/v1/work-guides", tags=["work-guides"])


def verify_publish_token(authorization: str | None) -> None:
    token = settings.agent_read_token
    if not token or token == "change-me":
        return
    if authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="Agent token 无效。")


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


@router.put("/{slug}/assets/{asset_path:path}", response_model=WorkGuideAssetPublishResponse)
def publish_guide_asset(
    slug: str,
    asset_path: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
) -> WorkGuideAssetPublishResponse:
    verify_publish_token(authorization)
    try:
        return WorkGuideAssetPublishResponse(**publish_work_guide_asset(slug, asset_path, file.file.read()))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/{slug}", response_model=WorkGuideDetail)
def work_guide(slug: str) -> WorkGuideDetail:
    try:
        return WorkGuideDetail(**get_work_guide(slug))
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.put("/{slug}", response_model=WorkGuideDetail)
def publish_guide(
    slug: str,
    payload: WorkGuidePublishRequest,
    authorization: str | None = Header(default=None),
) -> WorkGuideDetail:
    verify_publish_token(authorization)
    try:
        return WorkGuideDetail(**publish_work_guide(slug, payload.markdown))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
