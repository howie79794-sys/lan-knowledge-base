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
                source_kind TEXT NOT NULL DEFAULT 'file',
                bundle_id TEXT,
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

            CREATE TABLE IF NOT EXISTS parse_jobs (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                status TEXT NOT NULL,
                worker TEXT,
                job_type TEXT NOT NULL DEFAULT 'standard',
                attempts INTEGER NOT NULL DEFAULT 0,
                requested_by TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id)
            );

            CREATE TABLE IF NOT EXISTS markdown_bundle_assets (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                source_ref TEXT NOT NULL,
                asset_path TEXT,
                asset_sha256 TEXT,
                mime_type TEXT,
                is_missing INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id),
                UNIQUE(document_id, source_ref)
            );

            CREATE TABLE IF NOT EXISTS document_folders (
                id TEXT PRIMARY KEY,
                purpose TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(purpose, path)
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

            CREATE TABLE IF NOT EXISTS wiki_compile_jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                job_type TEXT NOT NULL DEFAULT 'batch_local',
                source_document_id TEXT,
                purpose TEXT,
                total_documents INTEGER NOT NULL DEFAULT 0,
                compiled_pages INTEGER NOT NULL DEFAULT 0,
                worker TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                requested_by TEXT,
                result_page_id TEXT,
                error_message TEXT,
                started_at TEXT,
                created_at TEXT NOT NULL,
                finished_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(source_document_id) REFERENCES documents(id)
            );

            CREATE TABLE IF NOT EXISTS wiki_pages (
                id TEXT PRIMARY KEY,
                page_type TEXT NOT NULL,
                title TEXT NOT NULL,
                purpose TEXT,
                source_document_id TEXT,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                keywords TEXT,
                compile_method TEXT NOT NULL DEFAULT 'local',
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(source_document_id) REFERENCES documents(id)
            );

            CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
            CREATE INDEX IF NOT EXISTS idx_documents_format ON documents(file_format);
            CREATE INDEX IF NOT EXISTS idx_metadata_purpose ON document_metadata(purpose);
            CREATE INDEX IF NOT EXISTS idx_parse_jobs_status ON parse_jobs(status);
            CREATE INDEX IF NOT EXISTS idx_parse_jobs_document ON parse_jobs(document_id);
            CREATE INDEX IF NOT EXISTS idx_documents_bundle ON documents(bundle_id);
            CREATE INDEX IF NOT EXISTS idx_markdown_bundle_assets_document ON markdown_bundle_assets(document_id);
            CREATE INDEX IF NOT EXISTS idx_document_folders_purpose ON document_folders(purpose);
            CREATE INDEX IF NOT EXISTS idx_document_folders_path ON document_folders(path);
            CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_wiki_pages_type ON wiki_pages(page_type);
            CREATE INDEX IF NOT EXISTS idx_wiki_pages_purpose ON wiki_pages(purpose);
            CREATE INDEX IF NOT EXISTS idx_wiki_pages_source ON wiki_pages(source_document_id);
            CREATE INDEX IF NOT EXISTS idx_wiki_compile_status ON wiki_compile_jobs(status);
            CREATE INDEX IF NOT EXISTS idx_wiki_compile_source ON wiki_compile_jobs(source_document_id);
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(documents)").fetchall()}
        if "folder_path" not in columns:
            conn.execute("ALTER TABLE documents ADD COLUMN folder_path TEXT NOT NULL DEFAULT '/'")
        document_additions = {
            "source_kind": "TEXT NOT NULL DEFAULT 'file'",
            "bundle_id": "TEXT",
        }
        for name, definition in document_additions.items():
            if name not in columns:
                conn.execute(f"ALTER TABLE documents ADD COLUMN {name} {definition}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_path)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_bundle ON documents(bundle_id)")
        parse_job_columns = {row["name"] for row in conn.execute("PRAGMA table_info(parse_jobs)").fetchall()}
        if "job_type" not in parse_job_columns:
            conn.execute("ALTER TABLE parse_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'standard'")
        wiki_job_columns = {row["name"] for row in conn.execute("PRAGMA table_info(wiki_compile_jobs)").fetchall()}
        wiki_job_additions = {
            "job_type": "TEXT NOT NULL DEFAULT 'batch_local'",
            "source_document_id": "TEXT",
            "worker": "TEXT",
            "attempts": "INTEGER NOT NULL DEFAULT 0",
            "requested_by": "TEXT",
            "result_page_id": "TEXT",
            "started_at": "TEXT",
        }
        for name, definition in wiki_job_additions.items():
            if name not in wiki_job_columns:
                conn.execute(f"ALTER TABLE wiki_compile_jobs ADD COLUMN {name} {definition}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_wiki_compile_source ON wiki_compile_jobs(source_document_id)")
        wiki_page_columns = {row["name"] for row in conn.execute("PRAGMA table_info(wiki_pages)").fetchall()}
        if "compile_method" not in wiki_page_columns:
            conn.execute("ALTER TABLE wiki_pages ADD COLUMN compile_method TEXT NOT NULL DEFAULT 'local'")
