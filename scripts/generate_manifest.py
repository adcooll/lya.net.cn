#!/usr/bin/env python3
"""Generate a static media manifest from media/public."""

from __future__ import annotations

import json
import re
import subprocess
from datetime import date
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "media" / "public"
OUTPUT = ROOT / "photos.generated.js"
METADATA_PATH = ROOT / "media" / "photo-metadata.json"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}


def build_version() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S")


def title_from_stem(stem: str) -> str:
    text = re.sub(r"[-_]+", " ", stem).strip()
    return text[:1].upper() + text[1:] if text else "Untitled"


def public_path(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def find_thumb(path: Path) -> str | None:
    candidates = [
        path.with_name(f"{path.stem}.jpg"),
        path.with_name(f"{path.stem}.jpeg"),
        path.with_name(f"{path.stem}.webp"),
        path.with_name(f"{path.stem}-thumb.jpg"),
        path.with_name(f"{path.stem}-thumb.webp"),
    ]
    for candidate in candidates:
        if candidate.exists() and candidate != path:
            return public_path(candidate)
    return None


def read_sips_metadata(path: Path) -> dict[str, str]:
    keys = ["pixelWidth", "pixelHeight", "creation", "latitude", "longitude"]
    result = subprocess.run(
        ["sips", *sum((["-g", key] for key in keys), []), str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    metadata: dict[str, str] = {}
    if result.returncode != 0:
        return metadata
    for line in result.stdout.splitlines():
        if ":" not in line:
            continue
        key, value = line.strip().split(":", 1)
        value = value.strip()
        if key in keys and value != "<nil>":
            metadata[key] = value
    return metadata


def parse_creation(value: str | None) -> str:
    if not value:
        return date.today().isoformat()
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    return date.today().isoformat()


def metadata_location(metadata: dict[str, str]) -> str:
    latitude = metadata.get("latitude")
    longitude = metadata.get("longitude")
    if latitude and longitude:
        return f"{latitude}, {longitude}"
    return "地点未提供"


def display_dimensions(width: int, height: int) -> tuple[int, int]:
    ratio = width / max(height, 1)
    if ratio < 0.52:
        return 9, 16
    if ratio > 1.85:
        return 16, 9
    return width, height


def load_metadata() -> dict[str, dict[str, str]]:
    if not METADATA_PATH.exists():
        return {}
    with METADATA_PATH.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}


def build_item(path: Path, index: int, metadata_overrides: dict[str, dict[str, str]]) -> dict:
    media_type = "video" if path.suffix.lower() in VIDEO_EXTS else "photo"
    metadata = read_sips_metadata(path) if media_type == "photo" else {}
    override = metadata_overrides.get(public_path(path), {})
    width = int(metadata.get("pixelWidth") or 4)
    height = int(metadata.get("pixelHeight") or 3)
    display_width, display_height = display_dimensions(width, height)
    album = path.parent.name if path.parent != PUBLIC_DIR else "成长"
    if album == "photos-app":
        album = "LYA"
    title = f"{album} {index:02d}" if album == "LYA" else title_from_stem(path.stem)
    item = {
        "id": re.sub(r"[^a-zA-Z0-9_-]+", "-", path.stem).strip("-") or f"media-{index}",
        "type": media_type,
        "title": title,
        "album": album,
        "date": override.get("date") or parse_creation(metadata.get("creation")),
        "location": override.get("location") or metadata_location(metadata),
        "description": "从 Mac 照片 App 筛选后导出的发布版素材。",
        "tags": ["孩子"],
        "src": public_path(path),
        "thumb": public_path(path),
        "width": display_width,
        "height": display_height,
        "originalWidth": width,
        "originalHeight": height,
    }
    if media_type == "video":
        item["thumb"] = find_thumb(path) or ""
        item["album"] = "视频" if item["album"] == "public" else item["album"]
        item["width"] = 9
        item["height"] = 16
    return item


def load_exported_manifests() -> list[dict]:
    items: list[dict] = []
    for manifest_path in sorted(PUBLIC_DIR.rglob("photos-app-manifest.json")):
        with manifest_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, list):
            items.extend(item for item in data if isinstance(item, dict))
    return items


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    exported_items = load_exported_manifests()
    if exported_items:
        data = {
            "title": "LYA Photo",
            "domain": "lya.net.cn",
            "version": build_version(),
            "intro": "给孩子的成长片段留一个安静、好翻看的地方。",
            "photos": exported_items,
        }
        OUTPUT.write_text(
            "window.PHOTO_SITE = "
            + json.dumps(data, ensure_ascii=False, indent=2)
            + ";\n",
            encoding="utf-8",
        )
        print(f"Generated {OUTPUT.name} with {len(exported_items)} Photos App items.")
        return

    video_stems = {
        path.with_suffix("").as_posix()
        for path in PUBLIC_DIR.rglob("*")
        if path.is_file() and path.suffix.lower() in VIDEO_EXTS
    }
    files = [
        path
        for path in sorted(PUBLIC_DIR.rglob("*"))
        if path.is_file() and path.suffix.lower() in IMAGE_EXTS | VIDEO_EXTS
        and not (
            path.suffix.lower() in IMAGE_EXTS
            and (
                path.with_suffix("").as_posix() in video_stems
                or path.stem.endswith("-thumb")
                and path.with_name(path.stem.removesuffix("-thumb")).as_posix() in video_stems
            )
        )
    ]
    metadata_overrides = load_metadata()
    items = [
        build_item(path, index, metadata_overrides)
        for index, path in enumerate(files, start=1)
    ]
    items.sort(key=lambda item: (item["date"], item["id"]), reverse=True)
    for index, item in enumerate(items, start=1):
        if item["album"] == "LYA":
            item["title"] = f"LYA {index:02d}"
    if items:
        items[0]["featured"] = True

    data = {
        "title": "LYA Photo",
        "domain": "lya.net.cn",
        "version": build_version(),
        "intro": "给孩子的成长片段留一个安静、好翻看的地方。",
        "photos": items,
    }
    OUTPUT.write_text(
        "window.PHOTO_SITE = "
        + json.dumps(data, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Generated {OUTPUT.name} with {len(items)} media items.")


if __name__ == "__main__":
    main()
