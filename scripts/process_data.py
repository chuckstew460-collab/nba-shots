"""Clean the raw shot files and build the data files the website reads.

Inputs : data/raw/NBA_<year>_Shots.csv.zip  (one zip per season, 2004-2025)
Outputs: data/processed/report.json   numbers + chart data for index.html
         data/processed/cube.csv      shots summed by season x team x zone x home/away (dashboard)
         data/processed/games.csv     games per team, season and home/away (dashboard per-game)
         data/processed/teams.csv     team code -> name (dashboard)
         data/processed/bins.csv      hex-binned shot locations by the same four filters, as codes (dashboard map)
         data/processed/bins_key.json codes -> seasons, teams, zones, home/away, hexagon centres

Run:  python scripts/process_data.py
"""
from pathlib import Path
import json
import zipfile

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------- load
def load_raw() -> pd.DataFrame:
    frames = []
    for year in range(2004, 2026):
        z = zipfile.ZipFile(RAW / f"NBA_{year}_Shots.csv.zip")
        name = [n for n in z.namelist() if not n.startswith("__")][0]
        frames.append(pd.read_csv(z.open(name)))
    return pd.concat(frames, ignore_index=True)


def action_group(a: str) -> str:
    """Collapse the 70 NBA play-by-play shot descriptions into 9 families."""
    a = a.lower()
    if "dunk" in a:
        return "Dunk"
    if "tip" in a:
        return "Tip-in"
    if "layup" in a or "finger roll" in a:
        return "Layup"
    if "hook" in a:
        return "Hook"
    if "floating" in a:
        return "Floater"
    if "step back" in a:
        return "Step-back jumper"
    if "pullup" in a or "pull-up" in a:
        return "Pull-up jumper"
    if "fadeaway" in a or "turnaround" in a:
        return "Fadeaway / turnaround"
    return "Other jumper"


ZONE_LABEL = {
    "Restricted Area": "Restricted area",
    "In The Paint (Non-RA)": "Paint (non-RA)",
    "Mid-Range": "Mid-range",
    "Left Corner 3": "Corner 3",
    "Right Corner 3": "Corner 3",
    "Above the Break 3": "Above-break 3",
}


def clean(d: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    log = {"raw_rows": int(len(d))}

    # a handful of 2020-21 games share the placeholder GAME_ID 22000000, so a game
    # is identified by id + date + home team + away team
    d["game"] = (d["GAME_ID"].astype(str) + "|" + d["GAME_DATE"] + "|"
                 + d["HOME_TEAM"] + "|" + d["AWAY_TEAM"])

    # drop backcourt heaves (end-of-quarter desperation shots) and 'No Shot' rows
    bc = d["BASIC_ZONE"].eq("Backcourt")
    ns = d["ACTION_TYPE"].eq("No Shot")
    log["dropped_backcourt"] = int(bc.sum())
    log["dropped_no_shot"] = int((ns & ~bc).sum())
    d = d[~bc & ~ns].copy()
    log["clean_rows"] = int(len(d))

    d["season"] = d["SEASON_2"]
    d["year"] = d["SEASON_1"]

    # 2019-20, 2020-21 and 2021-22 store court coordinates on a different scale
    # (x max ~2.5 instead of 25). Rescaling with x*10 and y*10 - 52.5 reproduces the
    # recorded SHOT_DISTANCE for every one of those shots, exactly as in other seasons.
    bad = d["year"].isin([2020, 2021, 2022])
    log["rescaled_coordinates"] = int(bad.sum())
    d.loc[bad, "LOC_X"] = d.loc[bad, "LOC_X"] * 10
    d.loc[bad, "LOC_Y"] = d.loc[bad, "LOC_Y"] * 10 - 52.5
    d["made"] = d["SHOT_MADE"].astype(bool).astype(int)
    d["is3"] = d["SHOT_TYPE"].eq("3PT Field Goal").astype(int)
    d["pts"] = d["made"] * np.where(d["is3"] == 1, 3, 2)
    d["zone"] = d["BASIC_ZONE"].map(ZONE_LABEL)
    d["action"] = d["ACTION_TYPE"].map(action_group)
    d["period"] = np.where(d["QUARTER"] >= 5, "OT", "Q" + d["QUARTER"].astype(str))
    d["dist"] = d["SHOT_DISTANCE"].clip(upper=40)

    # franchise names: use the 2024-25 name for every TEAM_ID (Sonics -> Thunder, etc.)
    latest = d.sort_values("year").groupby("TEAM_ID")["TEAM_NAME"].last()
    d["team"] = d["TEAM_ID"].map(latest)

    # team abbreviation per season = the abbreviation present in every one of its games
    games = d.drop_duplicates(["year", "TEAM_ID", "game"])
    ab = pd.concat([games[["year", "TEAM_ID", "HOME_TEAM"]].rename(columns={"HOME_TEAM": "ab"}),
                    games[["year", "TEAM_ID", "AWAY_TEAM"]].rename(columns={"AWAY_TEAM": "ab"})])
    ab = (ab.value_counts().reset_index().sort_values("count", ascending=False)
            .drop_duplicates(["year", "TEAM_ID"]).set_index(["year", "TEAM_ID"])["ab"])
    d = d.join(ab, on=["year", "TEAM_ID"])
    d["loc"] = np.where(d["ab"] == d["HOME_TEAM"], "Home", "Away")

    # short franchise code = the team's 2024-25 abbreviation (keeps dashboard files small)
    code = d[d.year == d.year.max()].groupby("TEAM_ID")["ab"].first()
    d["code"] = d["TEAM_ID"].map(code)
    return d, log


# ---------------------------------------------------------------- helpers
def agg(g):
    return g.agg(fga=("made", "size"), fgm=("made", "sum"), pts=("pts", "sum"),
                 fg3a=("is3", "sum"), dist_sum=("dist", "sum"))


def rates(t: pd.DataFrame) -> pd.DataFrame:
    t = t.copy()
    t["fg_pct"] = t.fgm / t.fga
    t["pps"] = t.pts / t.fga
    t["avg_dist"] = t.dist_sum / t.fga
    t["three_share"] = t.fg3a / t.fga
    return t


def recs(t: pd.DataFrame, nd=4):
    return json.loads(t.round(nd).to_json(orient="records"))


def hexbin(x, y, r):
    """Assign points to pointy-top hexagons of radius r; returns centre coords."""
    w = np.sqrt(3) * r
    h = 1.5 * r
    row = np.round(y / h)
    off = np.where(row % 2 == 0, 0.0, w / 2)
    col = np.round((x - off) / w)
    cx, cy = col * w + off, row * h
    # check the neighbouring rows too and keep the nearest centre
    best_x, best_y = cx, cy
    best_d = (x - cx) ** 2 + (y - cy) ** 2
    for dr in (-1, 1):
        r2 = row + dr
        off2 = np.where(r2 % 2 == 0, 0.0, w / 2)
        c2 = np.round((x - off2) / w)
        cx2, cy2 = c2 * w + off2, r2 * h
        d2 = (x - cx2) ** 2 + (y - cy2) ** 2
        m = d2 < best_d
        best_x, best_y, best_d = np.where(m, cx2, best_x), np.where(m, cy2, best_y), np.where(m, d2, best_d)
    return np.round(best_x, 2), np.round(best_y, 2)


# ---------------------------------------------------------------- report
def build_report(d: pd.DataFrame, raw: pd.DataFrame, log: dict) -> dict:
    R = {"log": log}
    seasons = sorted(d.season.unique())
    R["seasons"] = seasons

    # league by season
    g = rates(agg(d.groupby("season")))
    gp = d.groupby("season").game.nunique().rename("games")
    g = g.join(gp)
    g["team_games"] = g.games * 2
    g["fga_pg"] = g.fga / g.team_games
    g["fg3a_pg"] = g.fg3a / g.team_games
    g["pts_pg"] = g.pts / g.team_games
    g3m = d[d.is3 == 1].groupby("season").made.sum()
    g["fg3m"] = g3m
    g["fg3_pct"] = g3m / g.fg3a
    g["fg2_pct"] = (g.fgm - g3m) / (g.fga - g.fg3a)
    g["efg"] = (g.fgm + 0.5 * g3m) / g.fga
    R["league"] = recs(g.reset_index())

    # zone mix + efficiency by season
    z = rates(agg(d.groupby(["season", "zone"]))).reset_index()
    z["share"] = z.fga / z.groupby("season").fga.transform("sum")
    R["zones"] = recs(z[["season", "zone", "fga", "share", "fg_pct", "pps"]])

    # distance curve (pooled and first/last season)
    dd = d[d.dist <= 35]
    curve = rates(agg(dd.groupby(["dist"]))).reset_index()
    R["distance"] = recs(curve[["dist", "fga", "fg_pct", "pps", "three_share"]])
    hist = dd.groupby(["season", "dist"]).size().rename("n").reset_index()
    hist["share"] = hist.n / hist.groupby("season").n.transform("sum")
    R["dist_hist"] = recs(hist)

    # team x season three-share heatmap + who led each year
    t = rates(agg(d.groupby(["team", "season"]))).reset_index()
    then = d.groupby(["team", "season"]).TEAM_NAME.agg(lambda s: s.mode()[0]).rename("name_then")
    t = t.join(then, on=["team", "season"])
    R["teams"] = recs(t[["team", "season", "name_then", "fga", "three_share", "pps", "fg_pct"]])

    # players: 3PM leaders per season + volume shooters. Uses every shot (backcourt
    # heaves included) so player totals line up with official box-score counts.
    r3 = raw[raw.SHOT_TYPE.eq("3PT Field Goal")]
    p3 = (r3.groupby(["SEASON_2", "PLAYER_ID"])
            .agg(PLAYER_NAME=("PLAYER_NAME", "last"), fg3a=("SHOT_MADE", "size"), fg3m=("SHOT_MADE", "sum"))
            .reset_index().rename(columns={"SEASON_2": "season"}))
    p3["fg3m"] = p3.fg3m.astype(int)
    p3["fg3_pct"] = p3.fg3m / p3.fg3a
    lead = p3.sort_values("fg3m", ascending=False).drop_duplicates("season").sort_values("season")
    vol = p3.groupby("season").apply(lambda x: pd.Series({
        "p300": int((x.fg3a >= 300).sum()), "p500": int((x.fg3a >= 500).sum())}), include_groups=False).reset_index()
    R["volume_shooters"] = recs(vol)
    top_seasons = p3.sort_values("fg3m", ascending=False).head(15)
    R["top_3pm_seasons"] = recs(top_seasons.drop(columns="PLAYER_ID"))
    R["three_leaders"] = recs(lead.drop(columns="PLAYER_ID"))

    # "pick a shooter": how each of those seasons' threes were taken (heaves excluded)
    t3 = d[d.is3 == 1]
    shooters = []
    for _, r in top_seasons.iterrows():
        x = t3[(t3.season == r.season) & (t3.PLAYER_ID == r.PLAYER_ID)]
        mix = x.action.value_counts(normalize=True)
        main = {"Standard jumper": mix.get("Other jumper", 0.0), "Pull-up": mix.get("Pull-up jumper", 0.0),
                "Step-back": mix.get("Step-back jumper", 0.0)}
        main["Other"] = max(0.0, 1 - sum(main.values()))
        shooters.append({
            "season": r.season, "name": r.PLAYER_NAME, "team": x.TEAM_NAME.mode()[0],
            "fg3m": int(r.fg3m), "fg3a": int(r.fg3a), "fg3_pct": round(float(r.fg3_pct), 4),
            "avg_dist": round(float(x.SHOT_DISTANCE.mean()), 1),
            "mix": {k: round(float(v), 4) for k, v in main.items()},
        })
    R["shooters"] = shooters

    # action families by season
    a = rates(agg(d.groupby(["season", "action"]))).reset_index()
    a["share"] = a.fga / a.groupby("season").fga.transform("sum")
    R["actions"] = recs(a[["season", "action", "fga", "share", "fg_pct", "pps"]])

    # period + clutch (last 2:00 of the 4th quarter / OT)
    pr = rates(agg(d.groupby("period"))).reset_index()
    R["periods"] = recs(pr[["period", "fga", "fg_pct", "pps", "three_share"]])
    secs = d.MINS_LEFT * 60 + d.SECS_LEFT
    d["clock"] = np.select(
        [d.QUARTER.ge(4) & secs.le(120), d.QUARTER.ge(4) & secs.le(300)],
        ["Final 2:00 (Q4/OT)", "2:00-5:00 left (Q4/OT)"], "Rest of game")
    ck = rates(agg(d.groupby("clock"))).reset_index()
    R["clutch"] = recs(ck[["clock", "fga", "fg_pct", "pps", "three_share"]])
    # end-of-quarter: final 3 seconds of Q1-Q3
    eoq = d[(d.QUARTER <= 3) & (secs <= 3)]
    R["eoq"] = {"fga": int(len(eoq)), "fg_pct": float(eoq.made.mean())}

    # home vs away by season
    h = rates(agg(d.groupby(["season", "loc"]))).reset_index()
    R["home_away"] = recs(h[["season", "loc", "fga", "fg_pct", "pps"]])

    # timeline: league hex map per season (share of FGA + FG% per hex)
    m = d[(d.LOC_Y <= 35)]
    hx, hy = hexbin(m.LOC_X.values, m.LOC_Y.values, 1.1)
    m = m.assign(hx=hx, hy=hy)
    hb = m.groupby(["season", "hx", "hy"]).agg(n=("made", "size"), fgm=("made", "sum"), pts=("pts", "sum")).reset_index()
    hb["share"] = hb.n / hb.groupby("season").n.transform("sum")
    hb = hb[hb.n >= 25]  # hide hexes too thin to have a stable rate
    R["hex"] = {s: hb[hb.season == s][["hx", "hy", "share", "n", "fgm", "pts"]].round(5).values.tolist() for s in seasons}

    # headline numbers
    first, last = g.iloc[0], g.iloc[-1]
    zf = z.set_index(["season", "zone"])
    R["headline"] = {
        "total_shots": int(len(d)),
        "games": int(d.game.nunique()),
        "players": int(d.PLAYER_ID.nunique()),
        "three_share_first": float(first.three_share),
        "three_share_last": float(last.three_share),
        "fg3a_pg_first": float(first.fg3a_pg),
        "fg3a_pg_last": float(last.fg3a_pg),
        "mid_share_first": float(zf.loc[(seasons[0], "Mid-range"), "share"]),
        "mid_share_last": float(zf.loc[(seasons[-1], "Mid-range"), "share"]),
        "avg_dist_first": float(first.avg_dist),
        "avg_dist_last": float(last.avg_dist),
    }
    return R


# ---------------------------------------------------------------- dashboard
def build_dashboard(d: pd.DataFrame):
    # one row per season x team x court zone x home/away (the four dashboard filters)
    dims = ["season", "code", "zone", "loc"]
    d = d.assign(fg3m=d.made * d.is3)
    c = (d.groupby(dims)
           .agg(fga=("made", "size"), fgm=("made", "sum"), fg3a=("is3", "sum"),
                fg3m=("fg3m", "sum"), pts=("pts", "sum"))
           .reset_index().rename(columns={"code": "team"}))
    c.to_csv(OUT / "cube.csv", index=False)

    # games played by each team, split home/away (denominator for per-game measures)
    gm = d.groupby(["season", "code", "loc"]).game.nunique().rename("games").reset_index()
    gm.rename(columns={"code": "team"}).to_csv(OUT / "games.csv", index=False)

    # franchise code -> current name
    teams = d.drop_duplicates("code").set_index("code")["team"].sort_index()
    teams.reset_index().rename(columns={"code": "team", "team": "name"}).to_csv(OUT / "teams.csv", index=False)

    # shot locations binned into hexagons (radius 1.6 ft) for the dashboard shot map,
    # split by the same four filters so the map follows every one of them
    m = d[d.LOC_Y <= 35]
    hx, hy = hexbin(m.LOC_X.values, m.LOC_Y.values, 1.6)
    m = m.assign(hx=np.round(hx, 1), hy=np.round(hy, 1))
    b = (m.groupby(dims + ["hx", "hy"])
           .agg(n=("made", "size"), fgm=("made", "sum"), pts=("pts", "sum")).reset_index())
    # store as small integer codes; bins_key.json translates them back
    key = {"seasons": sorted(b.season.unique()), "teams": sorted(b.code.unique()), "zones": [z for z in dict.fromkeys(ZONE_LABEL.values())],
           "locs": ["Home", "Away"]}
    hexes = b[["hx", "hy"]].drop_duplicates().sort_values(["hy", "hx"]).reset_index(drop=True)
    key["hexes"] = hexes.values.tolist()
    hid = {(x, y): i for i, (x, y) in enumerate(key["hexes"])}
    coded = pd.DataFrame({
        "s": b.season.map({v: i for i, v in enumerate(key["seasons"])}), "t": b.code.map({v: i for i, v in enumerate(key["teams"])}),
        "z": b.zone.map({v: i for i, v in enumerate(key["zones"])}), "l": b["loc"].map({v: i for i, v in enumerate(key["locs"])}),
        "h": [hid[(x, y)] for x, y in zip(b.hx, b.hy)], "n": b.n, "m": b.fgm, "p": b.pts})
    coded.to_csv(OUT / "bins.csv", index=False)
    with open(OUT / "bins_key.json", "w") as f:
        json.dump(key, f, separators=(",", ":"))
    return len(c), len(b)


if __name__ == "__main__":
    raw = load_raw()
    d, log = clean(raw)
    print(log)
    R = build_report(d, raw, log)
    with open(OUT / "report.json", "w") as f:
        json.dump(R, f, separators=(",", ":"))
    print("cube/bins rows:", build_dashboard(d))
    for p in OUT.iterdir():
        print(p.name, round(p.stat().st_size / 1e6, 2), "MB")
