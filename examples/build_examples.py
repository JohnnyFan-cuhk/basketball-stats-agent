#!/usr/bin/env python3
"""build_examples.py · 从 ESPN 公开 API 抓取真实比赛，转换为本项目数据模型。

用途：examples/ 目录的生成脚本（可复现，来源可追溯）。
数据用途：M2 Agent 评估集 + 名局分析内容素材 + 导入功能测试样例。
注意：本项目不做模型微调——GLM 是提示词驱动，这些数据用于校准分析框架。

用法：
    python build_examples.py            # 构建全部
    python build_examples.py 400878160  # 只构建指定 event

对账校验（任何一项失败即报错退出）：
    每队：sum(球员得分) == sum(四节得分) == 最终比分
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
HEADERS = {"User-Agent": "Mozilla/5.0 (basketball-stats-agent examples builder)"}

# (ESPN eventId, NBA比赛日, 我方视角, 文件名, 回顾素材用的故事线标签)
GAMES = [
    (400878159, "2016-06-16", "Cleveland Cavaliers", "nba_2016_finals_g6_cle.json",
     "LeBron 41分连得18分 & Curry犯满离场（ESPN recap 400878159）"),
    (400878160, "2016-06-19", "Cleveland Cavaliers", "nba_2016_finals_g7_cle.json",
     "The Block + Kyrie关键三分 + LeBron总决赛G7三双"),
    (None,      "2006-01-22", "Los Angeles Lakers",   "nba_2006_kobe81_lal.json",
     "Kobe Bryant 81分之夜（历史第二得分）"),
]


def http_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def resolve_event(event_id, nba_date):
    """返回 (event_id, 比赛日)。event_id 可由日期+对阵在 scoreboard 里解析。"""
    if event_id:
        return event_id, nba_date
    sb = http_json(f"{ESPN}/scoreboard?dates={nba_date.replace('-', '')}")
    for ev in sb.get("events", []):
        name = ev.get("name", "")
        if "Lakers" in name and "Raptors" in name:
            return ev["id"], nba_date
    raise SystemExit(f"scoreboard {nba_date} 中未找到目标比赛")


def parse_stat(stats, labels, label):
    """按标签取数；'9-24' → (9, 24)；不可解析/缺失返回 None。"""
    i = labels.index(label)
    if i >= len(stats):
        return None
    raw = stats[i].strip()
    if "-" in raw:
        a, b = raw.split("-")
        if a.isdigit() and b.isdigit():
            return int(a), int(b)
        return None
    return int(raw) if raw.isdigit() else None


def transform(summary, event_id, nba_date, us_name, source_url):
    comp = summary["header"]["competitions"][0]
    home, away = comp["competitors"][0], comp["competitors"][1]
    teams = {c["team"]["displayName"]: c for c in comp["competitors"]}

    us_key = next(k for k in teams if us_name.split()[-1] in k)
    them_key = next(k for k in teams if k != us_key)

    def quarters(c):
        return [int(l["displayValue"]) for l in c.get("linescores", [])]

    us_q, them_q = quarters(teams[us_key]), quarters(teams[them_key])
    if len(us_q) != 4 or len(them_q) != 4:
        raise SystemExit(f"加时或节数异常（{len(us_q)}/{len(them_q)}节），数据模型 v0.1 只支持4节")

    def roster(team_key):
        side = next(t for t in summary["boxscore"]["players"]
                    if t["team"]["displayName"] == team_key)
        labels = side["statistics"][0]["labels"]
        rows = []
        for p in side["statistics"][0]["athletes"]:
            st = p.get("stats", [])
            pts = parse_stat(st, labels, "PTS")
            if pts is None:          # DNP / 未出场
                continue
            reb = parse_stat(st, labels, "REB")
            ast = parse_stat(st, labels, "AST")
            tov = parse_stat(st, labels, "TO")
            fg = parse_stat(st, labels, "FG")
            info = p["athlete"]
            row = {
                "name": info.get("displayName", "?"),
                "pts": pts, "reb": reb or 0, "ast": ast or 0, "tov": tov or 0,
            }
            if fg:
                row["fg"] = [fg[0], fg[1]]
            if info.get("jersey"):
                row["number"] = int(info["jersey"])
            rows.append(row)
        return rows

    game = {
        "id": "x" + str(event_id),
        "date": nba_date,
        "opponent": them_key,
        "us": us_q,
        "them": them_q,
        "stats": roster(us_key),
    }

    # ---- 对账校验 ----
    score = lambda c: int(c.get("score"))
    assert sum(us_q) == score(teams[us_key]), f"{us_key} 四节和≠总分"
    assert sum(them_q) == score(teams[them_key]), f"{them_key} 四节和≠总分"
    assert sum(s["pts"] for s in game["stats"]) == score(teams[us_key]), "我方球员得分和≠总分"

    opp_side = next(t for t in summary["boxscore"]["players"]
                    if t["team"]["displayName"] == them_key)
    opp_labels = opp_side["statistics"][0]["labels"]
    opp_pts = sum(pts for p in opp_side["statistics"][0]["athletes"]
                  if (pts := parse_stat(p.get("stats", []), opp_labels, "PTS")) is not None)
    assert opp_pts == score(teams[them_key]), "对方球员得分和≠总分"

    game["_meta"] = {
        "source": "ESPN public API (site.api.espn.com)",
        "sourceUrl": source_url,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "verified": "球员/四节/总分三级对账通过",
        "storyline": None,   # 由调用方填写
    }
    return game, score(teams[us_key]), score(teams[them_key])


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for event_id, nba_date, us_name, filename, story in GAMES:
        if only and only not in (event_id or "", filename):
            continue
        event_id, nba_date = resolve_event(event_id, nba_date)
        url = f"{ESPN}/summary?event={event_id}"
        summary = http_json(url)
        game, us_pts, them_pts = transform(summary, event_id, nba_date, us_name, url)
        game["_meta"]["storyline"] = story + f"｜终局 {us_pts}:{them_pts}"
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(game, f, ensure_ascii=False, indent=2)
        result = "胜" if us_pts > them_pts else "负"
        print(f"✓ {filename}: {nba_date} vs {game['opponent']} {us_pts}:{them_pts} {result}，"
              f"{len(game['stats'])}名球员，对账通过")


if __name__ == "__main__":
    main()
