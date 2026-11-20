"""รวมทุกไฟล์เป็น HTML ไฟล์เดียว (ไว้พรีวิวนอก GitHub Pages) — python3 scripts/build_preview.py <ไฟล์ปลายทาง>"""
import json, re, sys
from pathlib import Path
R = Path(__file__).resolve().parent.parent
html = (R / "index.html").read_text()
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = re.sub(r'<script src="[^"]+"></script>\s*', "", body)
embed = {p: json.loads((R / p).read_text()) for p in ["data/latest.json", "data/history.json", "config/manual.json"]}
if "--example-flow" in sys.argv:
    embed["config/manual.json"]["set_investor_flow"].update(
        {"_example": True, "trade_date": "2026-11-18", "foreign": -2850.4, "institution": 1120.6,
         "proprietary": -310.2, "retail": 2040.0, "entered_at": "2026-11-20T07:00:00+07:00"})
js = "".join((R / f"assets/{n}.js").read_text() + "\n" for n in ["indicators", "rules", "app"])
out = f"""<title>เข็มทิศตลาด</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anuphan:wght@500;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=IBM+Plex+Sans:wght@500;600&display=swap">
<style>{(R / 'assets/app.css').read_text()}</style>
{body}
<script>window.__EMBED__ = {json.dumps(embed, ensure_ascii=False)};</script>
<script>{js}</script>
"""
Path(sys.argv[1]).write_text(out)
print("wrote", sys.argv[1], len(out))
