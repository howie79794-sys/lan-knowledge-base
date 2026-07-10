from pathlib import Path

from app.core.config import settings


def ensure_data_dirs() -> None:
    for path in [
        settings.data_dir,
        settings.upload_dir,
        settings.processed_dir,
        settings.tmp_dir,
        settings.backup_dir,
        settings.work_guides_dir,
        Path(settings.sqlite_path).parent,
    ]:
        Path(path).mkdir(parents=True, exist_ok=True)


def safe_relative_path(base: str, path: str) -> Path:
    base_path = Path(base).resolve()
    target = (base_path / path).resolve()
    if base_path not in target.parents and target != base_path:
        raise ValueError("Path escapes configured data directory")
    return target
