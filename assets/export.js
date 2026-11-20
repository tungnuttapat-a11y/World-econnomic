/* ส่งออกข้อมูล: PDF สรุปหน้าเดียว / Excel / CSV / Markdown — ทำในเบราว์เซอร์ทั้งหมด */
(() => {
  "use strict";
  const LIBS = {
    html2canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  };
  const PERIODS = { today: { label: "วันนี้", days: 1 }, d7: { label: "7 วัน", days: 7 }, d30: { label: "30 วัน", days: 30 } };
  const FORMATS = { pdf: "PDF สรุป 1 หน้า", xlsx: "Excel", csv: "CSV", md: "Markdown" };
  const opts = { format: "pdf", period: "today", groups: new Set(["overview", "thai", "gold", "rates"]) };

  const loadScript = src => new Promise((ok, bad) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script"); s.src = src; s.onload = ok;
    s.onerror = () => bad(new Error("โหลดเครื่องมือสร้างไฟล์ไม่ได้ (ต้องต่ออินเทอร์เน็ตครั้งแรก)"));
    document.head.appendChild(s);
  });

  /* ---------- เตรียมข้อมูล ---------- */
  function selectedKeys() {
    const keys = [];
    for (const t of window.TABS) if (opts.groups.has(t.id)) for (const k of t.keys) if (!keys.includes(k)) keys.push(k);
    return keys;
  }
  function windowRows(key, days) {
    const h = (MC.state.history[key] || []);
    if (!h.length) return [];
    const end = new Date(h[h.length - 1][0] + "T00:00:00Z");
    const start = new Date(end - days * 864e5).toISOString().slice(0, 10);
    // รวมจุดเริ่มต้นก่อนช่วง 1 จุด เพื่อคำนวณการเปลี่ยนแปลงทั้งช่วงได้
    const i = h.findIndex(r => r[0] > start);
    return i < 0 ? h.slice(-1) : h.slice(Math.max(0, i - 1));
  }
  function stats(key) {
    const s = MC.state.latest.series[key] || {}, m = window.INDICATORS[key];
    const p = PERIODS[opts.period];
    const base = { key, name: m.name, short: m.short, symbol: m.symbol, unit: m.kind === "yield" ? "%" : (m.suffix || m.prefix || "").trim(),
      last: s.last, asof: s.asof, status: s.status || "missing", source: s.source || "", fetched_at: s.fetched_at,
      chg1d: s.chg1d, chg5d: s.chg5d, chg30d: s.chg30d };
    if (opts.period === "today" || s.last == null) return { ...base, chg: s.chg1d, high: null, low: null, rows: windowRows(key, 7) };
    const rows = windowRows(key, p.days);
    if (rows.length < 2) return { ...base, chg: null, high: null, low: null, rows };
    const a = rows[0][1], b = rows[rows.length - 1][1], vals = rows.slice(1).map(r => r[1]);
    const chg = m.kind === "yield" ? +(b - a).toFixed(3) : +((b / a - 1) * 100).toFixed(2);
    return { ...base, chg, high: Math.max(...vals), low: Math.min(...vals), rows };
  }
  const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }).slice(0, 16).replace(" ", "_").replace(":", "");
  const fname = ext => `market-compass_${stamp()}_${opts.period}.${ext}`;
  const statusTh = s => ({ ok: "ปกติ", stale: "ข้อมูลเก่า", missing: "ไม่มีข้อมูล" }[s] || s);

  /* ---------- CSV ---------- */
  function csvText() {
    const q = v => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const L = [], keys = selectedKeys(), st = keys.map(stats), pl = PERIODS[opts.period].label;
    L.push(["สรุป", "ช่วง: " + pl, "สร้างเมื่อ " + MC.fmtDT(new Date().toISOString())].map(q).join(","));
    L.push(["ตัวชี้วัด", "สัญลักษณ์", "ค่าล่าสุด", "หน่วย", "วันที่ราคา", `เปลี่ยน (${pl})`, "เปลี่ยน 1 วัน", "เปลี่ยน 5 วัน", "เปลี่ยน 30 วัน", "สูงสุดในช่วง", "ต่ำสุดในช่วง", "สถานะ", "ที่มา", "ดึงเมื่อ"].map(q).join(","));
    for (const r of st) L.push([r.name, r.symbol, r.last, r.unit, r.asof, r.chg, r.chg1d, r.chg5d, r.chg30d, r.high, r.low, statusTh(r.status), r.source, r.fetched_at].map(q).join(","));
    L.push("", q("หมายเหตุ: ดอกเบี้ยเปลี่ยนเป็น 'จุด' (เช่น 0.05 = 5 bp) ที่เหลือเป็น %"), "");
    L.push(["ราคาปิดรายวัน", ...keys.map(k => window.INDICATORS[k].name)].map(q).join(","));
    const days = [...new Set(st.flatMap(r => r.rows.map(x => x[0])))].sort();
    for (const d of days) L.push([d, ...st.map(r => (r.rows.find(x => x[0] === d) || [])[1])].map(q).join(","));
    return "﻿" + L.join("\n");   // BOM ให้ Excel อ่านภาษาไทยถูก
  }

  /* ---------- Excel ---------- */
  async function xlsxBlob() {
    await loadScript(LIBS.xlsx);
    const keys = selectedKeys(), st = keys.map(stats), pl = PERIODS[opts.period].label, M = MC.computeMode(MC.state.latest.series);
    const wb = XLSX.utils.book_new();
    const sum = [["เข็มทิศตลาด", "", "สร้างเมื่อ " + MC.fmtDT(new Date().toISOString())],
      ["โหมดตลาด", M.primary.name, "ความมั่นใจ " + M.confidence], ["สรุป", M.primary.sentence], [],
      ["ตัวชี้วัด", "สัญลักษณ์", "ค่าล่าสุด", "หน่วย", "วันที่ราคา", `เปลี่ยน (${pl})`, "1 วัน", "5 วัน", "30 วัน", "สูงสุด", "ต่ำสุด", "สถานะ", "ที่มา"],
      ...st.map(r => [r.name, r.symbol, r.last, r.unit, r.asof, r.chg, r.chg1d, r.chg5d, r.chg30d, r.high, r.low, statusTh(r.status), r.source]),
      [], ["หมายเหตุ", "ดอกเบี้ยเปลี่ยนเป็น 'จุด' ที่เหลือเป็น % · โหมดตลาดอนุมานจากราคา ไม่ใช่ข้อมูลเงินไหลจริง"]];
    const ws1 = XLSX.utils.aoa_to_sheet(sum); ws1["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws1, "สรุป");
    const days = [...new Set(st.flatMap(r => r.rows.map(x => x[0])))].sort();
    const ws2 = XLSX.utils.aoa_to_sheet([["วันที่", ...st.map(r => r.name)], ...days.map(d => [d, ...st.map(r => (r.rows.find(x => x[0] === d) || [])[1] ?? null)])]);
    XLSX.utils.book_append_sheet(wb, ws2, "ราคาปิดรายวัน");
    const f = (MC.state.manual || {}).set_investor_flow || {};
    if (opts.groups.has("thai") && f.foreign != null) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["วันที่ซื้อขาย", f.trade_date], ["ต่างชาติ (ล้านบาท)", f.foreign], ["สถาบัน", f.institution],
        ["บัญชีโบรกเกอร์", f.proprietary], ["รายย่อย", f.retail], ["ที่มา", f._src === "news" ? "พาดหัวข่าว" + (f.confirmed ? " (ยืนยัน 2 แหล่ง)" : " (ยังไม่ยืนยัน)") : "กรอกเอง"]]), "ซื้อขายสุทธิ SET");
    }
    return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------- Markdown ---------- */
  function mdText() {
    const S = MC.state, M = MC.computeMode(S.latest.series), fl = MC.flow(S.latest.series), pl = PERIODS[opts.period].label;
    const st = selectedKeys().map(stats);
    const out = [`# เข็มทิศตลาด — สรุป${pl === "วันนี้" ? "วันนี้" : " " + pl}`, "",
      `อัปเดตข้อมูล: ${MC.fmtDT(S.latest.generated_at)} · สร้างไฟล์: ${MC.fmtDT(new Date().toISOString())}`, "",
      `## ตลาดตอนนี้: ${M.primary.name} (ความมั่นใจ ${M.confidence})`, "", M.primary.sentence, "", `- ${M.confWhy}`,
      ...(M.cause ? [`- ${M.cause}`] : []),
      `- มาตรวัดความกลัว: ${M.fear == null ? "—" : Math.round(M.fear) + "/100 (" + MC.fearBand(M.fear) + ")"}`,
      `- เข้ากับแต่ละโหมด: ${M.results.map(r => `${r.name} ${Math.round(r.score * 100)}%`).join(" · ")}`,
      `- สัญญาณที่เข้า: ${M.primary.checks.filter(c => c.result === true).map(c => c.label).join(", ") || "—"}`,
      `- เงินออกจาก: ${fl.out.map(x => `${x[0]} ${x[1]}`).join(", ") || "—"}`,
      `- เงินเข้า: ${fl.inn.map(x => `${x[0]} ${x[1]}`).join(", ") || "—"}`, "",
      "> อนุมานจากการขยับของราคา ไม่ใช่ข้อมูลเงินไหลเข้าออกจริง", "",
      `## ตัวเลขหลัก (เปลี่ยนแปลง: ${pl})`, "",
      `| ตัวชี้วัด | ล่าสุด | เปลี่ยน (${pl}) | 5 วัน | 30 วัน | วันที่ราคา | สถานะ |`, "|---|---:|---:|---:|---:|---|---|"];
    for (const r of st) out.push(`| ${r.name} | ${MC.fmtVal(r.key, r.last)} | ${MC.fmtChg(r.key, r.chg)} | ${MC.fmtChg(r.key, r.chg5d)} | ${MC.fmtChg(r.key, r.chg30d)} | ${r.asof || "—"} | ${statusTh(r.status)}${r.status === "stale" ? " ณ " + MC.fmtDT(r.fetched_at) : ""} |`);
    const f = (S.manual || {}).set_investor_flow || {};
    if (opts.groups.has("thai") && f.foreign != null) {
      const v = x => x == null ? "—" : (x > 0 ? "+" : "") + x.toLocaleString("en-US");
      out.push("", `## ซื้อขายสุทธิหุ้นไทย (${f.trade_date}, ล้านบาท)`, "", `ต่างชาติ ${v(f.foreign)} · สถาบัน ${v(f.institution)} · โบรกเกอร์ ${v(f.proprietary)} · รายย่อย ${v(f.retail)}`,
        "", `ที่มา: ${f._src === "news" ? "พาดหัวข่าว" + (f.confirmed ? " (ยืนยัน 2 แหล่ง)" : " (ยังไม่ยืนยัน)") : "กรอกเอง"}`);
    }
    const tf = window.TAB_FACTORS, ids = [...new Set([...opts.groups].flatMap(g => tf[g] || []))];
    if (ids.length) {
      out.push("", "## ปัจจัยวันนี้", "");
      for (const id of ids) { const x = MC.factorsToday(id); out.push(`- ${x.title}: ▲ ${x.upWord} ${x.up} · ▼ ${x.downWord} ${x.down}`); }
    }
    out.push("", "---", "ที่มา: Yahoo Finance (yfinance, ไม่เป็นทางการ อาจช้า 15–20 นาที), FRED, พาดหัวข่าว · ใช้ประกอบการตัดสินใจเท่านั้น ไม่ใช่คำแนะนำการลงทุน", "");
    return out.join("\n");
  }

  /* ---------- PDF 1 หน้า (วาดหน้า A4 แล้วถ่ายเป็นภาพ เพื่อให้ภาษาไทยออกถูก) ---------- */
  function reportHTML() {
    const S = MC.state, M = MC.computeMode(S.latest.series), fl = MC.flow(S.latest.series), pl = PERIODS[opts.period].label, e = MC.esc;
    const st = selectedKeys().map(stats);
    const f = (S.manual || {}).set_investor_flow || {};
    const ids = [...new Set([...opts.groups].flatMap(g => window.TAB_FACTORS[g] || []))];
    return `<div class="rp">
      <div class="rp-head"><div><b>เข็มทิศตลาด</b> · สรุป${pl === "วันนี้" ? "วันนี้" : " " + pl}</div><div>ข้อมูล ${e(MC.fmtDT(S.latest.generated_at))}</div></div>
      <div class="rp-mode ${M.primary.color}"><div class="rp-k">ตลาดตอนนี้ · ความมั่นใจ ${e(M.confidence)}</div>
        <div class="rp-mname">${e(M.primary.name)}</div><div>${e(M.primary.sentence)}</div>
        ${M.cause ? `<div>${e(M.cause)}</div>` : ""}
        <div class="rp-k">มาตรวัดความกลัว ${M.fear == null ? "—" : Math.round(M.fear) + "/100 (" + e(MC.fearBand(M.fear)) + ")"} · เข้ากับแต่ละโหมด: ${e(M.results.map(r => `${r.name} ${Math.round(r.score * 100)}%`).join(" · "))}</div>
        <div class="rp-k">${e(M.confWhy)} · สัญญาณที่เข้า: ${e(M.primary.checks.filter(c => c.result === true).map(c => c.label).join(", ") || "—")}</div>
        <div class="rp-k">เงินออกจาก: ${e(fl.out.map(x => x[0] + " " + x[1]).join(", ") || "—")} · เงินเข้า: ${e(fl.inn.map(x => x[0] + " " + x[1]).join(", ") || "—")}</div></div>
      <table class="rp-t"><thead><tr><th>ตัวชี้วัด</th><th>ล่าสุด</th><th>${e(pl)}</th><th>5 วัน</th><th>30 วัน</th><th>แนวโน้ม</th></tr></thead><tbody>
      ${st.map(r => `<tr><td>${e(r.name)}<div class="rp-s">${r.asof ? "ราคา " + e(MC.fmtD(r.asof)) : ""}${r.status === "stale" ? " · ข้อมูลเก่า" : r.status === "missing" ? " · ไม่มีข้อมูล" : ""}</div></td>
        <td>${e(MC.fmtVal(r.key, r.last))}</td><td class="${MC.dir(r.key, r.chg)}">${e(MC.fmtChg(r.key, r.chg))}</td>
        <td class="${MC.dir(r.key, r.chg5d)}">${e(MC.fmtChg(r.key, r.chg5d))}</td><td class="${MC.dir(r.key, r.chg30d)}">${e(MC.fmtChg(r.key, r.chg30d))}</td>
        <td class="rp-sp">${MC.sparkSVG(r.rows.length > 1 ? r.rows : (MC.state.history[r.key] || []).slice(-22), MC.dir(r.key, r.chg))}</td></tr>`).join("")}
      </tbody></table>
      ${opts.groups.has("thai") && f.foreign != null ? `<div class="rp-box"><b>ซื้อขายสุทธิหุ้นไทย ${e(MC.fmtD(f.trade_date, true))} (ล้านบาท):</b>
        ต่างชาติ ${e(f.foreign)} · สถาบัน ${e(f.institution ?? "—")} · โบรกเกอร์ ${e(f.proprietary ?? "—")} · รายย่อย ${e(f.retail ?? "—")}
        <span class="rp-s">(${f._src === "news" ? "จากพาดหัวข่าว" + (f.confirmed ? " ยืนยัน 2 แหล่ง" : " ยังไม่ยืนยัน") : "กรอกเอง"})</span></div>` : ""}
      ${ids.length ? `<div class="rp-box"><b>ปัจจัยวันนี้</b>${ids.map(id => { const x = MC.factorsToday(id); return `<div>${e(x.title)}: ▲ ${e(x.upWord)} ${x.up} · ▼ ${e(x.downWord)} ${x.down}</div>`; }).join("")}</div>` : ""}
      <div class="rp-foot">โหมดตลาดอนุมานจากการขยับของราคา ไม่ใช่ข้อมูลเงินไหลจริง · ที่มา: Yahoo Finance (ไม่เป็นทางการ อาจช้า 15–20 นาที), FRED, พาดหัวข่าว · ไม่ใช่คำแนะนำการลงทุน · สร้างเมื่อ ${e(MC.fmtDT(new Date().toISOString()))}</div>
    </div>`;
  }
  async function pdfBlob() {
    await Promise.all([loadScript(LIBS.html2canvas), loadScript(LIBS.jspdf)]);
    const host = document.createElement("div");
    host.className = "rp-host"; host.innerHTML = reportHTML();
    document.body.appendChild(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const pdf = new jspdf.jsPDF({ unit: "mm", format: "a4" });
      const W = 210, H = 297, m = 8;
      let w = W - m * 2, h = canvas.height * w / canvas.width;
      if (h > H - m * 2) { h = H - m * 2; w = canvas.width * h / canvas.height; }   // ย่อให้พอดี 1 หน้า
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (W - w) / 2, m, w, h);
      return pdf.output("blob");
    } finally { host.remove(); }
  }

  /* ---------- บันทึก / แชร์ ---------- */
  async function deliver(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    const res = document.getElementById("ex-result");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    let share = "";
    if (navigator.canShare && navigator.canShare({ files: [file] })) share = `<button class="ex-go ex-share" id="ex-share" type="button">แชร์ / บันทึกลงแอปอื่น</button>`;
    res.innerHTML = `<p>✓ สร้างไฟล์ <b>${MC.esc(name)}</b> แล้ว ถ้าไม่เห็นการดาวน์โหลด กด <a href="${url}" download="${MC.esc(name)}">ดาวน์โหลดอีกครั้ง</a></p>${share}`;
    const sb = document.getElementById("ex-share");
    if (sb) sb.onclick = () => navigator.share({ files: [file], title: "เข็มทิศตลาด" }).catch(() => {});
  }
  async function run() {
    const btn = document.getElementById("ex-go"), res = document.getElementById("ex-result");
    if (!opts.groups.size) { res.innerHTML = `<p class="ex-err">เลือกกลุ่มข้อมูลอย่างน้อย 1 กลุ่ม</p>`; return; }
    btn.disabled = true; btn.textContent = "กำลังสร้างไฟล์…"; res.innerHTML = "";
    try {
      if (opts.format === "csv") await deliver(new Blob([csvText()], { type: "text/csv;charset=utf-8" }), fname("csv"));
      else if (opts.format === "md") await deliver(new Blob([mdText()], { type: "text/markdown;charset=utf-8" }), fname("md"));
      else if (opts.format === "xlsx") await deliver(await xlsxBlob(), fname("xlsx"));
      else await deliver(await pdfBlob(), fname("pdf"));
    } catch (e) {
      res.innerHTML = `<p class="ex-err">สร้างไฟล์ไม่สำเร็จ: ${MC.esc(e.message)} ลองเลือก CSV หรือ Markdown ซึ่งไม่ต้องโหลดอะไรเพิ่ม</p>`;
    } finally { btn.disabled = false; btn.textContent = "สร้างไฟล์"; }
  }

  /* ---------- หน้าต่างเลือก ---------- */
  const seg = (name, items, cur) => `<div class="ex-seg" role="group" aria-label="${name}">${Object.entries(items).map(([k, v]) =>
    `<button type="button" data-${name}="${k}" aria-pressed="${k === cur}">${typeof v === "string" ? v : v.label}</button>`).join("")}</div>`;
  window.openExport = () => {
    const dlg = document.getElementById("sheet");
    const draw = () => {
      dlg.innerHTML = `<div class="sheet-in"><div class="grab" aria-hidden="true"></div>
        <div class="sheet-head"><h2>ส่งออกข้อมูล</h2><button class="close" aria-label="ปิด">✕</button></div>
        <div class="ex-row"><div class="ex-lb">รูปแบบไฟล์</div>${seg("format", FORMATS, opts.format)}
          <p class="note">${{ pdf: "สรุปหน้าเดียว ขนาด A4 เหมาะส่งต่อหรือเก็บไว้อ่าน", xlsx: "ตัวเลขดิบ 2 แผ่นงาน: สรุป และราคาปิดรายวัน", csv: "ตัวเลขดิบ เปิดได้ทั้ง Excel และ Google Sheets", md: "ข้อความสรุป วางต่อใน Notion/Obsidian/LINE ได้" }[opts.format]}</p></div>
        <div class="ex-row"><div class="ex-lb">ช่วงเวลา</div>${seg("period", PERIODS, opts.period)}</div>
        <div class="ex-row"><div class="ex-lb">กลุ่มข้อมูล</div><div class="ex-checks">${window.TABS.map(t =>
          `<label class="ex-check"><input type="checkbox" id="ex-g-${t.id}" data-group="${t.id}" ${opts.groups.has(t.id) ? "checked" : ""}> ${MC.esc(t.name)}</label>`).join("")}</div></div>
        <button class="ex-go" id="ex-go" type="button">สร้างไฟล์</button>
        <div id="ex-result" aria-live="polite"></div>
        <p class="note">ไฟล์สร้างในเครื่องของคุณ ไม่มีการส่งข้อมูลออกไปไหน${opts.format === "pdf" || opts.format === "xlsx" ? " · ครั้งแรกต้องต่ออินเทอร์เน็ตเพื่อโหลดเครื่องมือสร้างไฟล์" : ""}</p></div>`;
      dlg.querySelector(".close").onclick = () => dlg.close();
      dlg.querySelectorAll("[data-format]").forEach(b => b.onclick = () => { opts.format = b.dataset.format; draw(); });
      dlg.querySelectorAll("[data-period]").forEach(b => b.onclick = () => { opts.period = b.dataset.period; draw(); });
      dlg.querySelectorAll("[data-group]").forEach(c => c.onchange = () => { c.checked ? opts.groups.add(c.dataset.group) : opts.groups.delete(c.dataset.group); });
      document.getElementById("ex-go").onclick = run;
    };
    draw();
    if (!dlg.open) dlg.showModal();
  };
  window.__exportTest = { csvText, mdText, reportHTML, opts };
})();
