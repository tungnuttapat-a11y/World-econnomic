"""ยอดซื้อขายสุทธิตามประเภทนักลงทุน (SET) จาก "พาดหัวข่าว" -> data/set_flow.json

ทำไมใช้ข่าว: SET ไม่มี API ฟรีสำหรับข้อมูลนี้ (API ทางการอยู่ใน SET SMART Marketplace ต้องสมัคร/เสียเงิน)
แต่สำนักข่าวรายงานตัวเลขนี้ทุกวันหลังตลาดปิด
กันอ่านผิด:
  - ดึงตัวเลขเฉพาะรูปแบบ "<กลุ่ม> ซื้อ/ขายสุทธิ <ตัวเลข> ล้านบาท"
  - ถ้า 2 แหล่งข่าวขึ้นไปตรงกัน (ต่างกันไม่เกิน 1%) = "ยืนยันแล้ว" ถ้ามีแหล่งเดียว = "ยังไม่ยืนยัน"
  - ถ้าข่าวขัดกันเอง = ไม่ใช้ตัวเลข
  - ถ้าไม่เจอ: ใช้ของรอบก่อน + ป้าย stale (ห้ามเดา)
"""
import json, re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/set_flow.json"
BKK = timezone(timedelta(hours=7))
QUERIES = ["ต่างชาติ ขายสุทธิ ล้านบาท หุ้นไทย", "ต่างชาติ ซื้อสุทธิ ล้านบาท หุ้นไทย",
           "นักลงทุนต่างชาติ สุทธิ SET ปิด", "สถาบัน รายย่อย ซื้อสุทธิ ขายสุทธิ ล้านบาท"]
GROUPS = {
    "foreign": r"(?:นักลงทุน)?(?:ต่างชาติ|ต่างประเทศ)",
    "institution": r"(?:นักลงทุน)?สถาบัน(?:ในประเทศ)?",
    "proprietary": r"(?:บัญชี)?(?:บริษัทหลักทรัพย์|บล\.|โบรกเกอร์|พอร์ตโบรก)",
    "retail": r"(?:นักลงทุน)?(?:รายย่อย|ทั่วไปในประเทศ)",
}
NUM = r"([\d,]+(?:\.\d+)?)\s*(ล้านบาท|ล้าน|ลบ\.|MB)"
PATTERNS = {g: re.compile(p + r"[^\d]{0,12}?(ซื้อ|ขาย)\s*สุทธิ\s*" + NUM) for g, p in GROUPS.items()}


def parse_title(title):
    out = {}
    for g, rx in PATTERNS.items():
        m = rx.search(title)
        if m:
            v = float(m.group(2).replace(",", ""))
            if 0 < v < 100000:                # มากกว่า 1 แสนล้านต่อวัน = อ่านผิดแน่นอน
                out[g] = round(v if m.group(1) == "ซื้อ" else -v, 2)
    return out


def trade_date_of(published_iso):
    """ข่าวหลังเที่ยงเป็นของวันนั้น ข่าวก่อนเที่ยงเป็นของวันทำการก่อนหน้า"""
    t = datetime.fromisoformat(published_iso).astimezone(BKK)
    d = t.date() if t.hour >= 12 else t.date() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def combine(articles):
    """articles = [{title,url,source,published}] -> ผลรวมของวันล่าสุดที่มีข้อมูล หรือ None"""
    by_date = defaultdict(list)
    for a in articles:
        vals = parse_title(a["title"])
        if vals:
            by_date[trade_date_of(a["published"])].append((a, vals))
    for d in sorted(by_date, reverse=True):
        rows, result, sources, ok = by_date[d], {}, [], False
        for g in GROUPS:
            seen = [(v[g], a) for a, v in rows if g in v]
            if not seen:
                continue
            ref = seen[0][0]
            agree = [x for x in seen if abs(x[0] - ref) <= abs(ref) * 0.01 + 0.5]
            if len(agree) < len(seen):                # ข่าวขัดกัน ข้ามกลุ่มนี้
                continue
            result[g] = ref
            for _, a in agree:
                if a["url"] not in [s["url"] for s in sources]:
                    sources.append({k: a[k] for k in ("title", "url", "source")})
            if g == "foreign" and len({a["source"] for _, a in agree}) >= 2:
                ok = True
        if "foreign" in result:
            return {"trade_date": d, **{g: result.get(g) for g in GROUPS},
                    "confirmed": ok, "sources": sources[:4]}
    return None


def main():
    import fetch_news  # ใช้ตัวดึง Google News เดิม
    now = datetime.now(BKK).isoformat(timespec="seconds")
    arts, errs = [], []
    for q in QUERIES:
        try:
            arts += fetch_news.google_news(q, "th", 3)
        except Exception as e:  # noqa: BLE001
            errs.append(str(e)[:120])
    res = combine(arts)
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    if res:
        out = {**res, "status": "ok", "fetched_at": now, "method": "พาดหัวข่าว"}
    elif old.get("foreign") is not None:
        out = {**old, "status": "stale", "error": "; ".join(errs) or "ไม่พบตัวเลขในข่าวรอบนี้"}
    else:
        out = {"status": "missing", "fetched_at": now, "error": "; ".join(errs) or "ไม่พบตัวเลขในข่าว"}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print("set_flow:", out.get("status"), out.get("trade_date"), out.get("foreign"), "confirmed" if out.get("confirmed") else "")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
