/* เข็มทิศตลาด — ตัวหลักของหน้าเว็บ */
(() => {
  "use strict";
  const IND = window.INDICATORS, TABS = window.TABS;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const state = { latest: null, history: {}, manual: null, news: null, newsCfg: null, tab: "overview", offline: false };

  /* ---------- โหลดข้อมูล ---------- */
  async function loadJSON(path) {
    if (window.__EMBED__ && window.__EMBED__[path]) return window.__EMBED__[path];
    const r = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(path + " " + r.status);
    if (r.headers.get("x-from-cache") === "1") state.offline = true;
    return r.json();
  }

  /* ---------- รูปแบบตัวเลข/เวลา ---------- */
  const TZ = "Asia/Bangkok";
  const fmtDT = iso => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("th-TH-u-ca-gregory", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " น.";
  };
  const fmtD = (iso, year = false) => {
    if (!iso) return "—";
    const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
    return d.toLocaleDateString("th-TH-u-ca-gregory", { timeZone: TZ, day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  };
  function fmtVal(key, v) {
    if (v == null) return "—";
    const m = IND[key];
    const n = v.toLocaleString("en-US", { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits });
    return (m.prefix || "") + n + (m.suffix || "");
  }
  function fmtChg(key, c, compact = false) {
    if (c == null) return "—";
    const sign = c > 0 ? "+" : c < 0 ? "−" : "";
    const a = Math.abs(c);
    return IND[key].kind === "yield" ? `${sign}${a.toFixed(2)}${compact ? "" : " จุด"}` : `${sign}${a.toFixed(2)}%`;
  }
  function dir(key, c) {
    if (c == null) return "flat";
    const eps = IND[key].kind === "yield" ? 0.005 : 0.05;
    return c > eps ? "up" : c < -eps ? "down" : "flat";
  }
  const arrow = d => (d === "up" ? "▲" : d === "down" ? "▼" : "•");

  /* ---------- ตัดสินโหมด (ใช้กฎจาก rules.js) ---------- */
  function computeMode(series) {
    const S = window.MODE_SETTINGS;
    const results = window.MODE_RULES.map(m => {
      const checks = m.conditions.map(c => {
        let r = null;
        try { r = c.check(series); } catch (e) { r = null; }
        return { label: c.label, result: r };
      });
      const met = checks.filter(c => c.result === true).length;
      const unknown = checks.filter(c => c.result == null).length;
      return { ...m, checks, met, unknown, total: checks.length, score: met / checks.length };
    });
    const fear = results.filter(r => r.id !== "normal").sort((a, b) => b.score - a.score || a.priority - b.priority);
    const normal = results.find(r => r.id === "normal");
    let primary = fear[0] && fear[0].score >= S.minScore ? fear[0] : normal;
    if (primary === normal && normal.score < S.minScore && window.MODE_MIXED) {
      const best = fear[0];
      return { primary: { ...window.MODE_MIXED, checks: best.checks, met: best.met, total: best.total, unknown: best.unknown, score: best.score },
        results, confidence: "ต่ำ", alsoStrong: [],
        confWhy: `โหมดที่ใกล้สุดคือ "${best.name}" เข้า ${best.met}/${best.total} ข้อ และ "ปกติ" เข้า ${normal.met}/${normal.total} ข้อ` };
    }
    const others = results.filter(r => r !== primary);
    // สัญญาณขัดกัน: ดูเฉพาะเงื่อนไขของโหมดคู่ขัดที่ "ไม่ซ้ำ" กับโหมดหลัก (เช่น หุ้นลง ซ้ำกันได้ ไม่นับว่าขัด)
    const own = new Set(primary.checks.map(c => c.label));
    const conflict = others.map(o => {
      const uniq = o.checks.filter(c => !own.has(c.label));
      const met = uniq.filter(c => c.result === true).length;
      return { ...o, met, total: uniq.length, cscore: uniq.length ? met / uniq.length : 0 };
    }).find(o => (primary.conflictsWith || []).includes(o.id) && o.cscore >= S.conflictScore);
    const alsoStrong = others.filter(o => o.id !== "normal" && o.score >= S.minScore);
    const missing = primary.unknown > 0;
    let confidence, confWhy;
    if (conflict || missing || primary.score < S.minScore) {
      confidence = "ต่ำ";
      confWhy = conflict ? `สัญญาณขัดกัน: เงื่อนไขเฉพาะของ "${conflict.name}" ก็เข้า ${conflict.met}/${conflict.total} ข้อ`
        : missing ? "ข้อมูลบางตัวขาด ตรวจได้ไม่ครบทุกข้อ" : "ไม่มีโหมดไหนเข้าชัด";
    } else if (primary.score === 1 && alsoStrong.length === 0) {
      confidence = "สูง"; confWhy = "เข้าครบทุกข้อ และไม่มีสัญญาณขัด";
    } else {
      confidence = "กลาง";
      confWhy = alsoStrong.length ? `มีสัญญาณ "${alsoStrong.map(a => a.name).join(", ")}" เข้าร่วมด้วย` : "เข้าเกือบครบ";
    }
    return { primary, results, confidence, confWhy, alsoStrong };
  }

  /* ---------- เงินไหลไปไหน (อนุมานจากราคา) ---------- */
  function flow(series) {
    const items = [
      ["หุ้นสหรัฐ", "SPX", 1], ["ทอง", "GOLD", 1], ["ดอลลาร์", "DXY", 1],
      ["พันธบัตรสหรัฐ", "US10Y", -1], ["น้ำมัน", "WTI", 1], ["Bitcoin", "BTC", 1], ["หุ้นไทย", "SET", 1],
    ];
    const inn = [], out = [];
    for (const [label, key, sgn] of items) {
      const s = series[key];
      if (!s || s.chg1d == null || s.status === "missing") continue;
      const isYield = IND[key].kind === "yield";
      const v = s.chg1d * sgn;
      const th = isYield ? 0.02 : 0.2;
      const text = isYield ? `ราคาลง (ผลตอบแทน ${fmtChg(key, s.chg1d)})` : fmtChg(key, s.chg1d);
      const txt = isYield && v > 0 ? `ราคาขึ้น (ผลตอบแทน ${fmtChg(key, s.chg1d)})` : text;
      if (v >= th) inn.push([label, txt, v]); else if (v <= -th) out.push([label, txt, v]);
    }
    return { inn, out };
  }

  /* ---------- กราฟ ---------- */
  function sparkSVG(points, d) {
    if (!points || points.length < 2) return `<svg class="t-spark" viewBox="0 0 100 34" aria-hidden="true"></svg>`;
    const ys = points.map(p => p[1]);
    const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
    const W = 100, H = 34, pad = 3;
    const xy = ys.map((y, i) => [(i / (ys.length - 1)) * (W - pad * 2) + pad, H - pad - ((y - min) / span) * (H - pad * 2)]);
    const line = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2)).join("");
    const color = `var(--${d === "flat" ? "flat" : d})`;
    const last = xy[xy.length - 1];
    return `<svg class="t-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${line}L${last[0]} ${H}L${pad} ${H}Z" fill="${color}" fill-opacity=".12" stroke="none"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </svg>`;
  }

  function bigChart(svg, key, points, onScrub) {
    const W = Math.max(280, svg.clientWidth || 340), H = 220;
    const padL = 8, padR = 56, padT = 12, padB = 24;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (!points || points.length < 2) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">ไม่มีข้อมูลกราฟ</text>`; return; }
    const ys = points.map(p => p[1]);
    let min = Math.min(...ys), max = Math.max(...ys);
    const span0 = max - min || Math.abs(max) * 0.01 || 1; min -= span0 * 0.08; max += span0 * 0.08;
    const X = i => padL + (i / (points.length - 1)) * (W - padL - padR);
    const Y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const first = ys[0], lastV = ys[ys.length - 1];
    const d = lastV > first ? "up" : lastV < first ? "down" : "flat";
    const color = `var(--${d})`;
    const line = points.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
    let grid = "";
    for (let k = 0; k <= 3; k++) {
      const v = min + ((max - min) * k) / 3, y = Y(v);
      grid += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/>
        <text x="${W - padR + 6}" y="${y + 4}">${esc(fmtVal(key, v).replace(" บาท", ""))}</text>`;
    }
    const lx = X(points.length - 1), ly = Y(lastV);
    svg.innerHTML = `${grid}
      <path d="${line}L${lx} ${H - padB}L${padL} ${H - padB}Z" fill="${color}" fill-opacity=".10"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="4" fill="${color}"/>
      <text x="${padL}" y="${H - 6}">${esc(fmtD(points[0][0]))}</text>
      <text x="${W - padR}" y="${H - 6}" text-anchor="end">${esc(fmtD(points[points.length - 1][0]))}</text>
      <g class="cursor" visibility="hidden"><line y1="${padT}" y2="${H - padB}" stroke="var(--muted)" stroke-dasharray="3 3"/><circle r="5" fill="var(--surface)" stroke="${color}" stroke-width="2"/></g>`;
    const cur = svg.querySelector(".cursor");
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((x - padL) / (W - padL - padR)) * (points.length - 1))));
      cur.setAttribute("visibility", "visible");
      cur.querySelector("line").setAttribute("x1", X(i)); cur.querySelector("line").setAttribute("x2", X(i));
      const c = cur.querySelector("circle"); c.setAttribute("cx", X(i)); c.setAttribute("cy", Y(points[i][1]));
      onScrub(points[i]);
    };
    const leave = () => { cur.setAttribute("visibility", "hidden"); onScrub(null); };
    svg.onpointerdown = svg.onpointermove = move;
    svg.onpointerleave = svg.onpointerup = leave;
  }

  /* ---------- ส่วนประกอบหน้า ---------- */
  function tileHTML(key) {
    const m = IND[key], s = (state.latest.series || {})[key] || { status: "missing" };
    const h = state.history[key] || [];
    const missing = s.status === "missing" || s.last == null;
    const d = dir(key, s.chg1d);
    let badge = "";
    if (s.status === "stale") badge = `<span class="badge">ข้อมูลเก่า ณ ${esc(fmtDT(s.fetched_at))}</span>`;
    if (missing) badge = `<span class="badge">ไม่มีข้อมูล</span>`;
    return `<button class="tile ${missing ? "is-missing" : ""}" data-key="${key}" aria-label="${esc(m.name)} ดูรายละเอียด">
      <span class="t-name">${esc(m.name)}</span>
      <span class="t-short">${esc(m.short)}</span>
      <span class="t-val">${missing ? "—" : esc(fmtVal(key, s.last))}</span>
      ${missing ? "" : `<span class="t-chg ${d}">${arrow(d)} ${esc(fmtChg(key, s.chg1d))} <span class="t-short">วันนี้</span></span>`}
      ${missing ? "" : sparkSVG(h, dir(key, h.length > 1 ? h[h.length - 1][1] - h[0][1] : 0))}
      ${badge}
      ${missing ? "" : `<span class="t-sub"><span>5 วัน <span class="num ${dir(key, s.chg5d)}">${esc(fmtChg(key, s.chg5d, true))}</span></span><span>30 วัน <span class="num ${dir(key, s.chg30d)}">${esc(fmtChg(key, s.chg30d, true))}</span></span></span>`}
      ${missing ? "" : `<span class="t-sub"><span>ราคาปิด ${esc(fmtD(s.asof))}</span></span>`}
    </button>`;
  }

  function modeHTML() {
    const L = state.latest, M = computeMode(L.series), p = M.primary, f = flow(L.series);
    const chips = arr => arr.length ? arr.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).map(([l, t]) => `<span class="chip">${esc(l)} <span class="num">${esc(t)}</span></span>`).join("") : `<span class="note">ไม่มีตัวไหนขยับชัด</span>`;
    const why = M.results.map(r => `
      <div class="why-mode"><b>${esc(r.name)}</b> <span class="note">เข้า ${r.met}/${r.total} ข้อ${r.unknown ? ` (ไม่ทราบ ${r.unknown})` : ""}</span>
        <ul>${r.checks.map(c => `<li><span class="mark ${c.result === true ? "yes" : c.result === false ? "no" : "unk"}">${c.result === true ? "✓" : c.result === false ? "✗" : "?"}</span><span>${esc(c.label)}</span></li>`).join("")}</ul>
      </div>`).join("");
    return `<section class="mode ${p.color}" aria-live="polite">
      <div class="mode-head">
        <span class="eyebrow"><span class="dot"></span>ตอนนี้ตลาด…</span>
        <span class="conf" title="${esc(M.confWhy)}">ความมั่นใจ: ${M.confidence}</span>
      </div>
      <h1>${esc(p.name)}</h1>
      <p class="sentence">${esc(p.sentence)}</p>
      <p class="note">${esc(M.confWhy)}</p>
      <div class="flow">
        <div class="flow-row"><span class="flow-label">เงินออกจาก</span>${chips(f.out)}</div>
        <div class="flow-row"><span class="flow-label">เงินเข้า</span>${chips(f.inn)}</div>
      </div>
      <details class="why"><summary>ทำไมถึงสรุปแบบนี้</summary>${why}
        <p class="note">กฎและเกณฑ์ทั้งหมดอยู่ในไฟล์ <code>assets/rules.js</code> แก้ได้</p></details>
      <p class="note">⚠︎ เป็นการอนุมานจากการขยับของราคาวันนี้ ไม่ใช่ข้อมูลเงินไหลเข้าออกจริง</p>
      <div class="mode-foot"><span>อัปเดตล่าสุด ${esc(fmtDT(L.generated_at))}</span><span>ข้อมูลอาจช้า 15–20 นาที</span></div>
    </section>`;
  }

  function manualFed() {
    const f = (state.manual || {}).fedwatch || {};
    const has = f.hike_pct != null || f.hold_pct != null || f.cut_pct != null;
    return `<section class="card"><h2>โอกาสที่ Fed จะปรับดอกเบี้ย</h2>
      <p class="note">ประชุมครั้งถัดไป ${esc(fmtD(f.next_meeting, true))} · ที่มา CME FedWatch (กรอกเอง)</p>
      ${has ? `<div class="kv"><div><span>ขึ้น</span><strong>${f.hike_pct ?? "—"}%</strong></div><div><span>คงที่</span><strong>${f.hold_pct ?? "—"}%</strong></div><div><span>ลด</span><strong>${f.cut_pct ?? "—"}%</strong></div></div>
        <p class="note">กรอกเมื่อ ${esc(fmtDT(f.entered_at))}</p>`
      : `<p class="empty">ยังไม่ได้กรอก ดึงอัตโนมัติไม่ได้ ต้องกรอกเองในไฟล์ <code>config/manual.json</code></p>`}
    </section>`;
  }
  const FLOW_GROUPS = [
    ["foreign", "ต่างชาติ", "กองทุนและนักลงทุนต่างประเทศ เงินก้อนใหญ่สุด มักเป็นตัวกำหนดทิศทาง SET"],
    ["institution", "สถาบันไทย", "สถาบันในประเทศ: กองทุนรวม กองทุนบำนาญ ประกันชีวิตของไทย"],
    ["proprietary", "บัญชีโบรกเกอร์", "บริษัทหลักทรัพย์ซื้อขายด้วยเงินตัวเอง (พอร์ตบริษัท) มักเทรดระยะสั้น"],
    ["retail", "รายย่อย", "นักลงทุนบุคคลทั่วไปในประเทศ (แบบเรา)"],
  ];
  function manualFlow() {
    const f = (state.manual || {}).set_investor_flow || {};
    const has = FLOW_GROUPS.some(([k]) => f[k] != null);
    const head = `<h2>ใครซื้อ ใครขายหุ้นไทย (สุทธิ)</h2>`;
    if (!has) return `<section class="card">${head}<p class="empty">ยังไม่ได้กรอก ตัวเลขนี้เป็นข้อมูลเงินไหลจริงจากตลาดหลักทรัพย์ฯ (ไม่ใช่การอนุมาน) แต่ดึงอัตโนมัติไม่ได้ ต้องกรอกเองใน <code>config/manual.json</code></p></section>`;
    const max = Math.max(...FLOW_GROUPS.map(([k]) => Math.abs(f[k] || 0)), 1);
    const rows = FLOW_GROUPS.map(([k, name, desc]) => {
      const v = f[k];
      if (v == null) return `<div class="fl-row"><div class="fl-name">${esc(name)}</div><div class="fl-bar"></div><div class="fl-val num flat">—</div></div>`;
      const w = (Math.abs(v) / max) * 50;
      const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
      return `<div class="fl-row" title="${esc(desc)}"><div class="fl-name">${esc(name)}</div>
        <div class="fl-bar"><span class="fl-fill ${cls}" style="${v >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%"></span></div>
        <div class="fl-val num ${cls}">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div></div>`;
    }).join("");
    const sum = FLOW_GROUPS.reduce((a, [k]) => a + (f[k] || 0), 0);
    const allIn = FLOW_GROUPS.every(([k]) => f[k] != null);
    const fv = f.foreign;
    const summary = fv == null ? "" : `<p>${fv >= 0 ? "ต่างชาติ<b class=\"up\">ซื้อสุทธิ</b>" : "ต่างชาติ<b class=\"down\">ขายสุทธิ</b>"} ${Math.abs(fv).toLocaleString("en-US")} ล้านบาท` +
      (fv < 0 ? " แปลว่ามีเงินไหลออกจากหุ้นไทยจริง" : fv > 0 ? " แปลว่ามีเงินไหลเข้าหุ้นไทยจริง" : "") + `</p>`;
    return `<section class="card">${head}
      ${f._example ? `<div class="banner">ตัวเลขตัวอย่างเพื่อดูหน้าตา ไม่ใช่ข้อมูลจริง</div>` : ""}
      ${summary}
      <div class="fl">${rows}</div>
      <p class="note">หน่วย: ล้านบาท · ขวา/เขียว = ซื้อสุทธิ · ซ้าย/แดง = ขายสุทธิ · วันที่ซื้อขาย ${esc(fmtD(f.trade_date, true))}</p>
      ${f._src === "news" ? `<p class="note">ที่มา: ดึงอัตโนมัติจากพาดหัวข่าว ${f.confirmed ? "· ✓ ตรงกันอย่างน้อย 2 สำนักข่าว" : "· ⚠︎ เจอแค่แหล่งเดียว ยังไม่ยืนยัน"} · ดึงเมื่อ ${esc(fmtDT(f.fetched_at))}</p>
        ${f.status === "stale" ? `<div class="banner">รอบล่าสุดหาตัวเลขในข่าวไม่เจอ แสดงข้อมูลเก่า ณ ${esc(fmtDT(f.fetched_at))}</div>` : ""}
        <ul class="nw-list">${(f.sources || []).map(a => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><span class="nw-meta">${esc(a.source)}</span></li>`).join("")}</ul>
        <p class="note">ข่าวส่วนใหญ่รายงานเฉพาะต่างชาติ กลุ่มอื่นจึงอาจขึ้น "—" ถ้าต้องการครบ 4 กลุ่ม กรอกเองใน config/manual.json (ระบบจะใช้ตัวที่วันที่ใหม่กว่า)</p>`
      : `<p class="note">ที่มา: กรอกเอง · กรอกเมื่อ ${esc(fmtDT(f.entered_at))}</p>`}
      ${allIn && Math.abs(sum) > 50 ? `<p class="note mark unk" style="width:auto">⚠︎ 4 กลุ่มรวมกันได้ ${sum.toLocaleString("en-US")} ล้านบาท (ปกติควรใกล้ 0) ลองตรวจตัวเลขที่กรอก</p>` : ""}
      <details><summary class="note" style="min-height:44px;display:flex;align-items:center">แต่ละกลุ่มคือใคร</summary>
        <ul class="list">${FLOW_GROUPS.map(([, n, d]) => `<li><b>${esc(n)}:</b> ${esc(d)}</li>`).join("")}</ul>
        <p class="note">ทุกการซื้อมีคนขาย 4 กลุ่มจึงรวมกันได้ศูนย์ ที่น่าดูคือ "ใครเป็นฝ่ายซื้อ ใครเป็นฝ่ายขาย" เช่น ต่างชาติขาย รายย่อยรับซื้อ มักแปลว่าเงินก้อนใหญ่กำลังออก</p></details>
    </section>`;
  }
  function spreadCard() {
    const s = state.latest.series, a = s.US10Y, b = s.US2Y;
    if (!a || !b || a.last == null || b.last == null) return `<section class="card"><h2>ส่วนต่างดอกเบี้ย 10 ปี − 2 ปี</h2><p class="empty">ต้องมีข้อมูลพันธบัตร 2 ปีก่อน (มาในขั้นที่ 2)</p></section>`;
    const v = a.last - b.last;
    return `<section class="card"><h2>ส่วนต่างดอกเบี้ย 10 ปี − 2 ปี</h2>
      <p class="t-val num ${v < 0 ? "down" : ""}">${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} จุด</p>
      <p>${v < 0 ? "ติดลบ (ดอกเบี้ยสั้นสูงกว่ายาว) ในอดีตมักเป็นสัญญาณเตือนเศรษฐกิจถดถอย" : "เป็นบวก ปกติ ดอกเบี้ยยาวสูงกว่าสั้น"}</p></section>`;
  }
  const ago = iso => {
    const m = Math.round((Date.now() - new Date(iso)) / 6e4);
    if (m < 60) return `${Math.max(1, m)} นาทีที่แล้ว`;
    if (m < 1440) return `${Math.round(m / 60)} ชม.ที่แล้ว`;
    return fmtD(iso);
  };
  function newsHTML(topic) {
    if (!topic) return "";
    const q = ((state.newsCfg || {}).topics || {})[topic];
    const t = ((state.news || {}).topics || {})[topic];
    const items = (t && t.items) || [];
    const search = q ? `<a class="nw-search" href="https://news.google.com/search?q=${encodeURIComponent(q.th)}&hl=th&gl=TH&ceid=TH:th" target="_blank" rel="noopener">ค้นข่าวล่าสุดเรื่องนี้ ↗</a>` : "";
    const li = a => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
      <span class="nw-meta">${esc(a.source || "")}${a.lang === "en" ? " · อังกฤษ" : ""} · ${esc(ago(a.published))}</span></li>`;
    const stale = t && t.status === "stale" ? `<p class="nw-meta">ดึงข่าวรอบล่าสุดไม่สำเร็จ แสดงข่าวเก่า ณ ${esc(fmtDT(t.fetched_at))}</p>` : "";
    if (!items.length) return `<div class="nw">${search}</div>`;
    const first = items.slice(0, 2), more = items.slice(2);
    return `<div class="nw"><ul class="nw-list">${first.map(li).join("")}</ul>
      ${more.length ? `<details class="nw-more"><summary>ข่าวอีก ${more.length} ข่าว</summary><ul class="nw-list">${more.map(li).join("")}</ul></details>` : ""}
      ${stale}${search}</div>`;
  }
  function newsNote() {
    const g = (state.news || {}).generated_at;
    return g ? `ข่าวจาก Google News อัปเดต ${fmtDT(g)} กดหัวข่าวเพื่ออ่านที่เว็บต้นฉบับ` : "ระบบดึงข่าวอัตโนมัติจะเริ่มทำงานเมื่อตั้ง GitHub Actions (ขั้นที่ 3) ตอนนี้กด \"ค้นข่าวล่าสุด\" ได้ก่อน";
  }
  function factorsHTML(id, inSheet = false) {
    const F = window.FACTORS[id]; if (!F) return "";
    const S = state.latest.series, M = state.manual;
    let up = 0, down = 0, nodata = 0;
    const row = f => {
      let t = null; try { t = f.today(S, M); } catch (e) {}
      if (t === "up") up++; if (t === "down") down++; if (f.daily && t == null) nodata++;
      const chip = t === "up" ? `<span class="fx-chip on">▲ วันนี้: ${F.upWord}</span>`
        : t === "down" ? `<span class="fx-chip on">▼ วันนี้: ${F.downWord}</span>`
        : t === "flat" ? `<span class="fx-chip na">วันนี้: ไม่ชัด</span>`
        : f.daily ? `<span class="fx-chip na">ไม่มีข้อมูล</span>` : "";
      return `<li class="fx"><div class="fx-head"><b>${esc(f.name)}</b>${chip}</div><p>${esc(f.how)}</p><p class="note">${esc(f.gauge)}</p>${newsHTML(f.news)}</li>`;
    };
    const daily = F.items.filter(f => f.daily).map(row).join("");
    const long = F.items.filter(f => !f.daily);
    return `<section class="card fx-card"><h2>${esc(F.title)}</h2>
      <p class="fx-sum">วันนี้: <b>▲ ${F.upWord} ${up}</b> · <b>▼ ${F.downWord} ${down}</b>${nodata ? ` · <span class="note">ไม่มีข้อมูล ${nodata}</span>` : ""}</p>
      <ul class="fx-list">${daily}</ul>
      ${long.length ? `<details class="fx-more"><summary>ปัจจัยระยะยาว ${long.length} ข้อ (ไม่ได้วัดรายวัน ติดตามจากข่าว)</summary><ul class="fx-list">${long.map(row).join("")}</ul></details>` : ""}
      <p class="note">"วันนี้" อนุมานจากการขยับของราคาและตัวเลขที่กรอก ไม่ได้อ่านข่าว · ${newsNote()}</p></section>`;
  }
  const tabFactors = id => (window.TAB_FACTORS[id] || []).map(f => factorsHTML(f)).join("");
  const EXTRA = {
    overview: () => tabFactors("overview"),
    thai: () => tabFactors("thai") + `<section class="card"><h2>ตลาดโลกส่งผลถึงไทยยังไง</h2>
      <ul class="list"><li>ดอลลาร์แข็ง/ดอกเบี้ยสหรัฐสูง → ต่างชาติมักดึงเงินกลับ → หุ้นไทยลง บาทอ่อน</li>
      <li>บาทอ่อน (ดอลลาร์/บาทขึ้น) → ของนำเข้าแพงขึ้น แต่ส่งออกและท่องเที่ยวได้ประโยชน์</li>
      <li>SET ปิดเร็วกว่าสหรัฐ ราคาปิด SET จึงมักเป็นของ "วันก่อนหน้า" เมื่อเทียบกับหุ้นสหรัฐ</li></ul></section>`,
    gold: () => tabFactors("gold") + `<section class="card">
      <p class="note">ราคาทองในไทย (บาทละ) อิงราคาโลก × ค่าเงินบาท แต่สมาคมค้าทองคำกำหนดเอง จึงไม่คำนวณให้ที่นี่เพื่อไม่ให้เข้าใจผิด</p></section>`,
    rates: () => spreadCard() + manualFed() + tabFactors("rates"),
  };

  function render() {
    const L = state.latest;
    const tab = TABS.find(t => t.id === state.tab) || TABS[0];
    const banners = [];
    if (L.is_sample) banners.push("ข้อมูลตัวอย่าง (ขั้นที่ 1): ตัวเลขล่าสุดมาจากที่ให้ไว้ ส่วนกราฟย้อนหลัง และ % ที่ไม่ได้ให้ไว้ เป็นตัวเลขจำลองเพื่อดูหน้าตาเท่านั้น");
    const ageH = (Date.now() - new Date(L.generated_at)) / 36e5;
    if (!L.is_sample && ageH > 26) banners.push(`ข้อมูลไม่ได้อัปเดตมาตั้งแต่ ${fmtDT(L.generated_at)} ระบบดึงข้อมูลอาจมีปัญหา`);
    if (state.offline) banners.push("ออฟไลน์อยู่ แสดงข้อมูลที่โหลดไว้ล่าสุด");
    $("#banners").innerHTML = banners.map(b => `<div class="banner">${esc(b)}</div>`).join("");
    $("#mode").innerHTML = modeHTML();
    $("#tabs").innerHTML = TABS.map(t => `<button class="tab" role="tab" id="tab-${t.id}" aria-selected="${t.id === tab.id}" data-tab="${t.id}">${esc(t.name)}</button>`).join("");
    $("#panel").innerHTML = `${tab.id === "thai" ? manualFlow() : ""}<div class="grid">${tab.keys.map(tileHTML).join("")}</div>${EXTRA[tab.id]()}`;
    $("#panel").setAttribute("aria-labelledby", "tab-" + tab.id);
  }

  /* ---------- แผ่นรายละเอียด ---------- */
  function whyToday(key, s) {
    const m = IND[key], d = dir(key, s.chg1d);
    if (d === "flat") return `วันนี้แทบไม่ขยับ (${fmtChg(key, s.chg1d)})`;
    const M = computeMode(state.latest.series);
    const related = M.primary.checks.filter(c => c.result === true).map(c => c.label);
    let t = `วันนี้${d === "up" ? "ขึ้น" : "ลง"} ${fmtChg(key, s.chg1d)} โดยทั่วไปแปลว่า${d === "up" ? m.up : m.down}`;
    if (M.primary.id !== "normal") t += ` ซึ่งเข้ากับภาพรวมวันนี้ที่ตลาด "${M.primary.name}" (สัญญาณที่เข้า: ${related.join(", ")})`;
    return t;
  }

  function openDetail(key) {
    const m = IND[key], s = state.latest.series[key] || { status: "missing" };
    const h = state.history[key] || [];
    const dlg = $("#sheet"), missing = s.status === "missing" || s.last == null;
    let range = 90;
    dlg.innerHTML = `<div class="sheet-in">
      <div class="grab" aria-hidden="true"></div>
      <div class="sheet-head"><div><h2>${esc(m.name)}</h2><div class="t-short">${esc(m.short)} · ${esc(m.symbol)}</div></div>
        <button class="close" aria-label="ปิด">✕</button></div>
      <div class="readout"><span class="t-val" id="ro-val">${missing ? "—" : esc(fmtVal(key, s.last))}</span>
        <span class="t-chg ${dir(key, s.chg1d)}" id="ro-chg">${missing ? "" : arrow(dir(key, s.chg1d)) + " " + esc(fmtChg(key, s.chg1d))}</span>
        <span class="when" id="ro-when">${missing ? "ไม่มีข้อมูล" : "ราคาปิด " + esc(fmtD(s.asof, true))}</span></div>
      ${s.status === "stale" ? `<div class="banner">ดึงข้อมูลรอบล่าสุดไม่สำเร็จ แสดงข้อมูลเก่า ณ ${esc(fmtDT(s.fetched_at))}</div>` : ""}
      ${s.note ? `<div class="banner">${esc(s.note)}</div>` : ""}
      <div class="range" role="group" aria-label="ช่วงกราฟ"><button data-r="30" aria-pressed="false">30 วัน</button><button data-r="90" aria-pressed="true">90 วัน</button></div>
      <svg class="chart" id="big" role="img" aria-label="กราฟ ${esc(m.name)}"></svg>
      <div class="stats"><div><span>วันนี้</span><strong class="${dir(key, s.chg1d)}">${esc(fmtChg(key, s.chg1d))}</strong></div>
        <div><span>5 วัน</span><strong class="${dir(key, s.chg5d)}">${esc(fmtChg(key, s.chg5d))}</strong></div>
        <div><span>30 วัน</span><strong class="${dir(key, s.chg30d)}">${esc(fmtChg(key, s.chg30d))}</strong></div></div>
      <div class="explain">
        <div><h3>มันคืออะไร</h3><p>${esc(m.what)}</p></div>
        <div><h3>ขึ้น/ลง แปลว่าอะไร</h3><p><span class="up">ขึ้น:</span> ${esc(m.up)}<br><span class="down">ลง:</span> ${esc(m.down)}</p></div>
        ${missing ? "" : `<div><h3>ทำไมวันนี้ขยับ</h3><p>${esc(whyToday(key, s))}</p><p class="note">อธิบายจากความสัมพันธ์ของราคา ไม่ได้อ่านข่าว</p></div>`}
        ${window.KEY_FACTORS[key] ? factorsHTML(window.KEY_FACTORS[key], true) : ""}
        <p class="note">ที่มา: ${esc(s.source || "—")} · ดึงเมื่อ ${esc(fmtDT(s.fetched_at))}</p>
      </div></div>`;
    const svg = $("#big", dlg);
    const draw = () => {
      const pts = h.slice(-Math.round(range * 5 / 7));
      bigChart(svg, key, pts, p => {
        if (p) { $("#ro-val", dlg).textContent = fmtVal(key, p[1]); $("#ro-when", dlg).textContent = fmtD(p[0], true); $("#ro-chg", dlg).style.visibility = "hidden"; }
        else if (!missing) { $("#ro-val", dlg).textContent = fmtVal(key, s.last); $("#ro-when", dlg).textContent = "ราคาปิด " + fmtD(s.asof, true); $("#ro-chg", dlg).style.visibility = ""; }
      });
    };
    dlg.querySelectorAll(".range button").forEach(b => b.onclick = () => {
      range = +b.dataset.r; dlg.querySelectorAll(".range button").forEach(x => x.setAttribute("aria-pressed", x === b)); draw();
    });
    $(".close", dlg).onclick = () => dlg.close();
    dlg.showModal();
    requestAnimationFrame(draw);
  }

  function openGlossary() {
    const dlg = $("#sheet");
    dlg.innerHTML = `<div class="sheet-in"><div class="grab" aria-hidden="true"></div>
      <div class="sheet-head"><h2>คำศัพท์ฉบับเข้าใจง่าย</h2><button class="close" aria-label="ปิด">✕</button></div>
      <dl class="gloss">${window.GLOSSARY.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl></div>`;
    $(".close", dlg).onclick = () => dlg.close();
    dlg.showModal();
  }

  /* ยอดซื้อขายสุทธิ: เลือกระหว่าง "ดึงจากข่าวอัตโนมัติ" กับ "กรอกเอง" — ใช้ตัวที่วันที่ใหม่กว่า (เท่ากันใช้ที่กรอกเอง) */
  function withFlow(manual, auto) {
    const m = (manual || {}).set_investor_flow || {};
    const hasM = ["foreign", "institution", "proprietary", "retail"].some(k => m[k] != null);
    const hasA = auto && auto.foreign != null && auto.status !== "missing";
    let pick = null;
    if (hasM && (!hasA || (m.trade_date || "") >= (auto.trade_date || ""))) pick = { ...m, _src: "manual" };
    else if (hasA) pick = { ...auto, _src: "news" };
    return { ...(manual || {}), set_investor_flow: pick || m };
  }

  /* ---------- เริ่มทำงาน ---------- */
  async function start() {
    try { state.tab = localStorage.getItem("tab") || "overview"; } catch (e) {}
    try {
      const [latest, history, manual, news, newsCfg, setFlow] = await Promise.all([
        loadJSON("data/latest.json"), loadJSON("data/history.json").catch(() => ({})), loadJSON("config/manual.json").catch(() => null),
        loadJSON("data/news.json").catch(() => null), loadJSON("config/news.json").catch(() => null),
        loadJSON("data/set_flow.json").catch(() => null),
      ]);
      Object.assign(state, { latest, history, news, newsCfg, manual: withFlow(manual, setFlow) });
    } catch (e) {
      $("#mode").innerHTML = `<div class="banner">โหลดข้อมูลไม่ได้ ลองเปิดใหม่อีกครั้ง หรือเช็กอินเทอร์เน็ต</div>`;
      return;
    }
    render();
    document.addEventListener("click", ev => {
      const t = ev.target.closest("[data-tab]");
      if (t) { state.tab = t.dataset.tab; try { localStorage.setItem("tab", state.tab); } catch (e) {} render(); return; }
      const k = ev.target.closest(".tile[data-key]");
      if (k) { openDetail(k.dataset.key); return; }
      if (ev.target.closest("#btn-gloss")) openGlossary();
      if (ev.target.closest("#btn-export") && window.openExport) window.openExport();
    });
    $("#sheet").addEventListener("click", ev => { if (ev.target.id === "sheet") ev.target.close(); });
  }

  /* ให้ไฟล์ส่งออก (export.js) ใช้ข้อมูลและตัวช่วยชุดเดียวกัน */
  window.MC = { state, computeMode, flow, fmtVal, fmtChg, fmtDT, fmtD, dir, esc, sparkSVG, factorsToday: id => {
    const F = window.FACTORS[id]; let up = 0, down = 0;
    for (const f of F.items) { let t = null; try { t = f.today(state.latest.series, state.manual); } catch (e) {} if (t === "up") up++; if (t === "down") down++; }
    return { title: F.title, upWord: F.upWord, downWord: F.downWord, up, down };
  } };

  if ("serviceWorker" in navigator && !window.__EMBED__) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", ev => { if (ev.data === "offline") { state.offline = true; if (state.latest) render(); } });
  }
  start();
})();
