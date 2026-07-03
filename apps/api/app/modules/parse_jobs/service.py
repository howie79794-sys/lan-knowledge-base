from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, Request

from app.core.config import settings
from app.db.session import db_session
from app.modules.documents.service import display_purpose, get_document, purpose_filter_values, raw_file_path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def job_to_summary(row) -> dict:
    return {
        "id": row["id"],
        "document_id": row["document_id"],
        "status": row["status"],
        "worker": row["worker"],
        "attempts": row["attempts"],
        "requested_by": row["requested_by"],
        "error_message": row["error_message"],
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "updated_at": row["updated_at"],
    }


def create_parse_job(document_id: str, requested_by: str | None = None) -> dict:
    doc = get_document(document_id)
    if doc["status"] in {"deleted", "processing", "queued"}:
        raise HTTPException(status_code=400, detail="当前文件状态不允许创建解析任务。")
    with db_session() as conn:
        existing = conn.execute(
            """
            SELECT * FROM parse_jobs
            WHERE document_id = ? AND status IN ('queued', 'processing')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (document_id,),
        ).fetchone()
        if existing:
            return job_to_summary(existing)

        job_id = f"job_{uuid4().hex}"
        now = utc_now()
        conn.execute(
            """
            INSERT INTO parse_jobs (
                id, document_id, status, attempts, requested_by, created_at, updated_at
            )
            VALUES (?, ?, 'queued', 0, ?, ?, ?)
            """,
            (job_id, document_id, requested_by, now, now),
        )
        conn.execute(
            """
            UPDATE documents
            SET status = 'queued', error_message = NULL, updated_at = ?
            WHERE id = ?
            """,
            (now, document_id),
        )
        row = conn.execute("SELECT * FROM parse_jobs WHERE id = ?", (job_id,)).fetchone()
    return job_to_summary(row)


def create_batch_parse_jobs(
    document_ids: list[str] | None,
    purpose: str | None,
    limit: int,
    include_failed: bool,
    requested_by: str | None,
) -> dict:
    statuses = ["uploaded"]
    if include_failed:
        statuses.append("failed")
    params: list[object] = []
    filters = [f"d.status IN ({','.join('?' for _ in statuses)})"]
    params.extend(statuses)
    if document_ids:
        filters.append(f"d.id IN ({','.join('?' for _ in document_ids)})")
        params.extend(document_ids)
    if purpose:
        values = purpose_filter_values(purpose)
        filters.append(f"m.purpose IN ({','.join('?' for _ in values)})")
        params.extend(values)
    where_clause = " AND ".join(filters)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT d.id
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            WHERE {where_clause}
            ORDER BY d.created_at ASC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

    created_jobs = []
    for row in rows:
        created_jobs.append(create_parse_job(row["id"], requested_by=requested_by))
    return {
        "queued": len(created_jobs),
        "job_ids": [job["id"] for job in created_jobs],
        "document_ids": [job["document_id"] for job in created_jobs],
    }


def list_parse_queue(limit: int = 200, offset: int = 0) -> dict:
    safe_limit = min(max(limit, 1), 500)
    safe_offset = max(offset, 0)
    with db_session() as conn:
        total = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM documents
            WHERE status IN ('uploaded', 'queued', 'processing', 'failed')
            """
        ).fetchone()["count"]
        rows = conn.execute(
            """
            SELECT d.id AS document_id, d.title, d.original_filename, d.file_format,
                   d.folder_path, d.size_bytes, d.status AS document_status,
                   d.updated_at AS document_updated_at, m.purpose,
                   j.id AS job_id, j.status AS job_status, j.worker, j.attempts,
                   j.error_message, j.updated_at AS job_updated_at
            FROM documents d
            JOIN document_metadata m ON m.document_id = d.id
            LEFT JOIN parse_jobs j ON j.id = (
                SELECT id
                FROM parse_jobs
                WHERE document_id = d.id AND status IN ('queued', 'processing', 'failed')
                ORDER BY created_at DESC
                LIMIT 1
            )
            WHERE d.status IN ('uploaded', 'queued', 'processing', 'failed')
            ORDER BY
                CASE d.status
                    WHEN 'processing' THEN 1
                    WHEN 'queued' THEN 2
                    WHEN 'uploaded' THEN 3
                    WHEN 'failed' THEN 4
                    ELSE 5
                END,
                d.updated_at DESC
            LIMIT ? OFFSET ?
            """,
            (safe_limit, safe_offset),
        ).fetchall()
    return {
        "total": total,
        "items": [
            {
                "document_id": row["document_id"],
                "title": row["title"],
                "original_filename": row["original_filename"],
                "file_format": row["file_format"],
                "folder_path": row["folder_path"],
                "purpose": display_purpose(row["purpose"]),
                "size_bytes": row["size_bytes"],
                "document_status": row["document_status"],
                "document_updated_at": row["document_updated_at"],
                "job_id": row["job_id"],
                "job_status": row["job_status"],
                "worker": row["worker"],
                "attempts": row["attempts"],
                "error_message": row["error_message"],
                "job_updated_at": row["job_updated_at"],
            }
            for row in rows
        ],
    }


def claim_next_jobs(limit: int, worker: str | None, request: Request) -> list[dict]:
    safe_limit = min(max(limit, 1), 20)
    now = utc_now()
    worker_name = worker or "qoder-work"
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT j.*, d.title, d.original_filename, d.file_format, d.file_ext,
                   d.folder_path, d.size_bytes, m.purpose
            FROM parse_jobs j
            JOIN documents d ON d.id = j.document_id
            JOIN document_metadata m ON m.document_id = d.id
            WHERE j.status = 'queued' AND d.status = 'queued'
            ORDER BY j.created_at ASC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
        job_ids = [row["id"] for row in rows]
        if job_ids:
            conn.execute(
                f"""
                UPDATE parse_jobs
                SET status = 'processing', worker = ?, attempts = attempts + 1, started_at = COALESCE(started_at, ?), updated_at = ?
                WHERE id IN ({','.join('?' for _ in job_ids)})
                """,
                [worker_name, now, now, *job_ids],
            )
            conn.execute(
                f"""
                UPDATE documents
                SET status = 'processing', updated_at = ?
                WHERE id IN (
                    SELECT document_id FROM parse_jobs WHERE id IN ({','.join('?' for _ in job_ids)})
                )
                """,
                [now, *job_ids],
            )

    claimed: list[dict] = []
    for row in rows:
        raw_path = raw_file_path(row["document_id"])
        claimed.append(
            {
                **job_to_summary({**dict(row), "status": "processing", "worker": worker_name, "attempts": row["attempts"] + 1, "started_at": row["started_at"] or now, "updated_at": now}),
                "title": row["title"],
                "original_filename": row["original_filename"],
                "file_format": row["file_format"],
                "file_ext": row["file_ext"],
                "folder_path": row["folder_path"],
                "purpose": display_purpose(row["purpose"]),
                "size_bytes": row["size_bytes"],
                "raw_url": str(request.url_for("download_raw", document_id=row["document_id"])),
                "raw_path": str(raw_path),
            }
        )
    return claimed


def cancel_queued_parse_job(job_id: str) -> dict:
    with db_session() as conn:
        job = conn.execute("SELECT * FROM parse_jobs WHERE id = ?", (job_id,)).fetchone()
        if not job:
            raise HTTPException(status_code=404, detail="解析任务不存在。")
        if job["status"] != "queued":
            raise HTTPException(status_code=400, detail="只能删除队列中状态的解析任务。")

        now = utc_now()
        conn.execute(
            """
            UPDATE documents
            SET status = 'uploaded', updated_at = ?
            WHERE id = ? AND status = 'queued'
            """,
            (now, job["document_id"]),
        )
        conn.execute("DELETE FROM parse_jobs WHERE id = ?", (job_id,))

    summary = job_to_summary(job)
    summary["status"] = "canceled"
    summary["updated_at"] = utc_now()
    return summary


def complete_parse_job(job_id: str, markdown: str, text: str | None, metadata: dict | None, worker: str | None) -> dict:
    with db_session() as conn:
        job = conn.execute("SELECT * FROM parse_jobs WHERE id = ?", (job_id,)).fetchone()
    if not job:
        raise HTTPException(status_code=404, detail="解析任务不存在。")
    if job["status"] not in {"queued", "processing", "failed"}:
        raise HTTPException(status_code=400, detail="当前解析任务状态不能提交结果。")

    document_id = job["document_id"]
    content_text = text if text is not None else markdown
    output_dir = Path(settings.processed_dir) / document_id
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "content.md").write_text(markdown, encoding="utf-8")
    (output_dir / "content.txt").write_text(content_text, encoding="utf-8")
    (output_dir / "metadata.json").write_text(
        json.dumps(
            {
                "parser": "qoder-work",
                "worker": worker or job["worker"] or "qoder-work",
                "job_id": job_id,
                "metadata": metadata or {},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    now = utc_now()
    with db_session() as conn:
        conn.execute(
            """
            UPDATE documents
            SET status = 'ready', content_excerpt = ?, search_text = ?, error_message = NULL, updated_at = ?
            WHERE id = ?
            """,
            (content_text[:400], content_text[:20000], now, document_id),
        )
        conn.execute(
            """
            INSERT INTO processed_artifacts (id, document_id, artifact_type, path, parser, parse_status, created_at)
            VALUES (?, ?, 'markdown', ?, 'qoder-work', 'ready', ?)
            """,
            (str(uuid4()), document_id, f"{document_id}/content.md", now),
        )
        conn.execute(
            """
            UPDATE parse_jobs
            SET status = 'succeeded', worker = COALESCE(?, worker), error_message = NULL, finished_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (worker, now, now, job_id),
        )
        row = conn.execute("SELECT * FROM parse_jobs WHERE id = ?", (job_id,)).fetchone()
    return job_to_summary(row)


def fail_parse_job(job_id: str, error_message: str, worker: str | None) -> dict:
    with db_session() as conn:
        job = conn.execute("SELECT * FROM parse_jobs WHERE id = ?", (job_id,)).fetchone()
    if not job:
        raise HTTPException(status_code=404, detail="解析任务不存在。")
    now = utc_now()
    with db_session() as conn:
        conn.execute(
            """
            UPDATE documents
            SET status = 'failed', error_message = ?, updated_at = ?
            WHERE id = ?
            """,
            (error_message, now, job["document_id"]),
        )
        conn.execute(
            """
            UPDATE parse_jobs
            SET status = 'failed', worker = COALESCE(?, worker), error_message = ?, finished_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (worker, error_message, now, now, job_id),
        )
        row = conn.execute("SELECT * FROM parse_jobs WHERE id = ?", (job_id,)).fetchone()
    return job_to_summary(row)
