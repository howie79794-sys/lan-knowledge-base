from datetime import datetime, timezone
from uuid import uuid4

from app.db.session import db_session


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_audit(action: str, document_id: str | None = None, actor: str | None = None, ip: str | None = None, message: str | None = None) -> None:
    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO audit_logs (id, actor, action, document_id, ip, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid4()), actor, action, document_id, ip, message, utc_now()),
        )
