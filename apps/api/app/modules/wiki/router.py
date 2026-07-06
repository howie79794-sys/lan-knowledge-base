from __future__ import annotations

from fastapi import APIRouter, Request

from app.modules.audit.service import write_audit
from app.modules.wiki.service import compile_wiki, get_wiki_page, wiki_context, wiki_index


router = APIRouter(prefix="/api/v1/wiki", tags=["wiki"])


@router.post("/compile")
def compile_wiki_route(request: Request, purpose: str | None = None):
    job = compile_wiki(purpose=purpose)
    write_audit(
        "compile_wiki",
        ip=request.client.host if request.client else None,
        message=f"pages={job['compiled_pages']},docs={job['total_documents']}",
    )
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
