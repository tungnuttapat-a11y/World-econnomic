"""ดึงพาดหัวข่าวตามหัวข้อใน config/news.json -> data/news.json

แหล่ง: Google News RSS (ไทย + อังกฤษ) ลิงก์จะพาไปเว็บต้นฉบับ
ถ้าหัวข้อไหนดึงไม่ได้: เก็บข่าวรอบก่อนไว้ และติดป้าย stale (ห้ามแต่งข่าวเอง)
ใช้แค่ไลบรารีมาตรฐานของ Python + requests
"""
import json, time, html
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus
import xml.etree.ElementTree as ET
import requests

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "config/news.json").read_text())
OUT = ROOT / "data/news.json"
UA = {"User-Agent": "Mozilla/5.0 (market-compass news reader)"}
LANG = {"th": "hl=th&gl=TH&ceid=TH:th", "en": "hl=en-US&gl=US&ceid=US:en"}


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=UA, timeout=20)
            r.raise_for_status()
            return r.content
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last


def google_news(query, lang, days):
    url = f"https://news.google.com/rss/search?q={quote_plus(query + f' when:{days}d')}&{LANG[lang]}"
    root = ET.fromstring(get(url))
    out = []
    for it in root.iter("item"):
        title = html.unescape(it.findtext("title") or "").strip()
        src = it.find("source")
        source = (src.text or "").strip() if src is not None else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except Exception:  # noqa: BLE001
            continue
        out.append({"title": title, "url": it.findtext("link"), "source": source,
                    "source_url": src.get("url") if src is not None else None,
                    "published": pub.isoformat(), "lang": lang})
    return out


def main():
    old = json.loads(OUT.read_text()) if OUT.exists() else {"topics": {}}
    now = datetime.now(timezone.utc)
    days, cap = CFG.get("max_age_days", 3), CFG.get("max_per_topic", 4)
    topics, ok, fail = {}, 0, 0
    for tid, q in CFG["topics"].items():
        items, errors = [], []
        for lang in ("th", "en"):
            try:
                items += google_news(q[lang], lang, days)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{lang}: {e}")
        seen, uniq = set(), []
        for a in sorted(items, key=lambda a: a["published"], reverse=True):
            k = a["title"].lower()[:80]
            if k in seen or now - datetime.fromisoformat(a["published"]) > timedelta(days=days):
                continue
            seen.add(k)
            uniq.append(a)
        # คละไทย/อังกฤษ: เอาไทยก่อนอย่างน้อยครึ่ง
        th = [a for a in uniq if a["lang"] == "th"][: (cap + 1) // 2]
        rest = [a for a in uniq if a not in th][: cap - len(th)]
        pick = sorted(th + rest, key=lambda a: a["published"], reverse=True)
        if pick:
            topics[tid] = {"status": "ok", "fetched_at": now.isoformat(), "items": pick}
            ok += 1
        else:
            prev = old.get("topics", {}).get(tid)
            topics[tid] = {**(prev or {"items": []}), "status": "stale" if prev else "missing",
                           "error": "; ".join(errors)[:300] or "ไม่พบข่าวในช่วงที่กำหนด"}
            fail += 1
        time.sleep(0.5)
    OUT.write_text(json.dumps({"generated_at": now.isoformat(), "topics": topics}, ensure_ascii=False, indent=1))
    print(f"news: ok {ok}, failed {fail}")


if __name__ == "__main__":
    main()
