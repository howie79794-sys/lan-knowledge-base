from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from app.core.config import DOCUMENT_PURPOSES, settings
from app.db.session import db_session
from app.modules.documents.service import display_purpose, purpose_filter_values


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def page_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "page_type": row["page_type"],
        "title": row["title"],
        "purpose": display_purpose(row["purpose"]) if row["purpose"] else None,
        "source_document_id": row["source_document_id"],
        "summary": row["summary"],
        "content": row["content"],
        "keywords": split_keywords(row["keywords"]),
        "compile_method": row["compile_method"],
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def compile_wiki(purpose: str | None = None) -> dict:
    job_id = f"wiki_job_{uuid4().hex}"
    now = utc_now()
    canonical_purpose = purpose if purpose in DOCUMENT_PURPOSES else None
    if purpose and not canonical_purpose:
        raise HTTPException(status_code=400, detail="知识分类不在允许范围内。")

    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO wiki_compile_jobs (id, status, purpose, created_at, updated_at)
            VALUES (?, 'running', ?, ?, ?)
            """,
            (job_id, canonical_purpose, now, now),
        )

    try:
        documents = list_ready_documents(canonical_purpose)
        compiled_pages = 0
        grouped: dict[str, list[dict]] = defaultdict(list)

        for doc in documents:
            markdown = read_document_markdown(doc["id"])
            summary = summarize_markdown(markdown, fallback=doc["content_excerpt"] or doc["title"])
            keywords = extract_keywords(markdown, doc["title"], doc["purpose"])
            page = upsert_document_summary_page(doc, summary, markdown, keywords)
            grouped[doc["purpose"]].append({**doc, "wiki_page": page, "summary": summary, "keywords": keywords})
            compiled_pages += 1

        for group_purpose in sorted(grouped):
            upsert_category_overview_page(group_purpose, grouped[group_purpose])
            compiled_pages += 1

        finished_at = utc_now()
        with db_session() as conn:
            conn.execute(
                """
                UPDATE wiki_compile_jobs
                SET status = 'succeeded', total_documents = ?, compiled_pages = ?, finished_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (len(documents), compiled_pages, finished_at, finished_at, job_id),
            )
            row = conn.execute("SELECT * FROM wiki_compile_jobs WHERE id = ?", (job_id,)).fetchone()
        return job_to_dict(row)
    except Exception as exc:
        failed_at = utc_now()
        with db_session() as conn:
            conn.execute(
                """
                UPDATE wiki_compile_jobs
                SET status = 'failed', error_message = ?, finished_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (str(exc), failed_at, failed_at, job_id),
            )
        raise


def job_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "status": row["status"],
        "job_type": row["job_type"],
        "source_document_id": row["source_document_id"],
        "purpose": display_purpose(row["purpose"]) if row["purpose"] else None,
        "total_documents": row["total_documents"],
        "compiled_pages": row["compiled_pages"],
        "worker": row["worker"],
        "attempts": row["attempts"],
        "requested_by": row["requested_by"],
        "result_page_id": row["result_page_id"],
        "error_message": row["error_message"],
        "started_at": row["started_at"],
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
        "updated_at": row["updated_at"],
    }


def create_smart_compile_jobs(
    document_ids: list[str] | None = None,
    purpose: str | None = None,
    include_current: bool = False,
    requested_by: str | None = None,
    limit: int = 10000,
) -> dict:
    canonical_purpose = purpose if purpose in DOCUMENT_PURPOSES else None
    if purpose and not canonical_purpose:
        raise HTTPException(status_code=400, detail="知识分类不在允许范围内。")
    safe_limit = min(max(limit, 1), 10000)
    filters = ["d.status = 'ready'"]
    params: list[object] = []
    if document_ids:
        unique_ids = list(dict.fromkeys(document_id for document_id in document_ids if document_id.strip()))
        filters.append(f"d.id IN ({','.join('?' for _ in unique_ids)})")
        params.extend(unique_ids)
    if canonical_purpose:
        values = purpose_filter_values(canonical_purpose)
        filters.append(f"m.purpose IN ({','.join('?' for _ in values)})")
        params.extend(values)
    if not include_current:
        filters.append("(w.id IS NULL OR w.updated_at < d.updated_at OR w.compile_method != 'smart')")
    where_clause = " AND ".join(filters)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT d.id, m.purpose
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            LEFT JOIN wiki_pages w ON w.source_document_id = d.id AND w.page_type = 'document_summary'
            WHERE {where_clause}
            ORDER BY d.updated_at DESC
            LIMIT ?
            """,
            [*params, safe_limit],
        ).fetchall()

        created_job_ids: list[str] = []
        queued_document_ids: list[str] = []
        now = utc_now()
        for row in rows:
            existing = conn.execute(
                """
                SELECT id
                FROM wiki_compile_jobs
                WHERE job_type = 'smart_document'
                  AND source_document_id = ?
                  AND status IN ('queued', 'processing')
                LIMIT 1
                """,
                (row["id"],),
            ).fetchone()
            if existing:
                continue
            job_id = f"wiki_job_{uuid4().hex}"
            conn.execute(
                """
                INSERT INTO wiki_compile_jobs (
                    id, status, job_type, source_document_id, purpose, total_documents,
                    compiled_pages, attempts, requested_by, created_at, updated_at
                )
                VALUES (?, 'queued', 'smart_document', ?, ?, 1, 0, 0, ?, ?, ?)
                """,
                (job_id, row["id"], row["purpose"], requested_by, now, now),
            )
            created_job_ids.append(job_id)
            queued_document_ids.append(row["id"])
    return {
        "queued": len(created_job_ids),
        "job_ids": created_job_ids,
        "document_ids": queued_document_ids,
    }


def list_smart_compile_queue(limit: int = 200, offset: int = 0) -> dict:
    safe_limit = min(max(limit, 1), 500)
    safe_offset = max(offset, 0)
    with db_session() as conn:
        total = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM wiki_compile_jobs
            WHERE job_type = 'smart_document' AND status IN ('queued', 'processing', 'failed')
            """
        ).fetchone()["count"]
        rows = conn.execute(
            """
            SELECT j.*, d.title, d.original_filename, d.file_format, d.folder_path,
                   d.size_bytes, d.updated_at AS document_updated_at
            FROM wiki_compile_jobs j
            JOIN documents d ON d.id = j.source_document_id
            WHERE j.job_type = 'smart_document'
              AND j.status IN ('queued', 'processing', 'failed')
            ORDER BY
                CASE j.status
                    WHEN 'processing' THEN 1
                    WHEN 'queued' THEN 2
                    WHEN 'failed' THEN 3
                    ELSE 5
                END,
                j.updated_at DESC
            LIMIT ? OFFSET ?
            """,
            (safe_limit, safe_offset),
        ).fetchall()
    return {"total": total, "items": [smart_job_to_queue_item(row) for row in rows]}


def smart_job_to_queue_item(row) -> dict:
    return {
        **job_to_dict(row),
        "document": {
            "id": row["source_document_id"],
            "title": row["title"],
            "original_filename": row["original_filename"],
            "file_format": row["file_format"],
            "folder_path": row["folder_path"],
            "purpose": display_purpose(row["purpose"]) if row["purpose"] else None,
            "size_bytes": row["size_bytes"],
            "updated_at": row["document_updated_at"],
        },
    }


def claim_next_smart_compile_jobs(limit: int, worker: str | None, request) -> list[dict]:
    safe_limit = min(max(limit, 1), 20)
    now = utc_now()
    worker_name = worker or "qoder-work"
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT j.*, d.title, d.original_filename, d.file_format, d.folder_path,
                   d.size_bytes, d.updated_at AS document_updated_at
            FROM wiki_compile_jobs j
            JOIN documents d ON d.id = j.source_document_id
            WHERE j.job_type = 'smart_document' AND j.status = 'queued' AND d.status = 'ready'
            ORDER BY j.created_at ASC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
        job_ids = [row["id"] for row in rows]
        if job_ids:
            conn.execute(
                f"""
                UPDATE wiki_compile_jobs
                SET status = 'processing', worker = ?, attempts = attempts + 1,
                    started_at = COALESCE(started_at, ?), updated_at = ?
                WHERE id IN ({','.join('?' for _ in job_ids)})
                """,
                [worker_name, now, now, *job_ids],
            )
    return [smart_job_to_work_item(row, worker_name, request, now) for row in rows]


def claim_selected_smart_compile_jobs(job_ids: list[str], worker: str | None, request) -> list[dict]:
    unique_job_ids = list(dict.fromkeys(job_id for job_id in job_ids if job_id.strip()))
    if not unique_job_ids:
        raise HTTPException(status_code=400, detail="请选择要领取的智能编译任务。")
    if len(unique_job_ids) > 20:
        raise HTTPException(status_code=400, detail="一次最多领取 20 个智能编译任务。")
    placeholders = ",".join("?" for _ in unique_job_ids)
    now = utc_now()
    worker_name = worker or "qoder-work"
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT j.*, d.title, d.original_filename, d.file_format, d.folder_path,
                   d.size_bytes, d.updated_at AS document_updated_at, d.status AS document_status
            FROM wiki_compile_jobs j
            JOIN documents d ON d.id = j.source_document_id
            WHERE j.id IN ({placeholders})
            ORDER BY j.created_at ASC
            """,
            unique_job_ids,
        ).fetchall()
        found_ids = {row["id"] for row in rows}
        missing = [job_id for job_id in unique_job_ids if job_id not in found_ids]
        if missing:
            raise HTTPException(status_code=404, detail=f"智能编译任务不存在：{', '.join(missing)}")
        invalid = [row for row in rows if row["status"] != "queued" or row["document_status"] != "ready"]
        if invalid:
            text = "、".join(f"{row['id']}({row['status']})" for row in invalid[:5])
            raise HTTPException(status_code=400, detail=f"只能领取队列中的智能编译任务：{text}")
        conn.execute(
            f"""
            UPDATE wiki_compile_jobs
            SET status = 'processing', worker = ?, attempts = attempts + 1,
                started_at = COALESCE(started_at, ?), updated_at = ?
            WHERE id IN ({placeholders})
            """,
            [worker_name, now, now, *unique_job_ids],
        )
    return [smart_job_to_work_item(row, worker_name, request, now) for row in rows]


def smart_job_to_work_item(row, worker_name: str, request, now: str) -> dict:
    document_id = row["source_document_id"]
    return {
        **smart_job_to_queue_item(
            {
                **dict(row),
                "status": "processing",
                "worker": worker_name,
                "attempts": row["attempts"] + 1,
                "started_at": row["started_at"] or now,
                "updated_at": now,
            }
        ),
        "content_url": str(request.url_for("document_content", document_id=document_id)) + "?format=markdown",
        "raw_url": str(request.url_for("download_raw", document_id=document_id)),
        "instructions": "读取 content_url，生成高质量 summary、content、keywords 后提交 complete。",
    }


def complete_smart_compile_job(job_id: str, summary: str, content: str | None, keywords: list[str] | None, worker: str | None) -> dict:
    with db_session() as conn:
        job = conn.execute("SELECT * FROM wiki_compile_jobs WHERE id = ?", (job_id,)).fetchone()
    if not job:
        raise HTTPException(status_code=404, detail="智能编译任务不存在。")
    if job["job_type"] != "smart_document":
        raise HTTPException(status_code=400, detail="当前任务不是单文件智能编译任务。")
    if job["status"] not in {"queued", "processing", "failed"}:
        raise HTTPException(status_code=400, detail="当前智能编译任务状态不能提交结果。")
    if not summary.strip():
        raise HTTPException(status_code=400, detail="summary 不能为空。")

    doc = get_ready_document_for_wiki(job["source_document_id"])
    markdown = read_document_markdown(doc["id"])
    page = upsert_document_summary_page_from_agent(
        doc,
        summary=summary.strip(),
        content=(content or "").strip(),
        keywords=keywords or extract_keywords(markdown, doc["title"], doc["purpose"]),
    )
    refresh_category_overview(doc["purpose"])
    now = utc_now()
    with db_session() as conn:
        conn.execute(
            """
            UPDATE wiki_compile_jobs
            SET status = 'succeeded', worker = COALESCE(?, worker), compiled_pages = 1,
                result_page_id = ?, error_message = NULL, finished_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (worker, page["id"], now, now, job_id),
        )
        row = conn.execute("SELECT * FROM wiki_compile_jobs WHERE id = ?", (job_id,)).fetchone()
    return job_to_dict(row)


def fail_smart_compile_job(job_id: str, error_message: str, worker: str | None) -> dict:
    with db_session() as conn:
        job = conn.execute("SELECT * FROM wiki_compile_jobs WHERE id = ?", (job_id,)).fetchone()
        if not job:
            raise HTTPException(status_code=404, detail="智能编译任务不存在。")
        now = utc_now()
        conn.execute(
            """
            UPDATE wiki_compile_jobs
            SET status = 'failed', worker = COALESCE(?, worker), error_message = ?,
                finished_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (worker, error_message, now, now, job_id),
        )
        row = conn.execute("SELECT * FROM wiki_compile_jobs WHERE id = ?", (job_id,)).fetchone()
    return job_to_dict(row)


def get_ready_document_for_wiki(document_id: str) -> dict:
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE d.id = ? AND d.status = 'ready'
            """,
            (document_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="已解析文档不存在。")
    return dict(row)


def list_ready_documents(purpose: str | None = None) -> list[dict]:
    filters = ["d.status = 'ready'"]
    params: list[object] = []
    if purpose:
        values = purpose_filter_values(purpose)
        filters.append(f"m.purpose IN ({','.join('?' for _ in values)})")
        params.extend(values)
    where_clause = " AND ".join(filters)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT d.*, m.purpose, m.uploader_name, m.confidentiality
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE {where_clause}
            ORDER BY m.purpose ASC, d.updated_at DESC
            """,
            params,
        ).fetchall()
    return [dict(row) for row in rows]


def read_document_markdown(document_id: str) -> str:
    path = Path(settings.processed_dir) / document_id / "content.md"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def upsert_document_summary_page(doc: dict, summary: str, markdown: str, keywords: list[str]) -> dict:
    page_id = f"wiki_doc_{doc['id']}"
    now = utc_now()
    headings = extract_headings(markdown)
    content = "\n".join(
        [
            f"# {doc['title']}",
            "",
            "## 核心摘要",
            summary,
            "",
            "## 来源信息",
            f"- 原始文件：{doc['original_filename']}",
            f"- 知识分类：{display_purpose(doc['purpose'])}",
            f"- 知识路径：{doc['folder_path']}",
            f"- 原文 ID：{doc['id']}",
            "",
            "## 主要标题",
            *(f"- {heading}" for heading in headings[:10]),
            "",
            "## 关键词",
            ", ".join(keywords[:12]) if keywords else "暂无",
        ]
    ).strip()
    with db_session() as conn:
        existing = conn.execute("SELECT created_at FROM wiki_pages WHERE id = ?", (page_id,)).fetchone()
        conn.execute(
            """
            INSERT OR REPLACE INTO wiki_pages (
                id, page_type, title, purpose, source_document_id, summary, content,
                keywords, compile_method, status, created_at, updated_at
            )
            VALUES (?, 'document_summary', ?, ?, ?, ?, ?, ?, 'local', 'ready', ?, ?)
            """,
            (
                page_id,
                doc["title"],
                doc["purpose"],
                doc["id"],
                summary,
                content,
                ",".join(keywords),
                existing["created_at"] if existing else now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM wiki_pages WHERE id = ?", (page_id,)).fetchone()
    return page_to_dict(row)


def upsert_document_summary_page_from_agent(doc: dict, summary: str, content: str, keywords: list[str]) -> dict:
    page_id = f"wiki_doc_{doc['id']}"
    now = utc_now()
    clean_keywords = [keyword.strip() for keyword in keywords if keyword.strip()][:24]
    wiki_content = content or "\n".join(
        [
            f"# {doc['title']}",
            "",
            "## 核心摘要",
            summary,
            "",
            "## 来源信息",
            f"- 原始文件：{doc['original_filename']}",
            f"- 知识分类：{display_purpose(doc['purpose'])}",
            f"- 知识路径：{doc['folder_path']}",
            f"- 原文 ID：{doc['id']}",
            "",
            "## 关键词",
            ", ".join(clean_keywords[:12]) if clean_keywords else "暂无",
        ]
    ).strip()
    with db_session() as conn:
        existing = conn.execute("SELECT created_at FROM wiki_pages WHERE id = ?", (page_id,)).fetchone()
        conn.execute(
            """
            INSERT OR REPLACE INTO wiki_pages (
                id, page_type, title, purpose, source_document_id, summary, content,
                keywords, compile_method, status, created_at, updated_at
            )
            VALUES (?, 'document_summary', ?, ?, ?, ?, ?, ?, 'smart', 'ready', ?, ?)
            """,
            (
                page_id,
                doc["title"],
                doc["purpose"],
                doc["id"],
                summary,
                wiki_content,
                ",".join(clean_keywords),
                existing["created_at"] if existing else now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM wiki_pages WHERE id = ?", (page_id,)).fetchone()
    return page_to_dict(row)


def refresh_category_overview(purpose: str) -> dict | None:
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT d.id, d.title, d.original_filename, d.folder_path, d.updated_at,
                   m.purpose, w.summary, w.keywords
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            JOIN wiki_pages w ON w.source_document_id = d.id AND w.page_type = 'document_summary'
            WHERE d.status = 'ready' AND m.purpose = ?
            ORDER BY d.updated_at DESC
            """,
            (purpose,),
        ).fetchall()
    if not rows:
        return None
    docs = [
        {
            **dict(row),
            "keywords": split_keywords(row["keywords"]),
        }
        for row in rows
    ]
    return upsert_category_overview_page(purpose, docs)


def upsert_category_overview_page(purpose: str, documents: list[dict]) -> dict:
    page_id = f"wiki_purpose_{hashlib.sha1(purpose.encode('utf-8')).hexdigest()[:16]}"
    now = utc_now()
    keyword_counter: Counter[str] = Counter()
    for doc in documents:
        keyword_counter.update(doc.get("keywords", []))
    top_keywords = [word for word, _ in keyword_counter.most_common(16)]
    latest = max(doc["updated_at"] for doc in documents) if documents else now
    summary = f"{display_purpose(purpose)} 分类下当前有 {len(documents)} 条已解析知识，最新来源更新时间为 {format_date(latest)}。"
    lines = [
        f"# {display_purpose(purpose)} 知识总览",
        "",
        "## 当前概况",
        summary,
        "",
        "## 高频关键词",
        ", ".join(top_keywords) if top_keywords else "暂无",
        "",
        "## 重点资料",
    ]
    for doc in documents[:30]:
        lines.append(f"- {doc['title']}：{doc['summary'][:180]}")
    content = "\n".join(lines)
    with db_session() as conn:
        existing = conn.execute("SELECT created_at FROM wiki_pages WHERE id = ?", (page_id,)).fetchone()
        conn.execute(
            """
            INSERT OR REPLACE INTO wiki_pages (
                id, page_type, title, purpose, source_document_id, summary, content,
                keywords, compile_method, status, created_at, updated_at
            )
            VALUES (?, 'category_overview', ?, ?, NULL, ?, ?, ?, 'local', 'ready', ?, ?)
            """,
            (
                page_id,
                f"{display_purpose(purpose)} 知识总览",
                purpose,
                summary,
                content,
                ",".join(top_keywords),
                existing["created_at"] if existing else now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM wiki_pages WHERE id = ?", (page_id,)).fetchone()
    return page_to_dict(row)


def wiki_index() -> dict:
    with db_session() as conn:
        overview_rows = conn.execute(
            """
            SELECT * FROM wiki_pages
            WHERE page_type = 'category_overview' AND status = 'ready'
            ORDER BY purpose ASC
            """
        ).fetchall()
        summary_rows = conn.execute(
            """
            SELECT purpose, COUNT(*) AS count, MAX(updated_at) AS updated_at
            FROM wiki_pages
            WHERE page_type = 'document_summary' AND status = 'ready'
            GROUP BY purpose
            ORDER BY purpose ASC
            """
        ).fetchall()
        latest_job = conn.execute(
            """
            SELECT * FROM wiki_compile_jobs
            ORDER BY created_at DESC
            LIMIT 1
            """
        ).fetchone()
        stale_rows = conn.execute(
            """
            SELECT d.id, d.title, m.purpose, d.updated_at
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            LEFT JOIN wiki_pages w ON w.source_document_id = d.id AND w.page_type = 'document_summary'
            WHERE d.status = 'ready' AND (w.id IS NULL OR w.updated_at < d.updated_at OR w.compile_method != 'smart')
            ORDER BY d.updated_at DESC
            LIMIT 100
            """
        ).fetchall()
    return {
        "overview_pages": [page_to_dict(row) for row in overview_rows],
        "summary_counts": [
            {"purpose": display_purpose(row["purpose"]), "count": row["count"], "updated_at": row["updated_at"]}
            for row in summary_rows
        ],
        "latest_job": job_to_dict(latest_job) if latest_job else None,
        "stale_documents": [
            {"id": row["id"], "title": row["title"], "purpose": display_purpose(row["purpose"]), "updated_at": row["updated_at"]}
            for row in stale_rows
        ],
    }


def get_wiki_page(page_id: str) -> dict:
    with db_session() as conn:
        row = conn.execute("SELECT * FROM wiki_pages WHERE id = ? AND status = 'ready'", (page_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Wiki 页面不存在。")
    return page_to_dict(row)


def wiki_context(query: str, purpose: str | None = None, limit: int = 8) -> dict:
    needle = query.strip()
    if not needle:
        return {"query": query, "pages": [], "sources": []}
    canonical_purpose = purpose if purpose in DOCUMENT_PURPOSES else None
    safe_limit = min(max(limit, 1), 20)
    with db_session() as conn:
        params: list[object] = []
        filters = ["w.status = 'ready'"]
        if canonical_purpose:
            values = purpose_filter_values(canonical_purpose)
            filters.append(f"w.purpose IN ({','.join('?' for _ in values)})")
            params.extend(values)
        where_clause = " AND ".join(filters)
        rows = conn.execute(
            f"""
            SELECT w.*, d.original_filename, d.file_format, d.folder_path, d.size_bytes
            FROM wiki_pages w
            LEFT JOIN documents d ON d.id = w.source_document_id
            WHERE {where_clause}
            """,
            params,
        ).fetchall()
    scored = sorted((score_page(dict(row), needle), dict(row)) for row in rows)
    selected = [row for score, row in scored if score < 0][:safe_limit]
    pages = [page_to_dict(row) for row in selected]
    sources = [
        {
            "document_id": row["source_document_id"],
            "title": row["title"],
            "original_filename": row["original_filename"],
            "file_format": row["file_format"],
            "folder_path": row["folder_path"],
            "size_bytes": row["size_bytes"],
        }
        for row in selected
        if row["source_document_id"]
    ]
    return {"query": query, "pages": pages, "sources": sources}


def score_page(row: dict, query: str) -> int:
    text = "\n".join(
        str(row.get(key) or "")
        for key in ("title", "summary", "content", "keywords")
    ).lower()
    terms = query_terms(query)
    if not terms:
        terms = [query.lower()]
    score = 0
    for term in terms:
        if not term:
            continue
        score += text.count(term)
    if query.lower() in text:
        score += 3
    return -score


def query_terms(query: str) -> list[str]:
    terms = [term.lower() for term in re.split(r"\s+", query) if term.strip()]
    cjk = "".join(re.findall(r"[\u4e00-\u9fff]+", query))
    if cjk and len(cjk) >= 4:
        terms.extend(cjk[index : index + 2] for index in range(0, len(cjk) - 1))
    return list(dict.fromkeys(terms))


def summarize_markdown(markdown: str, fallback: str) -> str:
    plain = strip_markdown(markdown)
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", plain) if part.strip()]
    candidates = [part for part in paragraphs if len(part) >= 20] or paragraphs
    if not candidates:
        return fallback[:400]
    summary = " ".join(candidates[:3])
    return compact_text(summary, 520)


def strip_markdown(markdown: str) -> str:
    text = re.sub(r"```.*?```", " ", markdown, flags=re.S)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"^[>\-*+]\s*", "", text, flags=re.M)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_headings(markdown: str) -> list[str]:
    headings = re.findall(r"^#{1,6}\s+(.+)$", markdown, flags=re.M)
    return [compact_text(heading.strip(), 80) for heading in headings if heading.strip()]


def extract_keywords(markdown: str, title: str, purpose: str) -> list[str]:
    headings = extract_headings(markdown)
    text = " ".join([title, purpose, *headings, strip_markdown(markdown)[:4000]])
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,8}", text)
    stop_words = {"这个", "一个", "以及", "可以", "进行", "文件", "资料", "内容", "知识", "材料", "我们", "相关"}
    counter = Counter(token for token in tokens if token not in stop_words)
    return [word for word, _ in counter.most_common(16)]


def split_keywords(value: str | None) -> list[str]:
    if not value:
        return []
    return [item for item in value.split(",") if item]


def compact_text(value: str, max_length: int) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) <= max_length:
        return value
    return f"{value[:max_length].rstrip()}..."


def format_date(value: str) -> str:
    return value.replace("T", " ").split(".")[0]
