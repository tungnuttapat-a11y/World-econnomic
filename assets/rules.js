/* =====================================================================
   กฎตัดสิน "ตลาดตอนนี้กลัวอะไร" — แก้ไฟล์นี้ไฟล์เดียวพอ
   ---------------------------------------------------------------------
   แนวคิดแบบสถาบันการเงิน (ใช้ข้อมูลฟรี):
   • ไม่ใช้เกณฑ์ % ตายตัว แต่ดูว่า "ขยับผิดปกติแค่ไหน" (sigma)
       sigma 1 = ขยับเท่ากับวันปกติ, 2 = แรงเป็น 2 เท่าของปกติ
       (คำนวณจากข้อมูลย้อนหลัง 1 ปี ใน scripts/regime.py)
   • ใช้ "มาตรวัดความกลัว 0-100" (เทียบกับอดีต 2 ปี) เป็นด่านแรก
   • แต่ละโหมดมี "เงื่อนไขบังคับ" (must) ที่โหมดอื่นมีไม่ได้ จึงไม่ทับกัน
   • ผลเป็น "ความน่าจะเป็น" ของทุกโหมด ไม่ฟันธงคำเดียว
   • ทั้งหมดอนุมานจากราคา ไม่ใช่ข้อมูลเงินไหลเข้าออกจริง
   ===================================================================== */

/* ---------- เกณฑ์ (แก้ตรงนี้ได้เลย) ---------- */
const T = {
  move: 0.5,        // ขยับ "ชัด" = เกิน 0.5 เท่าของการขยับปกติ
  bigMove: 1.5,     // ขยับ "แรง"
  fearHigh: 75,     // มาตรวัดความกลัวตั้งแต่ 75 = กลัวมาก (เงื่อนไขของโหมดตื่นตระหนก)
  fearLow: 45,      // ต่ำกว่า 45 = ตลาดไม่ได้กลัว
  sbTogether: 0.2,  // หุ้นกับพันธบัตรเดินทางเดียวกัน (correlation 20 วัน) เกินค่านี้
  breadth: 4,       // ตื่นตระหนก: อย่างน้อยกี่ใน 6 สินทรัพย์ลงพร้อมกัน
  cashPile: 80,     // เงินเข้ากองทุนตลาดเงิน 4 สัปดาห์ สูงกว่ากี่ % ของอดีต = แห่พักเงิน
  rateHigh: 4.5,    // ดอกเบี้ย 10 ปี ระดับ "สูง"
};
/* ถ้ายังไม่มีข้อมูลย้อนหลังพอคำนวณ sigma ใช้ "การขยับปกติต่อวัน" โดยประมาณนี้แทน */
const TYPICAL = { SPX: 1, IXIC: 1.3, GOLD: 1, DXY: 0.4, US10Y: 0.06, US2Y: 0.06, VIX: 7, WTI: 2, BTC: 3,
  SET: 0.8, USDTHB: 0.4, COPPER: 1.5, HY: 0.05, MOVE: 4 };

/* ---------- ตัวช่วยอ่านค่า (คืน null ถ้าไม่มีข้อมูล) ---------- */
function makeCtx(series, regime, manual) {
  const R = regime || {};
  const sg = (k, d5) => {
    const x = R.sigma && R.sigma[k] && R.sigma[k][d5 ? "d5" : "d1"];
    if (x != null) return x;
    const s = series[k]; const c = s && (d5 ? s.chg5d : s.chg1d);
    return c == null || !TYPICAL[k] ? null : c / (TYPICAL[k] * (d5 ? Math.sqrt(5) : 1));
  };
  const lvl = k => (series[k] && series[k].last != null ? series[k].last : null);
  let fear = R.fear ? R.fear.score : null;
  if (fear == null && lvl("VIX") != null) fear = Math.max(0, Math.min(100, ((lvl("VIX") - 12) / 28) * 100)); // สำรอง: จาก VIX อย่างเดียว
  const vixts = lvl("VIX") != null && lvl("VIX3M") ? lvl("VIX") / lvl("VIX3M") : null;
  return { sg, lvl, fear, vixts, sb20: R.stock_bond ? R.stock_bond.c20 : null, cash: R.cash, manual };
}
const up = (v, t = T.move) => (v == null ? null : v >= t);
const dn = (v, t = T.move) => (v == null ? null : v <= -t);
const any = (...xs) => (xs.every(x => x == null) ? null : xs.some(x => x === true));

/* ---------- โหมดต่าง ๆ ----------
   w = น้ำหนัก, must = ต้องเข้า ไม่งั้นโหมดนี้แทบเป็นไปไม่ได้ */
window.MODE_RULES = [
  {
    id: "rates", name: "กลัวดอกเบี้ย", color: "rates",
    sentence: "ตลาดกลัวดอกเบี้ยสูงนาน: ขายหุ้นและพันธบัตรพร้อมกัน เงินไปพักที่ดอลลาร์/เงินสดที่ได้ดอกเบี้ยดี",
    conditions: [
      { must: true, w: 3, label: "ดอกเบี้ย 10 ปีขึ้นชัด (วันนี้หรือ 5 วัน)", check: c => any(up(c.sg("US10Y")), up(c.sg("US10Y", true))) },
      { w: 2, label: "หุ้นกับพันธบัตรลงพร้อมกัน (20 วันล่าสุด)", check: c => (c.sb20 == null ? null : c.sb20 >= T.sbTogether) },
      { w: 1, label: "ดอลลาร์แข็ง", check: c => up(c.sg("DXY")) },
      { w: 1, label: "ทองลง", check: c => dn(c.sg("GOLD")) },
      { w: 1, label: "หุ้นเทคฯ ลงหนักกว่าตลาด", check: c => { const a = c.sg("IXIC"), b = c.sg("SPX"); return a == null || b == null ? null : a < b - 0.3 && a < 0; } },
      { w: 1, label: `ดอกเบี้ย 10 ปีอยู่ระดับสูง (≥ ${T.rateHigh}%)`, check: c => (c.lvl("US10Y") == null ? null : c.lvl("US10Y") >= T.rateHigh) },
    ],
  },
  {
    id: "recession", name: "กลัวเศรษฐกิจถดถอย", color: "recession",
    sentence: "ตลาดกลัวเศรษฐกิจชะลอ: เงินหนีจากหุ้นไปหาพันธบัตรและทอง",
    conditions: [
      { must: true, w: 3, label: "ดอกเบี้ย 10 ปีลงชัด (คนแห่ซื้อพันธบัตร)", check: c => any(dn(c.sg("US10Y")), dn(c.sg("US10Y", true))) },
      { w: 2, label: "หุ้นลงแต่พันธบัตรขึ้น (20 วันล่าสุดเดินสวนกัน)", check: c => (c.sb20 == null ? null : c.sb20 <= -T.sbTogether) },
      { w: 1, label: "ทองขึ้น", check: c => up(c.sg("GOLD")) },
      { w: 1, label: "น้ำมันลง", check: c => dn(c.sg("WTI")) },
      { w: 1, label: "ทองแดงลง (5 วัน)", check: c => dn(c.sg("COPPER", true)) },
      { w: 1, label: "ส่วนต่างหุ้นกู้ขยะกว้างขึ้น (5 วัน)", check: c => up(c.sg("HY", true)) },
    ],
  },
  {
    id: "panic", name: "ตื่นตระหนก ขายทุกอย่าง", color: "panic",
    sentence: "ตลาดตื่นตระหนก: เทขายแทบทุกอย่าง รวมถึงทองและพันธบัตร เพื่อถือเงินสด",
    conditions: [
      { must: true, w: 3, label: `มาตรวัดความกลัวสูงมาก (≥ ${T.fearHigh})`, check: c => (c.fear == null ? null : c.fear >= T.fearHigh) },
      { w: 2, label: `ลงพร้อมกันอย่างน้อย ${T.breadth} ใน 6 (หุ้นสหรัฐ ทอง พันธบัตร Bitcoin น้ำมัน หุ้นไทย)`, check: c => {
          const xs = [dn(c.sg("SPX")), dn(c.sg("GOLD")), up(c.sg("US10Y")), dn(c.sg("BTC")), dn(c.sg("WTI")), dn(c.sg("SET"))];
          if (xs.filter(x => x != null).length < 4) return null;
          return xs.filter(x => x === true).length >= T.breadth; } },
      { w: 2, label: "VIX ระยะสั้นสูงกว่าระยะ 3 เดือน (กลัวเฉียบพลัน)", check: c => (c.vixts == null ? null : c.vixts > 1) },
      { w: 1, label: "ดอลลาร์แข็ง (แห่ถือดอลลาร์)", check: c => up(c.sg("DXY")) },
    ],
  },
  {
    id: "waiting", name: "พักเงินรอดู", color: "waiting",
    sentence: "ตลาดไม่ได้ตื่นกลัว แต่เงินไหลเข้าไปพักในกองทุนตลาดเงิน: นักลงทุนรอดูหรือมองว่าของแพง",
    conditions: [
      { must: true, w: 3, label: `เงินเข้ากองทุนตลาดเงินมากผิดปกติ (สูงกว่า ${T.cashPile}% ของอดีต)`, check: c => (!c.cash || c.cash.pct == null ? null : c.cash.pct >= T.cashPile) },
      { must: true, w: 2, label: `มาตรวัดความกลัวไม่สูง (< ${T.fearLow + 10})`, check: c => (c.fear == null ? null : c.fear < T.fearLow + 10) },
      { w: 1, label: "หุ้นไม่ขยับแรง (5 วัน)", check: c => { const x = c.sg("SPX", true); return x == null ? null : Math.abs(x) < 1; } },
    ],
  },
  {
    id: "normal", name: "ปกติ / กล้าเสี่ยง", color: "normal",
    sentence: "ตลาดไม่ได้กลัว: นักลงทุนยังกล้าถือหุ้นและสินทรัพย์เสี่ยง",
    conditions: [
      { must: true, w: 3, label: `มาตรวัดความกลัวต่ำ (< ${T.fearLow})`, check: c => (c.fear == null ? null : c.fear < T.fearLow) },
      { w: 1, label: "หุ้นไม่ลง (5 วัน)", check: c => { const x = c.sg("SPX", true); return x == null ? null : x > -T.move; } },
      { w: 1, label: "ส่วนต่างหุ้นกู้ขยะไม่กว้างขึ้น (5 วัน)", check: c => { const x = c.sg("HY", true); return x == null ? null : x < T.move; } },
      { w: 1, label: "VIX ระยะสั้นต่ำกว่าระยะ 3 เดือน", check: c => (c.vixts == null ? null : c.vixts < 0.95) },
    ],
  },
];

/* ---------- วิธีให้คะแนน ----------
   คะแนน = น้ำหนักข้อที่เข้า ÷ น้ำหนักทั้งหมด
   ถ้า must ไม่เข้า -> คูณ 0.1, ถ้า must ไม่ทราบ -> คูณ 0.5
   ความน่าจะเป็น = คะแนน² ÷ ผลรวม (ให้ตัวเด่นเด่นขึ้น) */
window.classifyMarket = function (series, regime, manual) {
  const c = makeCtx(series || {}, regime, manual);
  const results = window.MODE_RULES.map(m => {
    let got = 0, total = 0, unknownW = 0, factor = 1;
    const checks = m.conditions.map(k => {
      let r = null;
      try { r = k.check(c); } catch (e) { r = null; }
      total += k.w;
      if (r === true) got += k.w;
      if (r == null) unknownW += k.w;
      if (k.must && r === false) factor = Math.min(factor, 0.1);
      if (k.must && r == null) factor = Math.min(factor, 0.5);
      return { label: k.label, result: r, w: k.w, must: !!k.must };
    });
    const score = (got / total) * factor;
    return { ...m, checks, met: checks.filter(x => x.result === true).length, total: checks.length,
      unknown: checks.filter(x => x.result == null).length, unknownShare: unknownW / total, score };
  });
  const sum = results.reduce((a, r) => a + r.score ** 2, 0);
  results.forEach(r => (r.p = sum ? r.score ** 2 / sum : 0));
  results.sort((a, b) => b.p - a.p);
  // ตื่นตระหนกคือ "ระดับความรุนแรง" ถ้าเข้าชัด ให้ขึ้นก่อน แล้วบอกต้นเหตุ (ดอกเบี้ย/ถดถอย) แยก
  const pz = results.find(r => r.id === "panic");
  if (pz && pz.score >= 0.75 && results[0] !== pz) { results.splice(results.indexOf(pz), 1); results.unshift(pz); }
  const [top, second] = results;
  let primary = top, confidence, confWhy;
  if (!sum || top.score < 0.3) {
    primary = { ...window.MODE_MIXED, checks: top.checks, met: top.met, total: top.total, p: 0 };
    confidence = "ต่ำ"; confWhy = `ยังไม่มีโหมดไหนเด่น (ใกล้สุดคือ "${top.name}")`;
  } else if (top.unknownShare > 0.35) {
    confidence = "ต่ำ"; confWhy = "ข้อมูลบางส่วนยังไม่ครบ ตรวจได้ไม่ครบทุกข้อ";
  } else if (top.id === "panic" && top.score >= 0.75) {
    confidence = top.score >= 0.9 ? "สูง" : "กลาง"; confWhy = "ความกลัวสูงมาก และสินทรัพย์ส่วนใหญ่ถูกขายพร้อมกัน";
  } else if (top.score < 0.5) {
    const miss = top.checks.filter(x => x.result === false).map(x => x.label);
    confidence = "ต่ำ"; confWhy = `เข้าเงื่อนไขไม่ถึงครึ่ง (ไม่เข้า: ${miss.join(", ")})`;
  } else if (top.p >= 0.55 && top.p - second.p >= 0.25 && top.score >= 0.7) {
    confidence = "สูง"; confWhy = `"${top.name}" เด่นชัดกว่าโหมดอื่น`;
  } else if (top.p >= 0.4) {
    confidence = "กลาง"; confWhy = `รองลงมาคือ "${second.name}" (เข้ากัน ${Math.round(second.score * 100)}%)`;
  } else {
    confidence = "ต่ำ"; confWhy = `สัญญาณปนกัน: "${top.name}" กับ "${second.name}" ใกล้กัน`;
  }
  // ตื่นตระหนกที่มีต้นเหตุ: บอกโหมดต้นเหตุด้วย
  let cause = null;
  if (primary.id === "panic") {
    const c2 = results.find(r => (r.id === "rates" || r.id === "recession") && r.p >= 0.15);
    if (c2) cause = `ต้นเหตุน่าจะมาจาก "${c2.name}"`;
  }
  return { primary, results, confidence, confWhy, cause, fear: c.fear };
};

/* ถ้าไม่มีโหมดไหนเด่นเลย */
window.MODE_MIXED = {
  id: "mixed", name: "สัญญาณปนกัน", color: "mixed",
  sentence: "ยังสรุปไม่ได้ชัด: บางตัวชี้ว่าตลาดกลัว บางตัวยังปกติ ดูรายละเอียดว่าข้อไหนเข้า",
};

/* ระดับมาตรวัดความกลัว */
window.FEAR_BANDS = [[25, "สงบ"], [45, "ปกติ"], [65, "เริ่มกังวล"], [80, "กลัว"], [101, "กลัวมาก"]];

/* ภูมิอากาศเศรษฐกิจ 4 ช่อง */
window.QUADRANTS = {
  goldilocks: { name: "โตดี เงินเฟ้อต่ำ", tip: "หุ้นมักเด่นที่สุด โดยเฉพาะหุ้นเติบโต", good: "หุ้น, หุ้นเทคฯ" },
  reflation: { name: "โตดี เงินเฟ้อขึ้น", tip: "สินค้าโภคภัณฑ์ หุ้นพลังงาน/ธนาคาร มักเด่น พันธบัตรมักแย่", good: "น้ำมัน, ทองแดง, หุ้นวัฏจักร" },
  stagflation: { name: "ชะลอ แต่เงินเฟ้อขึ้น", tip: "ช่วงยากที่สุด หุ้นและพันธบัตรแย่พร้อมกัน ทองและเงินสดมักรอด", good: "ทอง, เงินสด" },
  deflation: { name: "ชะลอ เงินเฟ้อลง", tip: "พันธบัตรรัฐบาลมักเด่น หุ้นมักแย่", good: "พันธบัตร, ดอลลาร์" },
};
