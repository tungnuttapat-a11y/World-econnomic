"""สร้างข้อมูลตัวอย่างสำหรับ prototype (ขั้นที่ 1) เท่านั้น

ตัวเลขล่าสุดมาจากที่ Nut ให้ไว้ (19 พ.ย. 2026) ส่วนกราฟย้อนหลังเป็น "ข้อมูลจำลอง"
เพื่อดูหน้าตาเท่านั้น ไฟล์ที่ได้จะติดป้าย is_sample = true ให้หน้าเว็บแสดงคำเตือน
ขั้นที่ 2 สคริปต์ fetch_data.py จะเขียนทับด้วยข้อมูลจริง
"""
import json, math, random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
random.seed(1119)

# key: (ค่าล่าสุด, %เปลี่ยนวันนี้ หรือจุดสำหรับ yield, เป้า 30 วัน, ความผันผวนรายวัน, ประเภท, วันที่ล่าสุด)
# "given" = ตัวเลขที่ Nut ให้มา, ที่เหลือในวงเล็บเป็นค่าจำลอง
SAMPLE = {
    "SPX":    dict(last=7175.83, d1=-2.02, d30=-5.0, vol=0.009, kind="pct", asof="2026-11-19"),
    "IXIC":   dict(last=23879.0, d1=-2.25, d30=-6.5, vol=0.012, kind="pct", asof="2026-11-19"),
    "VIX":    dict(last=28.4,    d1=18.0,  d30=60.0, vol=0.06,  kind="pct", asof="2026-11-19"),
    "GOLD":   dict(last=3622.0,  d1=-2.7,  d30=-6.0, vol=0.010, kind="pct", asof="2026-11-19"),
    "DXY":    dict(last=103.6,   d1=0.45,  d30=2.5,  vol=0.0035,kind="pct", asof="2026-11-19"),
    "WTI":    dict(last=83.0,    d1=-1.1,  d30=4.0,  vol=0.018, kind="pct", asof="2026-11-19"),
    "SET":    dict(last=1472.0,  d1=-0.9,  d30=-4.0, vol=0.008, kind="pct", asof="2026-11-18"),
    "USDTHB": dict(last=34.0,    d1=0.35,  d30=2.0,  vol=0.004, kind="pct", asof="2026-11-19"),
    "US10Y":  dict(last=5.07,    d1=0.06,  d30=0.35, vol=0.05,  kind="abs", asof="2026-11-19"),
}
# ไม่มีตัวเลขตัวอย่าง -> แสดงเป็น "ไม่มีข้อมูล" (ห้ามเดา)
MISSING = ["BTC", "US2Y", "US30Y", "REAL10Y"]


def trading_days(end: date, n_cal=90):
    d, out = end - timedelta(days=n_cal), []
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def build(cfg):
    days = trading_days(date.fromisoformat(cfg["asof"]))
    n = len(days)
    last, kind = cfg["last"], cfg["kind"]
    if kind == "pct":
        prev = last / (1 + cfg["d1"] / 100)
        start_30 = last / (1 + cfg["d30"] / 100)
    else:
        prev = last - cfg["d1"]
        start_30 = last - cfg["d30"]
    # เดินสุ่มแบบ bridge: จุดที่ ~22 วันทำการก่อน = start_30, จุดก่อนสุดท้าย = prev
    i30 = max(0, n - 22)
    xs = [0.0]
    for _ in range(n - 2):
        xs.append(xs[-1] + random.gauss(0, cfg["vol"] if kind == "pct" else cfg["vol"]))
    to = (lambda v: math.log(v)) if kind == "pct" else (lambda v: v)
    fr = (lambda v: math.exp(v)) if kind == "pct" else (lambda v: v)
    # ช่วงก่อน i30: ปล่อยเดินถอยหลังจาก start_30
    vals = [0.0] * (n - 1)
    a, b = to(start_30), to(prev)
    seg = xs[i30:]
    m = len(seg) - 1
    for k, x in enumerate(seg):
        t = k / m if m else 1
        vals[i30 + k] = a + (x - seg[0]) - t * (seg[-1] - seg[0]) + t * (b - a)
    for k in range(i30 - 1, -1, -1):
        vals[k] = vals[k + 1] - (xs[k + 1] - xs[k]) * 0.8
    series = [fr(v) for v in vals] + [last]
    dec = 4 if kind == "abs" else 2
    return [[d.isoformat(), round(v, dec)] for d, v in zip(days, series)]


def change(hist, back, kind):
    if len(hist) <= back:
        return None
    a, b = hist[-1 - back][1], hist[-1][1]
    return round(b - a, 3) if kind == "abs" else round((b / a - 1) * 100, 2)


def main():
    history, series = {}, {}
    for key, cfg in SAMPLE.items():
        h = build(cfg)
        history[key] = h
        series[key] = {
            "last": cfg["last"],
            "asof": cfg["asof"],
            "chg1d": cfg["d1"],
            "chg5d": change(h, 5, cfg["kind"]),
            "chg30d": change(h, 22, cfg["kind"]),
            "status": "ok",
            "source": "ตัวอย่าง",
            "fetched_at": "2026-11-20T07:00:00+07:00",
        }
    for key in MISSING:
        series[key] = {"last": None, "status": "missing", "source": "ตัวอย่าง",
                       "note": "ยังไม่มีตัวเลขตัวอย่าง จะได้ข้อมูลจริงในขั้นที่ 2"}
        history[key] = []
    latest = {"generated_at": "2026-11-20T07:00:00+07:00", "is_sample": True, "series": series}
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data/latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=1))
    (ROOT / "data/history.json").write_text(json.dumps(history, ensure_ascii=False, separators=(",", ":")))
    print("ok", {k: (v.get("chg5d"), v.get("chg30d")) for k, v in series.items()})


if __name__ == "__main__":
    main()
