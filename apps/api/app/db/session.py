import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.core.config import settings


def get_connection() -> sqlite3.Connection:
    Path(settings.sqlite_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.sqlite_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db_session() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                file_ext TEXT NOT NULL,
                file_format TEXT NOT NULL,
                mime_type TEXT,
                size_bytes INTEGER NOT NULL,
                checksum_sha256 TEXT NOT NULL,
                storage_path TEXT NOT NULL,
                folder_path TEXT NOT NULL DEFAULT '/',
                status TEXT NOT NULL,
                content_excerpt TEXT,
                search_text TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS document_metadata (
                document_id TEXT PRIMARY KEY,
                purpose TEXT NOT NULL,
                source TEXT,
                project TEXT,
                confidentiality TEXT NOT NULL DEFAULT 'internal',
                uploader_name TEXT,
                FOREIGN KEY(document_id) REFERENCES documents(id)
            );

            CREATE TABLE IF NOT EXISTS processed_artifacts (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                artifact_type TEXT NOT NULL,
                path TEXT NOT NULL,
                parser TEXT NOT NULL,
                parse_status TEXT NOT NULL,
                error_message TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id)
            );

            CREATE TABLE IF NOT EXISTS conversion_jobs (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id)
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                actor TEXT,
                action TEXT NOT NULL,
                document_id TEXT,
                ip TEXT,
                message TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
            CREATE INDEX IF NOT EXISTS idx_documents_format ON documents(file_format);
            CREATE INDEX IF NOT EXISTS idx_metadata_purpose ON document_metadata(purpose);
            CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(documents)").fetchall()}
        if "folder_path" not in columns:
            conn.execute("ALTER TABLE documents ADD COLUMN folder_path TEXT NOT NULL DEFAULT '/'")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_path)")
