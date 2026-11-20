"""คำนวณ "ภาพใหญ่" แบบที่สถาบันการเงินใช้ (จากข้อมูลฟรี) -> data/regime.json

1) มาตรวัดความกลัว 0-100: เอาตัววัดความกลัวหลายตัวมาเทียบกับ "อดีต 2 ปีของตัวมันเอง"
   (percentile = วันนี้สูงกว่ากี่ % ของวันในอดีต) แล้วเฉลี่ย
2) หุ้นกับพันธบัตรเดินทางเดียวกันไหม (correlation 20/60 วัน)
   + การขยับวันนี้ "ผิดปกติแค่ไหน" (sigma = ขยับกี่เท่าของการขยับปกติ)
3) ภูมิอากาศเศรษฐกิจ 4 ช่อง: เศรษฐกิจโต/ชะลอ x เงินเฟ้อขึ้น/ลง (ดูการเปลี่ยนแปลง 3 เดือน)
ไม่มีการเดาตัวเลข: ถ้าข้อมูลไม่พอ ส่วนนั้นจะเป็น null และบอกว่าขาดอะไร
"""
from __future__ import annotations
import math
from statistics import mean, pstdev

PCT = {"SPX", "IXIC", "VIX", "GOLD", "DXY", "WTI", "BTC", "SET", "USDTHB", "MOVE", "VIX3M", "COPPER", "MMF"}
SIGMA_KEYS = ["SPX", "IXIC", "VIX", "GOLD", "DXY", "WTI", "BTC", "SET", "USDTHB", "US10Y", "US2Y", "COPPER", "HY", "MOVE"]
FEAR_PARTS = [  # (key, ชื่อ, คำอธิบาย)
    ("VIX", "VIX ความกลัวในหุ้น", "ยิ่งสูงยิ่งกลัว"),
    ("MOVE", "MOVE ความผันผวนพันธบัตร", "ตลาดพันธบัตรปั่นป่วนแค่ไหน"),
    ("HY", "ส่วนต่างหุ้นกู้ขยะ", "กลัวบริษัทผิดนัดชำระหนี้แค่ไหน"),
    ("VIXTS", "VIX ระยะสั้น ÷ ระยะ 3 เดือน", "เกิน 1 = กลัวแบบเฉียบพลัน"),
    ("STRESS", "ดัชนีความเครียด Fed", "ความตึงในระบบการเงินรวม (รายสัปดาห์)"),
]


def vals(rows):
    return [v for _, v in rows]


def changes(rows, key, lag=1):
    out = []
    for i in range(lag, len(rows)):
        a, b = rows[i - lag][1], rows[i][1]
        if key in PCT:
            if a:
                out.append((rows[i][0], (b / a - 1) * 100))
        else:
            out.append((rows[i][0], b - a))
    return out


def pct_rank(series, window):
    xs = series[-window:]
    if len(xs) < 60:
        return None
    last = xs[-1]
    return sum(1 for x in xs if x <= last) / len(xs)


def corr(xs, ys):
    if len(xs) < 10:
        return None
    mx, my = mean(xs), mean(ys)
    sx, sy = pstdev(xs), pstdev(ys)
    if not sx or not sy:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (len(xs) * sx * sy)


def align(a, b):
    db = dict(b)
    return [(d, v, db[d]) for d, v in a if d in db]


def sigma(rows, key, lag=1, window=252):
    ch = changes(rows, key, lag)
    if len(ch) < 60:
        return None
    hist = [c for _, c in ch[-window - 1:-1]]
    # ใช้การขยับรายวันปกติ x sqrt(lag) เป็นมาตรฐานของการขยับหลายวัน
    d1 = [c for _, c in changes(rows, key, 1)[-window - 1:-1]]
    sd = pstdev(d1) * math.sqrt(lag) if d1 else 0
    return round(ch[-1][1] / sd, 2) if sd else None


def label_fear(score):
    for lim, name in [(25, "สงบ"), (45, "ปกติ"), (65, "เริ่มกังวล"), (80, "กลัว"), (101, "กลัวมาก")]:
        if score < lim:
            return name


def compute(long, series, now):
    L = {k: v for k, v in long.items() if v}
    out = {"generated_at": now, "window_days": 504, "missing": []}

    # ---------- ชั้น 1: มาตรวัดความกลัว ----------
    derived = dict(L)
    if "VIX" in L and "VIX3M" in L:
        derived["VIXTS"] = [(d, a / b) for d, a, b in align(L["VIX"], L["VIX3M"]) if b]
    parts = []
    for key, name, desc in FEAR_PARTS:
        rows = derived.get(key)
        if not rows:
            out["missing"].append(name)
            continue
        window = 104 if key == "STRESS" else 504          # รายสัปดาห์ ~2 ปี = 104 จุด
        r = pct_rank(vals(rows), window)
        if r is None:
            out["missing"].append(name + " (ประวัติไม่พอ)")
            continue
        parts.append({"key": key, "name": name, "desc": desc, "value": round(rows[-1][1], 3),
                      "asof": rows[-1][0], "pct": round(r * 100)})
    if len(parts) >= 2:
        score = round(mean(p["pct"] for p in parts))
        out["fear"] = {"score": score, "label": label_fear(score), "parts": parts}
    else:
        out["fear"] = None

    # ---------- ชั้น 2: หุ้น-พันธบัตร + การขยับผิดปกติ ----------
    sb = {}
    if "SPX" in L and "US10Y" in L:
        r = align(changes(L["SPX"], "SPX"), changes(L["US10Y"], "US10Y"))
        for n in (20, 60):
            seg = r[-n:]
            c = corr([x for _, x, _ in seg], [-y for _, _, y in seg]) if len(seg) == n else None  # ราคาพันธบัตร = -ดอกเบี้ย
            sb[f"c{n}"] = None if c is None else round(c, 2)
    out["stock_bond"] = sb or None
    out["sigma"] = {k: {"d1": sigma(L[k], k, 1), "d5": sigma(L[k], k, 5)} for k in SIGMA_KEYS if k in L}

    # ---------- ชั้น 3: ภูมิอากาศเศรษฐกิจ (3 เดือน = 63 วันทำการ) ----------
    def rank63(rows, key, invert=False):
        ch = [c for _, c in changes(rows, key, 63)]
        r = pct_rank(ch, 504)
        if r is None:
            return None
        v = (r - 0.5) * 2                     # -1 ถึง +1
        return round(-v if invert else v, 2)
    growth, infl = [], []
    if "COPPER" in L and "GOLD" in L:
        cg = [(d, a / b) for d, a, b in align(L["COPPER"], L["GOLD"]) if b]
        x = rank63(cg, "CUGOLD_RATIO")         # ไม่อยู่ใน PCT -> ใช้ผลต่าง ซึ่งพอสำหรับจัดอันดับ
        if x is not None:
            growth.append({"name": "ทองแดงเทียบทอง (3 เดือน)", "v": x})
    for key, name, inv, bucket in [("SPX", "หุ้นสหรัฐ (3 เดือน)", False, growth),
                                   ("HY", "ส่วนต่างหุ้นกู้ขยะแคบลง (3 เดือน)", True, growth),
                                   ("BEI10", "เงินเฟ้อที่ตลาดคาด (3 เดือน)", False, infl),
                                   ("WTI", "ราคาน้ำมัน (3 เดือน)", False, infl)]:
        if key in L:
            x = rank63(L[key], key, inv)
            if x is not None:
                bucket.append({"name": name, "v": x})
    if growth and infl:
        g, i = round(mean(p["v"] for p in growth), 2), round(mean(p["v"] for p in infl), 2)
        quad = ("goldilocks" if g >= 0 and i < 0 else "reflation" if g >= 0 else
                "stagflation" if i >= 0 else "deflation")
        out["macro"] = {"growth": g, "inflation": i, "quadrant": quad, "growth_parts": growth, "inflation_parts": infl}
    else:
        out["macro"] = None

    # ---------- เงินพักในกองทุนตลาดเงิน ----------
    if "MMF" in L and len(L["MMF"]) >= 30:
        ch4 = [c for _, c in changes(L["MMF"], "MMF", 4)]
        r = pct_rank(ch4, 104) if len(ch4) >= 60 else None
        out["cash"] = {"chg4w": round(ch4[-1], 2), "pct": None if r is None else round(r * 100), "asof": L["MMF"][-1][0]}
    else:
        out["cash"] = None
    return out
