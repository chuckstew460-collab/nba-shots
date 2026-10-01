"""Download the raw NBA shot files (2003-04 through 2024-25) into data/raw/.

Source: https://github.com/DomSamangy/NBA_Shots_04_25 (data originally pulled
from the NBA Stats API shotchartdetail endpoint). One zip per season.
"""
from pathlib import Path
import urllib.request

BASE = "https://raw.githubusercontent.com/DomSamangy/NBA_Shots_04_25/main/"
OUT = Path(__file__).resolve().parent.parent / "data" / "raw"
OUT.mkdir(parents=True, exist_ok=True)

for year in range(2004, 2026):
    name = f"NBA_{year}_Shots.csv.zip"
    dest = OUT / name
    if dest.exists():
        print("have", name)
        continue
    print("downloading", name)
    urllib.request.urlretrieve(BASE + name, dest)
