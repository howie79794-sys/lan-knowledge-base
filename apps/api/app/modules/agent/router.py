from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request

from app.core.config import settings
from app.modules.documents.service import list_documents


router = APIRouter(prefix="/api/v1", tags=["agent"])


def verify_agent_token(authorization: str | None) -> None:
    token = settings.agent_read_token
    if not token or token == "change-me":
        return
    expected = f"Bearer {token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Agent token 无效。")


@router.get("/manifest")
def manifest(request: Request, authorization: str | None = Header(default=None)):
    verify_agent_token(authorization)
    _, rows = list_documents(purpose=None, file_format=None, q=None, status="ready")
    base_url = str(request.base_url).rstrip("/")
    docs = []
    for row in rows:
        docs.append(
            {
                "id": row["id"],
                "title": row["title"],
                "purpose": row["purpose"],
                "folder_path": row["folder_path"],
                "file_format": row["file_format"],
                "size_bytes": row["size_bytes"],
                "status": row["status"],
                "updated_at": row["updated_at"],
                "content_url": f"{base_url}/api/v1/documents/{row['id']}/content?format=markdown",
                "raw_url": f"{base_url}/api/v1/documents/{row['id']}/raw",
            }
        )
    return {"total": len(docs), "documents": docs}
