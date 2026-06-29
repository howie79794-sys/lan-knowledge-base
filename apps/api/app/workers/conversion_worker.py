from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.config import settings
from app.db.session import db_session
from app.modules.artifacts.parsers import parse_document


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def process_document(document_id: str) -> None:
    with db_session() as conn:
        doc = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not doc:
            return
        job_id = str(uuid4())
        conn.execute(
            """
            INSERT INTO conversion_jobs (id, document_id, status, attempts, started_at, created_at)
            VALUES (?, ?, 'running', 1, ?, ?)
            """,
            (job_id, document_id, utc_now(), utc_now()),
        )
        conn.execute("UPDATE documents SET status = 'processing', updated_at = ? WHERE id = ?", (utc_now(), document_id))

    source_path = Path(settings.upload_dir) / doc["storage_path"]
    output_dir = Path(settings.processed_dir) / document_id
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        result = parse_document(source_path, doc["file_format"])
        markdown_path = output_dir / "content.md"
        text_path = output_dir / "content.txt"
        metadata_path = output_dir / "metadata.json"
        markdown_path.write_text(result.markdown, encoding="utf-8")
        text_path.write_text(result.text, encoding="utf-8")
        metadata_path.write_text(
            json.dumps({"parser": result.parser, "source": doc["original_filename"]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        excerpt = result.text[:400]
        with db_session() as conn:
            conn.execute(
                """
                UPDATE documents
                SET status = 'ready', content_excerpt = ?, search_text = ?, error_message = NULL, updated_at = ?
                WHERE id = ?
                """,
                (excerpt, result.text[:20000], utc_now(), document_id),
            )
            conn.execute(
                """
                INSERT INTO processed_artifacts (id, document_id, artifact_type, path, parser, parse_status, created_at)
                VALUES (?, ?, 'markdown', ?, ?, 'ready', ?)
                """,
                (str(uuid4()), document_id, f"{document_id}/content.md", result.parser, utc_now()),
            )
            conn.execute(
                """
                UPDATE conversion_jobs
                SET status = 'succeeded', finished_at = ?
                WHERE id = ?
                """,
                (utc_now(), job_id),
            )
    except Exception as exc:
        message = str(exc)
        with db_session() as conn:
            conn.execute(
                """
                UPDATE documents
                SET status = 'failed', error_message = ?, updated_at = ?
                WHERE id = ?
                """,
                (message, utc_now(), document_id),
            )
            conn.execute(
                """
                UPDATE conversion_jobs
                SET status = 'failed', error_message = ?, finished_at = ?
                WHERE id = ?
                """,
                (message, utc_now(), job_id),
            )
