from datetime import datetime, timezone
from uuid import uuid4

from app.db.session import db_session

AUDITED_ACTIONS = {
    "upload",
    "delete",
    "create_parse_job",
    "create_parse_jobs_batch",
    "claim_parse_job",
    "cancel_parse_job",
    "complete_parse_job",
    "fail_parse_job",
    "create_folder",
    "delete_folder",
    "move_document",
}

MAX_AUDIT_LOGS = 1000


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_audit(action: str, document_id: str | None = None, actor: str | None = None, ip: str | None = None, message: str | None = None) -> None:
    if action not in AUDITED_ACTIONS:
        return
    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO audit_logs (id, actor, action, document_id, ip, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid4()), actor, action, document_id, ip, message, utc_now()),
        )
        conn.execute(
            """
            DELETE FROM audit_logs
            WHERE id NOT IN (
                SELECT id FROM audit_logs ORDER BY created_at DESC LIMIT ?
            )
            """,
            (MAX_AUDIT_LOGS,),
        )
