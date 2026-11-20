"""ทดสอบตัวคำนวณภาพใหญ่ (regime.py) ด้วยข้อมูลจำลอง"""
import math, random, sys, unittest
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import regime as R  # noqa: E402


def days(n):
    end = date(2026, 11, 20)
    return [(end - timedelta(days=i)).isoformat() for i in range(n)][::-1]


def walk(n, start, vol, drift=0.0, seed=1, kind="pct", tail=None):
    rnd = random.Random(seed); v = start; out = []
    for i, d in enumerate(days(n)):
        v = v * (1 + rnd.gauss(drift, vol)) if kind == "pct" else v + rnd.gauss(drift, vol)
        out.append((d, v))
    if tail:  # บังคับช่วงท้าย
        for j, x in enumerate(tail):
            out[len(out) - len(tail) + j] = (out[len(out) - len(tail) + j][0], x)
    return out


class TestRegime(unittest.TestCase):
    def base(self):
        return {"SPX": walk(600, 5000, .01, seed=1), "US10Y": walk(600, 4.0, .05, kind="abs", seed=2),
                "VIX": walk(600, 16, .05, seed=3), "VIX3M": walk(600, 18, .03, seed=4),
                "MOVE": walk(600, 100, .03, seed=5), "HY": walk(600, 3.5, .03, kind="abs", seed=6),
                "GOLD": walk(600, 2000, .01, seed=7), "COPPER": walk(600, 4, .015, seed=8),
                "BEI10": walk(600, 2.3, .02, kind="abs", seed=9), "WTI": walk(600, 75, .02, seed=10)}

    def test_fear_high_when_vix_spikes(self):
        L = self.base()
        L["VIX"][-1] = (L["VIX"][-1][0], 80.0)
        L["MOVE"][-1] = (L["MOVE"][-1][0], 400.0)
        L["HY"][-1] = (L["HY"][-1][0], 15.0)
        f = R.compute(L, {}, "now")["fear"]
        self.assertGreaterEqual(f["score"], 80)
        self.assertEqual(f["label"], "กลัวมาก")

    def test_fear_missing_parts_reported(self):
        out = R.compute({"VIX": walk(600, 16, .05)}, {}, "now")
        self.assertIsNone(out["fear"])            # ตัวเดียวไม่พอ ห้ามเดา
        self.assertTrue(out["missing"])

    def test_stock_bond_positive_when_fall_together(self):
        L = self.base()
        n = len(L["SPX"]); spx, y = list(L["SPX"]), list(L["US10Y"])
        rnd = random.Random(0)
        for i in range(n - 25, n):              # 25 วันหลัง: หุ้นลงวันไหน ดอกเบี้ยขึ้นวันนั้น (พันธบัตรลงด้วย)
            r = rnd.gauss(0, .01)
            spx[i] = (spx[i][0], spx[i - 1][1] * (1 + r))
            y[i] = (y[i][0], y[i - 1][1] - r * 5)
        L["SPX"], L["US10Y"] = spx, y
        self.assertGreater(R.compute(L, {}, "now")["stock_bond"]["c20"], 0.8)

    def test_sigma_flags_big_move(self):
        L = self.base()
        L["GOLD"][-1] = (L["GOLD"][-1][0], L["GOLD"][-2][1] * 0.95)    # ลง 5% ในวันเดียว (ปกติ ~1%)
        self.assertLess(R.compute(L, {}, "now")["sigma"]["GOLD"]["d1"], -3)

    def test_macro_quadrant(self):
        L = self.base()
        for k, drift in [("COPPER", .004), ("SPX", .003), ("WTI", .004)]:   # 3 เดือนหลังขึ้นแรง
            rows = L[k]
            for i in range(len(rows) - 63, len(rows)):
                rows[i] = (rows[i][0], rows[i - 1][1] * (1 + drift))
        hy = L["HY"]
        for i in range(len(hy) - 63, len(hy)):
            hy[i] = (hy[i][0], hy[i - 1][1] - .01)
        be = L["BEI10"]
        for i in range(len(be) - 63, len(be)):
            be[i] = (be[i][0], be[i - 1][1] + .01)
        m = R.compute(L, {}, "now")["macro"]
        self.assertEqual(m["quadrant"], "reflation")    # เศรษฐกิจโต + เงินเฟ้อขึ้น


if __name__ == "__main__":
    unittest.main()
