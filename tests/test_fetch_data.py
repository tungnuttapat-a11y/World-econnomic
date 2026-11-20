"""ทดสอบสคริปต์ดึงข้อมูล โดยไม่ต่อเน็ตจริง (จำลองแหล่งข้อมูล)
รัน: python3 -m unittest discover -s tests -v
"""
import json, sys, tempfile, unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_data as F  # noqa: E402

F.time.sleep = lambda s: None  # ไม่ต้องรอตอน retry


def series(n=80, start=100.0, step=0.1, end=None):
    end = end or date.today()
    days = [end - timedelta(days=i) for i in range(n)][::-1]
    return [(d.isoformat(), start + i * step) for i, d in enumerate(days)]


def boom(*a, **k):
    raise RuntimeError("network down")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.p = [mock.patch.object(F, "LATEST", d / "latest.json"), mock.patch.object(F, "HISTORY", d / "history.json")]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in self.p:
            p.stop()
        self.tmp.cleanup()

    def latest(self):
        return json.loads(F.LATEST.read_text())

    def patch_sources(self, yf=boom, chart=boom, api=boom, csv=boom, stooq=boom):
        return [mock.patch.object(F, "src_stooq", stooq), mock.patch.object(F, "src_yfinance", yf), mock.patch.object(F, "src_yahoo_chart", chart),
                mock.patch.object(F, "src_fred_api", api), mock.patch.object(F, "src_fred_csv", csv)]

    def run_with(self, **kw):
        ps = self.patch_sources(**kw)
        for p in ps:
            p.start()
        try:
            return F.run(now="2026-11-20T08:00:00+07:00")
        finally:
            for p in ps:
                p.stop()


class TestFetch(Base):
    def test_all_ok(self):
        bad = self.run_with(yf=lambda s: series(), api=lambda s: series(start=4.0, step=0.01))
        self.assertEqual(bad, [])
        s = self.latest()["series"]
        self.assertEqual(s["SPX"]["source"], "Yahoo Finance")
        self.assertEqual(s["US10Y"]["status"], "ok")
        self.assertFalse(self.latest()["is_sample"])

    def test_yahoo_down_uses_fallback(self):
        bad = self.run_with(chart=lambda s: series())
        s = self.latest()["series"]
        self.assertEqual(s["GOLD"]["source"], "Yahoo Finance (สำรอง)")
        self.assertIn("สำรอง", s["GOLD"]["note"])

    def test_all_yahoo_down_fred_fallback_for_some(self):
        self.run_with(api=lambda s: series(start=4.0, step=0.01))
        s = self.latest()["series"]
        self.assertTrue(s["SPX"]["source"].startswith("FRED SP500"))
        self.assertEqual(s["GOLD"]["status"], "missing")       # ไม่มีแหล่งสำรอง และไม่มีของเก่า
        self.assertIsNone(s["GOLD"]["last"])                  # ห้ามเดาตัวเลข

    def test_set_falls_back_to_stooq(self):
        self.run_with(stooq=lambda s: series(start=1400, step=1))
        self.assertEqual(self.latest()["series"]["SET"]["source"], "Stooq (สำรอง)")

    def test_no_fred_key_uses_csv(self):
        with mock.patch.dict(F.os.environ, {"FRED_API_KEY": ""}):
            self.run_with(yf=lambda s: series(), api=F.src_fred_api, csv=lambda s: series(start=4.0, step=0.01))
        s = self.latest()["series"]
        self.assertEqual(s["US10Y"]["source"], "FRED DGS10 (CSV)")

    def test_total_failure_keeps_old_data_as_stale(self):
        self.run_with(yf=lambda s: series(), api=lambda s: series(start=4.0, step=0.01))
        first = self.latest()["series"]["GOLD"]
        bad = self.run_with()  # ล่มทุกแหล่ง
        s = self.latest()["series"]["GOLD"]
        self.assertEqual(s["status"], "stale")
        self.assertEqual(s["last"], first["last"])            # ใช้ตัวเลขเดิม ไม่แต่งใหม่
        self.assertEqual(s["fetched_at"], first["fetched_at"])  # เวลาที่บอกว่า "ข้อมูลเก่า ณ ..."
        self.assertTrue(json.loads(F.HISTORY.read_text())["GOLD"])
        self.assertEqual(len(bad), len(F.YAHOO) + len(F.FRED))

    def test_sample_data_never_used_as_backup(self):
        F.LATEST.write_text(json.dumps({"is_sample": True, "series": {"GOLD": {"last": 3622, "status": "ok"}}}))
        self.run_with()
        self.assertEqual(self.latest()["series"]["GOLD"]["status"], "missing")

    def test_weird_jump_rejected(self):
        bad_rows = series()
        bad_rows[-1] = (bad_rows[-1][0], bad_rows[-2][1] * 3)  # พุ่ง 200% ในวันเดียว
        self.run_with(yf=lambda s: bad_rows, chart=lambda s: series())
        self.assertEqual(self.latest()["series"]["SPX"]["source"], "Yahoo Finance (สำรอง)")

    def test_old_data_rejected(self):
        old = series(end=date.today() - timedelta(days=30))
        self.run_with(yf=lambda s: old)
        self.assertEqual(self.latest()["series"]["SPX"]["status"], "missing")

    def test_retry_then_success(self):
        calls = {"n": 0}
        def flaky(s):
            calls["n"] += 1
            if calls["n"] % 3:
                raise RuntimeError("timeout")
            return series()
        self.assertEqual(len(F.retry(lambda: flaky("x"))), 80)


class TestChange(unittest.TestCase):
    def test_changes(self):
        rows = [("2026-10-01", 100.0)] + [(f"2026-11-{d:02d}", 110.0) for d in range(10, 19)] + [("2026-11-19", 121.0)]
        self.assertEqual(F.change(rows, "pct", back=1), 10.0)
        self.assertEqual(F.change(rows, "pct", days=30), 21.0)
        self.assertEqual(F.change([("2026-11-18", 4.9), ("2026-11-19", 5.07)], "abs", back=1), 0.17)


if __name__ == "__main__":
    unittest.main()
