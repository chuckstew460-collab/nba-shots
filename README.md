# Deep Range: The Death of the Mid-Range

A data story and an interactive dashboard about the NBA's 3-point revolution, built on
**every regular-season NBA shot from 2003-04 through 2024-25** (4.45 million rows).

- **Live site:** https://chuckstew460-collab.github.io/nba-shots/
- **Report:** [`index.html`](index.html): a playable court at the top (arrow keys move, Space shoots, D dunks), headline numbers, 12 findings each with an interactive chart, a draggable season-by-season shot-chart timeline, and a data & methods section
- **Dashboard:** [`dashboard.html`](dashboard.html): filter by season, team, court zone, shot type, quarter and home/away; switch the measure and the breakdown; every number, chart and table recalculates in the browser

## Where the data comes from

The shots come from the NBA's official stats API (the `shotchartdetail` endpoint), as collected and
published by Dom Samangy in the GitHub repository
[DomSamangy/NBA_Shots_04_25](https://github.com/DomSamangy/NBA_Shots_04_25): one zipped CSV per regular
season. `scripts/download_data.py` downloads the 22 files unchanged into `data/raw/`.

**One row = one field-goal attempt.** That means a player and team in a game on a date in a season, with the
quarter and clock, the x/y court location in feet, the shot distance, the NBA zone labels, a description of the
shot, 2PT or 3PT, and made or missed.

| Requirement | This data set |
|---|---|
| Panel / event data | One row per shot event, with its date/season (time) and team/player (group) |
| Time periods | 22 seasons (2003-04 to 2024-25); game dates within each |
| Groups | 30 franchises, 2,265 players |
| Rows | 4,450,789 raw (4,441,371 after cleaning) |
| Columns | 26 (24 in the 2024-25 file) |
| Categorical columns to filter on | team, season, court zone, shot type (action), quarter, home/away, 2PT/3PT |
| Numeric columns to total / average / rank | shot made (0/1), points, shot distance, x/y location |

## Files

| File | What it does |
|---|---|
| `index.html` | The report page (opens at the site URL): title, summary, headline numbers, 12 finding sections with charts, interactive timeline, and the "About the data" section |
| `dashboard.html` | The dashboard page: filters, summary tiles, measure and breakdown switches, five charts, a sortable table with CSV download, and a reset button |
| `css/style.css` | One stylesheet shared by both pages: navigation bar, fonts (Oswald + Inter), colors, cards, tooltips, tables, dashboard controls |
| `js/common.js` | Helpers shared by both pages: number formatting, the hover tooltip, data tables, court drawing, hexagon shapes, the points-per-shot color scale, zone colors |
| `js/shooter.js` | The basketball animation engine: a side-view court and hoop, a jointed player figure that runs, shoots (standard jumper, pull-up, step-back) and dunks, and balls that fly on a gravity arc and swish through the net. Player profiles set height, build, jersey colors and number, and motion cues. Used by the playable court at the top of the report and the pick-a-shooter stage in section 9 |
| `js/report.js` | Builds every chart on the report from `data/processed/report.json` (D3), including the draggable timeline and the headline tiles |
| `js/dashboard.js` | Loads the dashboard data, applies the filters, does all calculations in the browser, and draws the tiles, charts and table |
| `favicon.svg` | The basketball icon shown in the browser tab |
| `scripts/download_data.py` | Downloads the 22 raw season files from the source repository into `data/raw/` |
| `scripts/process_data.py` | Cleans the raw shots and writes every file in `data/processed/` (see "Cleaning" below) |
| `requirements.txt` | Python packages needed to run the scripts |
| `data/raw/NBA_<year>_Shots.csv.zip` | The 22 untouched raw files, one per season (`2004` = the 2003-04 season … `2025` = 2024-25) |
| `data/processed/report.json` | Every number and chart series used on the report page (league by season, zones, distance curve, teams, players and each top shooter's 3-point mix, shot types, clutch, home/away, timeline hexagons, headline numbers) |
| `data/processed/cube.csv` | The dashboard's main data: shots summed by season × team × zone × quarter × home/away × shot type (125,612 rows; columns: attempts, makes, 3PA, 3PM, points, total distance) |
| `data/processed/games.csv` | Games played by each team in each season, split home/away (denominator for "per game") |
| `data/processed/teams.csv` | Franchise code → current team name |
| `data/processed/bins.csv` | Shot locations grouped into 1.6 ft hexagons by season × team × zone, for the dashboard shot map |
| `.gitignore` | Keeps Python cache files out of the repository |

## Cleaning (all in `scripts/process_data.py`)

- Dropped **9,337 backcourt heaves** (zone "Backcourt") and **81 "No Shot" rows**, leaving 4,441,371 shots. Heaves are kept only for player 3-point totals, so those match official counts.
- **Rescaled court coordinates for 2019-20, 2020-21 and 2021-22.** Those files store x/y on a different scale. Using `x*10` and `y*10 - 52.5` reproduces the recorded shot distance for all 594,667 of those shots.
- Games identified by ID + date + teams (five 2020-21 games share the placeholder ID `22000000`).
- Franchises mapped to their 2024-25 names (e.g. Seattle SuperSonics → Oklahoma City Thunder); home/away from the team abbreviation.
- The 69 shot descriptions grouped into 9 shot types; quarters 5+ grouped as "OT".

Every rate is defined in the report's **About the data** section: FG% = makes ÷ attempts; points per shot = (2 × made 2s + 3 × made 3s) ÷ attempts; eFG% = (makes + 0.5 × made 3s) ÷ attempts; 3-point share = 3PA ÷ attempts; per game = attempts ÷ team-games.

## Rebuild it yourself

```bash
pip install -r requirements.txt
python scripts/download_data.py     # skips files already in data/raw/
python scripts/process_data.py      # writes data/processed/*
python -m http.server               # then open http://localhost:8000
```

The site is plain HTML, CSS and JavaScript, using [D3 v7](https://d3js.org/) from cdnjs and Google Fonts. There is no build step. GitHub Pages serves it from the `main` branch.
