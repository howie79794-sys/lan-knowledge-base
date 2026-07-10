from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    data_dir: str = os.getenv("KB_DATA_DIR", "./data")
    upload_dir: str = os.getenv("KB_UPLOAD_DIR", os.path.join(os.getenv("KB_DATA_DIR", "./data"), "uploads"))
    processed_dir: str = os.getenv("KB_PROCESSED_DIR", os.path.join(os.getenv("KB_DATA_DIR", "./data"), "processed"))
    tmp_dir: str = os.getenv("KB_TMP_DIR", os.path.join(os.getenv("KB_DATA_DIR", "./data"), "tmp"))
    backup_dir: str = os.getenv("KB_BACKUP_DIR", os.path.join(os.getenv("KB_DATA_DIR", "./data"), "backups"))
    work_guides_dir: str = os.getenv("KB_WORK_GUIDES_DIR", os.path.join(os.getenv("KB_DATA_DIR", "./data"), "work-guides"))
    sqlite_path: str = os.getenv("KB_SQLITE_PATH", os.path.join(os.getenv("KB_DATA_DIR", "./data"), "kb.sqlite3"))
    max_upload_mb: int = int(os.getenv("KB_MAX_UPLOAD_MB", "300"))
    agent_read_token: str = os.getenv("KB_AGENT_READ_TOKEN", "change-me")
    allow_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv("KB_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    )


settings = Settings()


DOCUMENT_PURPOSES = [
    "招投标需求清单",
    "规划材料",
    "政策法规",
    "产品社区文档",
    "业务知识",
    "客户或特性案例",
    "业务材料",
    "竞品材料",
    "其他",
]


PURPOSE_ALIASES = {
    "客户案例": "客户或特性案例",
}


ALLOWED_EXTENSIONS = {
    ".pdf": "pdf",
    ".doc": "word",
    ".docx": "word",
    ".ppt": "ppt",
    ".pptx": "ppt",
    ".xls": "excel",
    ".xlsx": "excel",
    ".csv": "csv",
    ".txt": "text",
    ".md": "markdown",
    ".markdown": "markdown",
}
