"""Stamp a new cache-busting version on the site's CSS, JS and data URLs.

Browsers may keep a copy of each file for a few minutes; after an update that can
mix an old script with new data. Every asset URL carries ?v=<version>, so bumping
the version makes browsers fetch matching copies of everything.

Run after changing any site file or data:  python scripts/bump_version.py
"""
from datetime import datetime
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
version = datetime.now().strftime("%Y%m%d%H%M")

for name in ["index.html", "dashboard.html"]:
    p = ROOT / name
    s = p.read_text(encoding="utf-8")
    s = re.sub(r'(href="css/style\.css)(\?v=[^"]*)?"', rf'\1?v={version}"', s)
    s = re.sub(r'(src="js/[a-z]+\.js)(\?v=[^"]*)?"', rf'\1?v={version}"', s)
    p.write_text(s, encoding="utf-8")

common = ROOT / "js" / "common.js"
s = common.read_text(encoding="utf-8")
s = re.sub(r'const SITE_VERSION = "[^"]*";', f'const SITE_VERSION = "{version}";', s)
common.write_text(s, encoding="utf-8")
print("version", version)
