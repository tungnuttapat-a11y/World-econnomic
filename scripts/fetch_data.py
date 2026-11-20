"""ดึงข้อมูลตลาดจริง -> data/latest.json + data/history.json

ลำดับการลองของแต่ละตัว (ตัวไหนได้ก่อนใช้ตัวนั้น):
  ราคา (Yahoo):   1) yfinance  2) Yahoo chart API ตรง  3) FRED (เฉพาะตัวที่ FRED มี)
  ดอกเบี้ย (FRED): 1) FRED API (ใช้ FRED_API_KEY)  2) ไฟล์ CSV สาธารณะของ FRED
ทุกแหล่งลองซ้ำ 3 ครั้ง ถ้าทุกทางล้มเหลว: ใช้ข้อมูลรอบก่อน + ติดป้าย "stale"
ห้ามเดาหรือเติมตัวเลขเอง
"""
from __future__ import annotations

import csv, io, json, math, os, sys, time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
LATEST, HISTORY = ROOT / "data/latest.json", ROOT / "data/history.json"
UA = {"User-Agent": "Mozilla/5.0 (market-compass)"}
HIST_DAYS = 90          # เก็บกราฟย้อนหลัง 90 วัน
LOOKBACK_DAYS = 130     # ดึงเผื่อไว้ให้คำนวณ % 30 วันได้

# แหล่งสำรองจาก Stooq (เฉพาะตัวที่ Yahoo มักมีปัญหา)
STOOQ = {"SET": "^set"}

# key: (Yahoo symbol, FRED สำรอง, ชนิด, ขยับต่อวันได้มากสุดก่อนถือว่าผิดปกติ %)
YAHOO = {
    "SPX":    ("^GSPC",    "SP500",      "pct", 15),
    "IXIC":   ("^IXIC",    "NASDAQCOM",  "pct", 15),
    "VIX":    ("^VIX",     "VIXCLS",     "pct", 150),
    "GOLD":   ("GC=F",     None,         "pct", 15),
    "DXY":    ("DX-Y.NYB", None,         "pct", 8),
    "WTI":    ("CL=F",     "DCOILWTICO", "pct", 40),
    "BTC":    ("BTC-USD",  "CBBTCUSD",   "pct", 40),
    "SET":    ("^SET.BK",  None,         "pct", 15),
    "USDTHB": ("THB=X",    "DEXTHUS",    "pct", 8),
}
FRED = {"US2Y": "DGS2", "US10Y": "DGS10", "US30Y": "DGS30", "REAL10Y": "DFII10"}
FRED_MAX_JUMP = 0.6     # ดอกเบี้ยขยับเกิน 0.6 จุดในวันเดียว = ข้อมูลน่าสงสัย


class SourceError(Exception):
    pass


def retry(fn, tries=3, wait=2.0):
    last = None
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            last = e
            if i < tries - 1:
                time.sleep(wait * (i + 1))
    raise SourceError(str(last)[:200])


# ---------------- แหล่งข้อมูล (คืน [(YYYY-MM-DD, float), ...] เรียงจากเก่าไปใหม่) ----------------
def src_yfinance(symbol):
    import yfinance as yf
    df = yf.Ticker(symbol).history(period="6mo", interval="1d", auto_adjust=False)
    if df is None or df.empty:
        raise SourceError("yfinance: ว่าง")
    return [(idx.strftime("%Y-%m-%d"), float(v)) for idx, v in df["Close"].items() if v == v]


def src_yahoo_chart(symbol):
    last = None
    for host in ("query1", "query2"):
        try:
            r = requests.get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(symbol)}",
                             params={"range": "6mo", "interval": "1d"}, headers=UA, timeout=20)
            r.raise_for_status()
            res = r.json()["chart"]["result"][0]
            tz = res["meta"].get("gmtoffset", 0)
            closes = res["indicators"]["quote"][0]["close"]
            out = [(datetime.fromtimestamp(t + tz, timezone.utc).strftime("%Y-%m-%d"), float(c))
                   for t, c in zip(res["timestamp"], closes) if c is not None]
            if out:
                return out
        except Exception as e:  # noqa: BLE001
            last = e
    raise SourceError(f"yahoo chart: {last}")


def src_stooq(symbol):
    """แหล่งสำรองเพิ่มเติม (Stooq) ใช้กับตัวที่ Yahoo มีข้อมูลไม่ครบ เช่น SET"""
    r = requests.get("https://stooq.com/q/d/l/", params={"s": symbol, "i": "d"}, headers=UA, timeout=30)
    r.raise_for_status()
    rows = list(csv.reader(io.StringIO(r.text)))
    if not rows or rows[0][:1] != ["Date"]:
        raise SourceError("stooq: ไม่พบข้อมูล")
    cut = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    out = [(row[0], float(row[4])) for row in rows[1:] if len(row) > 4 and row[0] >= cut and row[4]]
    if not out:
        raise SourceError("stooq: ว่าง")
    return out


def src_fred_api(series):
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        raise SourceError("ไม่มี FRED_API_KEY")
    start = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    r = requests.get("https://api.stlouisfed.org/fred/series/observations",
                     params={"series_id": series, "api_key": key, "file_type": "json", "observation_start": start},
                     headers=UA, timeout=20)
    r.raise_for_status()
    out = [(o["date"], float(o["value"])) for o in r.json()["observations"] if o["value"] not in (".", "")]
    if not out:
        raise SourceError("FRED API: ว่าง")
    return out


def src_fred_csv(series):
    start = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    r = requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv",
                     params={"id": series, "cosd": start}, headers=UA, timeout=60)
    r.raise_for_status()
    rows = list(csv.reader(io.StringIO(r.text)))
    out = [(d, float(v)) for d, v in rows[1:] if v not in (".", "")]
    if not out:
        raise SourceError("FRED CSV: ว่าง")
    return out


# ---------------- ตรวจความถูกต้อง + คำนวณ ----------------
def merge_old(rows, old_hist):
    """บางแหล่ง (เช่น SET บน Yahoo) ให้มาแค่วันล่าสุด -> ต่อกับประวัติที่เราเก็บไว้เองรอบก่อน ๆ"""
    if len(rows) >= 20 or not old_hist:
        return rows
    merged = {d: v for d, v in old_hist}
    merged.update(dict(rows))
    return sorted(merged.items())


def validate(rows, kind, max_jump):
    rows = [(d, v) for d, v in rows if v is not None and math.isfinite(v)]
    if not rows:
        raise SourceError("ไม่มีข้อมูล")
    if kind == "pct" and any(v <= 0 for _, v in rows[-5:]):
        raise SourceError("ราคาติดลบหรือเป็นศูนย์")
    if len(rows) >= 2:
        (_, a), (_, b) = rows[-2], rows[-1]
        jump = abs(b - a) if kind == "abs" else abs(b / a - 1) * 100
        if jump > max_jump:
            raise SourceError(f"ขยับผิดปกติ ({jump:.2f}) สงสัยข้อมูลเพี้ยน")
    if (date.today() - date.fromisoformat(rows[-1][0])).days > 10:
        raise SourceError(f"ข้อมูลล่าสุดเก่าเกินไป ({rows[-1][0]})")
    return rows


def change(rows, kind, back=None, days=None):
    if days is not None:
        target = date.fromisoformat(rows[-1][0]) - timedelta(days=days)
        prior = [r for r in rows if date.fromisoformat(r[0]) <= target]
        if not prior:
            return None
        a = prior[-1][1]
    else:
        if len(rows) <= back:
            return None
        a = rows[-1 - back][1]
    b = rows[-1][1]
    return round(b - a, 3) if kind == "abs" else round((b / a - 1) * 100, 2)


def summarize(rows, kind, source, now):
    if len(rows) < 2:
        return {"last": round(rows[-1][1], 4), "asof": rows[-1][0], "chg1d": None, "chg5d": None,
                "chg30d": None, "status": "ok", "source": source, "fetched_at": now}
    return {
        "last": round(rows[-1][1], 4),
        "asof": rows[-1][0],
        "chg1d": change(rows, kind, back=1),
        "chg5d": change(rows, kind, back=5),
        "chg30d": change(rows, kind, days=30),
        "status": "ok",
        "source": source,
        "fetched_at": now,
    }


def trim_history(rows, kind):
    cut = (date.fromisoformat(rows[-1][0]) - timedelta(days=HIST_DAYS)).isoformat()
    dec = 4 if kind == "abs" else 4
    return [[d, round(v, dec)] for d, v in rows if d >= cut]


# ---------------- ตัวหลัก ----------------
def fetch_one(key, attempts, kind, max_jump, now, old_hist=None):
    """attempts = [(ชื่อแหล่ง, ฟังก์ชัน), ...] คืน (summary, history, errors)"""
    errors = []
    for name, fn in attempts:
        try:
            raw = retry(fn)
            rows = validate(merge_old(raw, old_hist), kind, max_jump)
            summ = summarize(rows, kind, name, now)
            if len(raw) < 20:
                summ["note"] = (f"แหล่งข้อมูลให้มาแค่ {len(raw)} วัน ระบบกำลังเก็บประวัติสะสมเอง"
                                " (% 5 วัน/30 วัน และกราฟจะครบเมื่อเก็บได้พอ)")
            return summ, trim_history(rows, kind), errors
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
    return None, None, errors


def run(now=None):
    now = now or datetime.now(timezone(timedelta(hours=7))).isoformat(timespec="seconds")
    old_latest = json.loads(LATEST.read_text()) if LATEST.exists() else {"series": {}}
    old_hist = json.loads(HISTORY.read_text()) if HISTORY.exists() else {}
    if old_latest.get("is_sample"):            # อย่าเอาข้อมูลตัวอย่างมาเป็นข้อมูลสำรอง
        old_latest, old_hist = {"series": {}}, {}
    series, history, log = {}, {}, {}

    jobs = []
    for key, (sym, fred, kind, mj) in YAHOO.items():
        att = [("Yahoo Finance", lambda s=sym: src_yfinance(s)),
               ("Yahoo Finance (สำรอง)", lambda s=sym: src_yahoo_chart(s))]
        if key in STOOQ:
            att.append(("Stooq (สำรอง)", lambda s=STOOQ[key]: src_stooq(s)))
        if fred:
            att += [(f"FRED {fred} (สำรอง ช้ากว่า 1 วัน)", lambda f=fred: src_fred_api(f)),
                    (f"FRED {fred} (สำรอง CSV)", lambda f=fred: src_fred_csv(f))]
        jobs.append((key, att, kind, mj))
    for key, sid in FRED.items():
        jobs.append((key, [(f"FRED {sid}", lambda f=sid: src_fred_api(f)),
                           (f"FRED {sid} (CSV)", lambda f=sid: src_fred_csv(f))], "abs", FRED_MAX_JUMP))

    for key, att, kind, mj in jobs:
        summ, hist, errs = fetch_one(key, att, kind, mj, now, old_hist.get(key))
        if summ:
            series[key], history[key] = summ, hist
            if errs and "note" not in summ:
                summ["note"] = "แหล่งหลักใช้ไม่ได้ ใช้แหล่งสำรอง"
        else:
            prev = old_latest.get("series", {}).get(key)
            if prev and prev.get("last") is not None:
                series[key] = {**prev, "status": "stale", "error": " | ".join(errs)[:400]}
                history[key] = old_hist.get(key, [])
            else:
                series[key] = {"last": None, "status": "missing", "note": "ดึงข้อมูลไม่ได้ และไม่มีข้อมูลรอบก่อน",
                               "error": " | ".join(errs)[:400]}
                history[key] = []
        log[key] = series[key]["status"] + ("" if not errs else f" ({len(errs)} แหล่งล้มเหลว)")

    LATEST.write_text(json.dumps({"generated_at": now, "is_sample": False, "series": series},
                                 ensure_ascii=False, indent=1))
    HISTORY.write_text(json.dumps(history, ensure_ascii=False, separators=(",", ":")))
    for k, v in log.items():
        print(f"{k:8s} {v}")
    bad = [k for k, v in series.items() if v["status"] != "ok"]
    return bad


if __name__ == "__main__":
    bad = run()
    # ล้มเหลวทุกตัว = ให้ GitHub Actions แจ้งเตือน แต่ยังเก็บไฟล์ที่เขียนไว้
    sys.exit(1 if len(bad) == len(YAHOO) + len(FRED) else 0)
