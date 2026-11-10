#!/usr/bin/env python3
"""Build a local, single-file Aetheria Online wiki (index.html).

Downloads the public wiki data from aetheria-online.in.th and embeds it into
template.html, so index.html opens straight from disk with no server.

    python3 build.py            # download fresh data, then build
    python3 build.py --offline  # rebuild from the cached files in ./cache
"""
import json
import pathlib
import subprocess
import sys

BASE = "https://aetheria-online.in.th"
HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / "cache"
SOURCES = {
    "wiki-data.json": "/wiki-data",
    "icons.json": "/art/icons/manifest.json",
    "monster-art.json": "/art/monsters/manifest.json",
}


def download():
    # curl uses the system certificate store, which python.org builds on macOS lack by default
    CACHE.mkdir(exist_ok=True)
    for name, path in SOURCES.items():
        subprocess.run(["curl", "-fsSL", "-A", "Mozilla/5.0 (local wiki builder)", "-o", str(CACHE / name), BASE + path], check=True)
        print("downloaded", path)


def load(name):
    return json.loads((CACHE / name).read_text(encoding="utf-8"))


def build():
    wiki = load("wiki-data.json")
    icons = load("icons.json")
    art = load("monster-art.json")
    data = {
        "generatedAt": wiki.get("generatedAt"),
        "items": wiki["items"],
        "monsters": wiki["monsters"],
        "elements": wiki["elements"],
        "maps": wiki["maps"],
        "skillBook": wiki["skillBook"],
        "stones": {"list": wiki["stones"].get("list", [])},
        "icons": {"items": icons.get("items", {}), "skills": icons.get("skills", {})},
        "monsterArt": {k: v.get("file") for k, v in art.items() if isinstance(v, dict)},
    }
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = (HERE / "template.html").read_text(encoding="utf-8").replace("/*__DATA__*/null", blob)
    (HERE / "index.html").write_text(html, encoding="utf-8")
    print(f"wrote index.html ({len(html) / 1e6:.1f} MB)")


if __name__ == "__main__":
    if "--offline" not in sys.argv:
        download()
    build()
