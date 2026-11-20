import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_set_flow as S  # noqa: E402


def art(title, src, pub="2026-11-20T10:30:00+00:00"):
    return {"title": title, "url": f"https://x/{src}/{hash(title)}", "source": src, "published": pub}


class TestParse(unittest.TestCase):
    def test_parse_variants(self):
        self.assertEqual(S.parse_title("SET ปิดลบ 12 จุด ต่างชาติขายสุทธิ 2,850.40 ล้านบาท")["foreign"], -2850.4)
        self.assertEqual(S.parse_title("นักลงทุนต่างประเทศ ซื้อสุทธิ 1,120 ลบ. หนุนหุ้นไทย")["foreign"], 1120)
        v = S.parse_title("ต่างชาติขายสุทธิ 900 ล้านบาท รายย่อยซื้อสุทธิ 1,200 ล้านบาท สถาบันซื้อสุทธิ 50 ล้านบาท")
        self.assertEqual((v["foreign"], v["retail"], v["institution"]), (-900, 1200, 50))
        self.assertEqual(S.parse_title("ต่างชาติขายหุ้นหนัก ตลาดผันผวน"), {})

    def test_trade_date(self):
        self.assertEqual(S.trade_date_of("2026-11-20T10:30:00+00:00"), "2026-11-20")   # 17:30 น.
        self.assertEqual(S.trade_date_of("2026-11-21T01:00:00+00:00"), "2026-11-20")   # เช้าวันเสาร์ -> ศุกร์

    def test_two_sources_confirm(self):
        r = S.combine([art("ต่างชาติขายสุทธิ 2,850 ล้านบาท", "A"), art("หุ้นไทยปิดลบ ต่างชาติ ขายสุทธิ 2,850.4 ล้านบาท", "B")])
        self.assertTrue(r["confirmed"])
        self.assertEqual(r["foreign"], -2850)

    def test_single_source_unconfirmed(self):
        r = S.combine([art("ต่างชาติซื้อสุทธิ 500 ล้านบาท", "A")])
        self.assertFalse(r["confirmed"])

    def test_conflict_dropped(self):
        self.assertIsNone(S.combine([art("ต่างชาติขายสุทธิ 2,850 ล้านบาท", "A"), art("ต่างชาติซื้อสุทธิ 900 ล้านบาท", "B")]))

    def test_latest_day_wins(self):
        r = S.combine([art("ต่างชาติขายสุทธิ 100 ล้านบาท", "A", "2026-11-19T10:00:00+00:00"),
                       art("ต่างชาติซื้อสุทธิ 300 ล้านบาท", "A", "2026-11-20T10:00:00+00:00")])
        self.assertEqual((r["trade_date"], r["foreign"]), ("2026-11-20", 300))


if __name__ == "__main__":
    unittest.main()
