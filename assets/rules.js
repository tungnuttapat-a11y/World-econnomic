/* =====================================================================
   กฎตัดสิน "โหมดตลาด"  — แก้ไฟล์นี้ไฟล์เดียวพอ
   ---------------------------------------------------------------------
   • ทุกกฎดูจาก "การขยับของราคาวันนี้" เท่านั้น (อนุมานจากราคา
     ไม่ใช่ข้อมูลเงินไหลเข้าออกจริง)
   • แต่ละโหมดมีหลายเงื่อนไข เข้ากี่ข้อ = คะแนน (เช่น 3 ใน 4)
   • ถ้าข้อมูลตัวไหนหาย เงื่อนไขนั้นจะเป็น "ไม่ทราบ" ไม่นับว่าเข้า
   ===================================================================== */

/* ---------- เกณฑ์ตัวเลข (แก้ตรงนี้ได้เลย) ---------- */
const T = {
  stockDown: -0.5,     // หุ้น "ลง" = S&P 500 วันนี้ ลบเกินกว่า -0.5%
  stockUp: 0.3,        // หุ้น "ขึ้น" = บวกเกิน +0.3%
  goldMove: 0.5,       // ทอง "ขึ้น/ลง" = ขยับเกิน ±0.5%
  dollarMove: 0.2,     // ดอลลาร์ "ขึ้น/ลง" = ขยับเกิน ±0.2%
  yieldMove: 0.03,     // ผลตอบแทน 10 ปี "ขึ้น/ลง" = ขยับเกิน ±0.03 จุด (3 bp)
  yieldHigh: 5.0,      // ผลตอบแทน 10 ปี "สูง" = ตั้งแต่ 5% ขึ้นไป
  vixJump: 10,         // VIX "พุ่ง" = วันนี้ขึ้นเกิน +10%
  vixHigh: 25,         // VIX "สูง" = ตั้งแต่ 25 ขึ้นไป
  vixCalm: 20,         // VIX "สงบ" = ต่ำกว่า 20
};

/* ตัวช่วยอ่านค่า (คืน null ถ้าไม่มีข้อมูล) */
const chg = (d, k) => (d[k] && d[k].chg1d != null ? d[k].chg1d : null);
const lvl = (d, k) => (d[k] && d[k].last != null ? d[k].last : null);
const test = (v, fn) => (v == null ? null : fn(v)); // null = ไม่ทราบ

/* ---------- โหมดต่าง ๆ ----------
   priority: ถ้าคะแนนเท่ากัน เลขน้อยชนะ
   conflictsWith: โหมดที่ "ขัดกัน" ถ้าเข้าพร้อมกัน = ความมั่นใจต่ำ */
window.MODE_RULES = [
  {
    id: "rates",
    name: "กลัวดอกเบี้ย",
    color: "rates",
    priority: 1,
    sentence: "ตลาดกลัวดอกเบี้ยสูงนาน: เงินออกจากหุ้นและทอง ไปพักที่ดอลลาร์",
    conflictsWith: ["recession"],
    conditions: [
      { label: "ผลตอบแทนพันธบัตร 10 ปี ขึ้น หรือสูงกว่า 5%",
        check: d => { const c = chg(d, "US10Y"), l = lvl(d, "US10Y");
          if (c == null && l == null) return null;
          return (c != null && c >= T.yieldMove) || (l != null && l >= T.yieldHigh); } },
      { label: "ดอลลาร์ขึ้น", check: d => test(chg(d, "DXY"), v => v >= T.dollarMove) },
      { label: "ทองลง",       check: d => test(chg(d, "GOLD"), v => v <= -T.goldMove) },
      { label: "หุ้นลง",       check: d => test(chg(d, "SPX"), v => v <= T.stockDown) },
    ],
  },
  {
    id: "recession",
    name: "กลัวเศรษฐกิจถดถอย",
    color: "recession",
    priority: 2,
    sentence: "ตลาดกลัวเศรษฐกิจชะลอ: เงินหนีจากหุ้นไปหาพันธบัตรและทอง",
    conflictsWith: ["rates"],
    conditions: [
      { label: "ผลตอบแทนพันธบัตร 10 ปี ลง", check: d => test(chg(d, "US10Y"), v => v <= -T.yieldMove) },
      { label: "ทองขึ้น",                  check: d => test(chg(d, "GOLD"), v => v >= T.goldMove) },
      { label: "VIX (ดัชนีความกลัว) พุ่ง",   check: d => test(chg(d, "VIX"), v => v >= T.vixJump) },
      { label: "หุ้นลง",                    check: d => test(chg(d, "SPX"), v => v <= T.stockDown) },
    ],
  },
  {
    id: "panic",
    name: "ตื่นตระหนก ขายทุกอย่าง",
    color: "panic",
    priority: 3,
    sentence: "ตลาดตื่นตระหนก: เทขายทั้งหุ้น ทอง และพันธบัตร แห่ถือเงินสด",
    conflictsWith: [],
    conditions: [
      { label: "หุ้นลง", check: d => test(chg(d, "SPX"), v => v <= T.stockDown) },
      { label: "ทองลง", check: d => test(chg(d, "GOLD"), v => v <= -T.goldMove) },
      { label: "พันธบัตรลง (ผลตอบแทนขึ้น)", check: d => test(chg(d, "US10Y"), v => v >= T.yieldMove) },
      { label: "VIX สูง (25 ขึ้นไป)", check: d => test(lvl(d, "VIX"), v => v >= T.vixHigh) },
    ],
  },
  {
    id: "normal",
    name: "ปกติ / ฟื้นตัว",
    color: "normal",
    priority: 4,
    sentence: "ตลาดค่อนข้างปกติ: ยังไม่เห็นสัญญาณกลัวชัดเจน",
    conflictsWith: ["rates", "recession", "panic"],
    conditions: [
      { label: "VIX ต่ำกว่า 20", check: d => test(lvl(d, "VIX"), v => v < T.vixCalm) },
      { label: "หุ้นไม่ได้ลงแรง", check: d => test(chg(d, "SPX"), v => v > T.stockDown) },
      { label: "ผลตอบแทน 10 ปี ต่ำกว่า 5%", check: d => test(lvl(d, "US10Y"), v => v < T.yieldHigh) },
    ],
  },
];

/* ---------- วิธีให้คะแนนและความมั่นใจ ----------
   • โหมดที่ได้คะแนนสูงสุด (สัดส่วนข้อที่เข้า) คือคำตอบ
   • ถ้าไม่มีโหมดกลัวไหนได้ถึง 75% → ถือว่า "ปกติ"
   • ความมั่นใจ:
       สูง  = เข้าครบทุกข้อ ข้อมูลครบ และไม่มีโหมดอื่นเข้าแรง
       กลาง = เข้า 75% ขึ้นไป หรือมีโหมดอื่นที่ไม่ขัดกันเข้าด้วย
       ต่ำ  = มีโหมดที่ขัดกันเข้าครึ่งหนึ่งขึ้นไป / ข้อมูลไม่ครบ / คะแนนต่ำ */
window.MODE_SETTINGS = { minScore: 0.75, conflictScore: 0.5 };
