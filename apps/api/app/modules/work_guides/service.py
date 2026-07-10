from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
import re
from typing import Any

import yaml

from app.core.config import settings


MARKDOWN_EXTENSIONS = {".md", ".markdown"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"}


def list_work_guides(q: str | None = None, category: str | None = None) -> dict[str, Any]:
    guides = [_read_guide(markdown_path, slug, guide_dir) for slug, markdown_path, guide_dir in _discover_guides()]
    active_guides = [guide for guide in guides if guide["status"] == "active"]
    categories = sorted({item for guide in active_guides for item in guide["categories"]})

    normalized_query = (q or "").strip().casefold()
    normalized_category = (category or "").strip()
    filtered = active_guides
    if normalized_category:
        filtered = [guide for guide in filtered if normalized_category in guide["categories"]]
    if normalized_query:
        filtered = [guide for guide in filtered if normalized_query in _search_text(guide)]

    filtered.sort(key=lambda guide: (not guide["pinned"], -guide["_updated_timestamp"], guide["title"]))
    return {
        "total": len(filtered),
        "categories": categories,
        "guides": [_public_guide(guide, include_content=False) for guide in filtered],
    }


def get_work_guide(slug: str) -> dict[str, Any]:
    for discovered_slug, markdown_path, guide_dir in _discover_guides():
        if discovered_slug == slug:
            return _public_guide(_read_guide(markdown_path, discovered_slug, guide_dir), include_content=True)
    raise FileNotFoundError("工作指引不存在。")


def work_guide_asset_path(slug: str, asset_path: str) -> Path:
    guide_dir = _guide_directory(slug)
    base = guide_dir.resolve()
    target = (base / asset_path).resolve()
    if target == base or base not in target.parents:
        raise FileNotFoundError("工作指引图片不存在。")
    if not target.is_file() or target.suffix.lower() not in IMAGE_EXTENSIONS:
        raise FileNotFoundError("工作指引图片不存在。")
    return target


def _discover_guides() -> list[tuple[str, Path, Path]]:
    root = Path(settings.work_guides_dir)
    if not root.exists():
        return []

    discovered: dict[str, tuple[Path, Path]] = {}
    for child in sorted(root.iterdir(), key=lambda path: path.name.casefold()):
        if child.name.startswith(".") or not child.is_dir():
            continue
        index_path = next((child / name for name in ("index.md", "index.markdown") if (child / name).is_file()), None)
        if index_path:
            discovered[child.name] = (index_path, child)

    for child in sorted(root.iterdir(), key=lambda path: path.name.casefold()):
        if child.name.startswith(".") or not child.is_file() or child.suffix.lower() not in MARKDOWN_EXTENSIONS:
            continue
        discovered.setdefault(child.stem, (child, root))

    return [(slug, paths[0], paths[1]) for slug, paths in discovered.items()]


def _guide_directory(slug: str) -> Path:
    for discovered_slug, _markdown_path, guide_dir in _discover_guides():
        if discovered_slug == slug:
            return guide_dir
    raise FileNotFoundError("工作指引不存在。")


def _read_guide(markdown_path: Path, slug: str, guide_dir: Path) -> dict[str, Any]:
    raw_text = markdown_path.read_text(encoding="utf-8-sig")
    metadata, content = _split_front_matter(raw_text)
    title = _text_value(metadata.get("title")) or _extract_title(content) or slug
    summary = _text_value(metadata.get("summary")) or _extract_summary(content)
    content = _remove_redundant_title(content, title)
    categories = _normalize_categories(metadata.get("categories", metadata.get("category")))
    updated_at, updated_timestamp = _normalize_date(metadata.get("updated_at"), markdown_path.stat().st_mtime)
    effective_date = _optional_date(metadata.get("effective_date"))
    status = (_text_value(metadata.get("status")) or "active").casefold()
    if status in {"published", "enabled"}:
        status = "active"

    return {
        "slug": slug,
        "title": title,
        "summary": summary or "暂无内容概要。",
        "categories": categories or ["未分类"],
        "version": _text_value(metadata.get("version")) or None,
        "effective_date": effective_date,
        "updated_at": updated_at,
        "status": status,
        "pinned": _normalize_bool(metadata.get("pinned", False)),
        "content": content.strip(),
        "_updated_timestamp": updated_timestamp,
        "_guide_dir": str(guide_dir),
    }


def _split_front_matter(raw_text: str) -> tuple[dict[str, Any], str]:
    if not raw_text.startswith("---"):
        return {}, raw_text
    match = re.match(r"^---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)(.*)$", raw_text, flags=re.DOTALL)
    if not match:
        return {}, raw_text
    try:
        metadata = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return {}, raw_text
    return (metadata if isinstance(metadata, dict) else {}), match.group(2)


def _normalize_categories(value: Any) -> list[str]:
    values: list[Any]
    if isinstance(value, list):
        values = value
    elif isinstance(value, str):
        values = re.split(r"[,，]", value)
    elif value is None:
        values = []
    else:
        values = [value]
    categories: list[str] = []
    for item in values:
        category = _text_value(item)
        if category and category not in categories:
            categories.append(category)
    return categories


def _extract_title(content: str) -> str:
    match = re.search(r"^#\s+(.+?)\s*$", content, flags=re.MULTILINE)
    return _strip_markdown(match.group(1)) if match else ""


def _remove_redundant_title(content: str, title: str) -> str:
    match = re.match(r"^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)", content)
    if match and _strip_markdown(match.group(1)).casefold() == title.casefold():
        return content[match.end() :].lstrip()
    return content


def _extract_summary(content: str) -> str:
    cleaned_content = re.sub(r"```.*?```", "", content, flags=re.DOTALL)
    for paragraph in re.split(r"\r?\n\s*\r?\n", cleaned_content):
        text = paragraph.strip()
        if not text or text.startswith(("#", "![", "|", ">")):
            continue
        text = re.sub(r"^[-*+]\s+", "", text)
        summary = _strip_markdown(text.replace("\n", " "))
        if summary:
            return summary[:157] + "..." if len(summary) > 160 else summary
    return ""


def _strip_markdown(value: str) -> str:
    value = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"[`*_~]", "", value)
    return re.sub(r"\s+", " ", value).strip()


def _text_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().casefold() in {"1", "true", "yes", "on"}
    return bool(value)


def _optional_date(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value).strip() or None


def _normalize_date(value: Any, fallback_timestamp: float) -> tuple[str, float]:
    if isinstance(value, datetime):
        return value.isoformat(), value.timestamp()
    if isinstance(value, date):
        parsed = datetime.combine(value, datetime.min.time())
        return value.isoformat(), parsed.timestamp()
    if value not in (None, ""):
        text = str(value).strip()
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return text, parsed.timestamp()
        except ValueError:
            return text, fallback_timestamp
    fallback = datetime.fromtimestamp(fallback_timestamp).astimezone()
    return fallback.isoformat(), fallback_timestamp


def _search_text(guide: dict[str, Any]) -> str:
    return " ".join(
        [guide["title"], guide["summary"], " ".join(guide["categories"]), guide["content"]]
    ).casefold()


def _public_guide(guide: dict[str, Any], include_content: bool) -> dict[str, Any]:
    fields = {
        "slug",
        "title",
        "summary",
        "categories",
        "version",
        "effective_date",
        "updated_at",
        "status",
        "pinned",
    }
    result = {key: guide[key] for key in fields}
    if include_content:
        result["content"] = guide["content"]
    return result
