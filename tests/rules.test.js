/* ทดสอบกฎตัดสินโหมดด้วยสถานการณ์จำลอง — รัน: node tests/rules.test.js */
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const ctx = { window: {}, Math, console };
vm.createContext(ctx);
for (const f of ["assets/indicators.js", "assets/rules.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx);
const W = ctx.window;
const S = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { last: v }]));
const R = (sigma, extra = {}) => ({ sigma: Object.fromEntries(Object.entries(sigma).map(([k, v]) => [k, Array.isArray(v) ? { d1: v[0], d5: v[1] } : { d1: v, d5: v }])), ...extra });
let n = 0;
function expect(name, series, regime, want, extraCheck) {
  const out = W.classifyMarket(series, regime, {});
  const probs = out.results.map(r => `${r.id}:${Math.round(r.p * 100)}%`).join(" ");
  assert.strictEqual(out.primary.id, want, `${name}: ได้ ${out.primary.id} (${probs})`);
  if (extraCheck) extraCheck(out);
  console.log(`✓ ${name} -> ${out.primary.name} [${out.confidence}] ${probs}`); n++;
}
expect("กลัวดอกเบี้ย", S({ US10Y: 5.05, VIX: 24, VIX3M: 25 }),
  R({ US10Y: 2, DXY: 1, GOLD: -1.2, SPX: -1.5, IXIC: -2.5 }, { fear: { score: 60 }, stock_bond: { c20: 0.5 } }), "rates");
expect("กลัวถดถอย", S({ US10Y: 4.1, VIX: 26, VIX3M: 25 }),
  R({ US10Y: -2, GOLD: 1.5, WTI: -1.5, COPPER: [-0.5, -1.2], HY: [0.4, 1.1], SPX: -1.4, IXIC: -1.2 }, { fear: { score: 66 }, stock_bond: { c20: -0.5 } }), "recession");
expect("ตื่นตระหนก (ต้นเหตุดอกเบี้ย)", S({ US10Y: 5.1, VIX: 42, VIX3M: 33 }),
  R({ SPX: -3, GOLD: -2, US10Y: 1.2, BTC: -2, WTI: -2, SET: -1.5, DXY: 1, IXIC: -3.5 }, { fear: { score: 88 }, stock_bond: { c20: 0.4 } }), "panic",
  o => assert.ok(o.cause && o.cause.includes("ดอกเบี้ย"), "ควรบอกต้นเหตุ"));
expect("ปกติ / กล้าเสี่ยง", S({ US10Y: 4.2, VIX: 14, VIX3M: 17 }),
  R({ SPX: [0.4, 0.6], HY: [-0.2, -0.4], US10Y: 0.1, GOLD: 0.2 }, { fear: { score: 28 }, stock_bond: { c20: -0.1 } }), "normal");
expect("พักเงินรอดู", S({ US10Y: 4.3, VIX: 17, VIX3M: 18 }),
  R({ SPX: [0.1, 0.2], HY: [0.1, 0.1] }, { fear: { score: 40 }, cash: { pct: 92 } }), "waiting");
expect("สัญญาณปนกัน: ทองลงแรงแต่ดอกเบี้ยลง ไม่มีโหมดเด่น", S({ US10Y: 4.99, VIX: 27, VIX3M: 26 }),
  R({ US10Y: -1, GOLD: -3, DXY: -0.3, SPX: -0.3, WTI: -0.8 }, { fear: { score: 60 }, stock_bond: { c20: 0.05 } }), "recession",
  o => assert.strictEqual(o.confidence, "ต่ำ", "ทองลงสวนทาง ความมั่นใจต้องต่ำ"));
// ไม่มีไฟล์ regime (รอบแรก) ต้องไม่พัง และใช้ค่าสำรอง
const real = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data/latest.json"), "utf8")).series;
const o = W.classifyMarket(real, null, {});
assert.ok(o.primary && o.primary.name); n++;
console.log(`✓ ข้อมูลจริงล่าสุด (ไม่มี regime) -> ${o.primary.name} [${o.confidence}]`);
console.log(`ผ่านทั้งหมด ${n} กรณี`);
