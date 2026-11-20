# เข็มทิศตลาด

หน้าเว็บสำหรับมือถือ (ติดตั้งเป็นแอปได้) ที่บอกว่า **"ตลาดตอนนี้กลัวอะไร และเงินไหลไปไหน"**

## สถานะ
- [x] ขั้นที่ 1: หน้าตัวอย่างใช้ข้อมูลตัวอย่าง 19 พ.ย. 2026 (`data/` ตอนนี้เป็นข้อมูลตัวอย่าง)
- [x] ขั้นที่ 2: สคริปต์ดึงข้อมูลจริง (Yahoo/yfinance + FRED) + ทดสอบกรณีดึงไม่ได้ (`tests/`)
- [x] ขั้นที่ 3: GitHub Actions + GitHub Pages (`.github/workflows/update.yml`)
- [ ] ขั้นที่ 4: ส่งออก PDF / CSV / Markdown

## ตั้งค่าครั้งแรก (ทำครั้งเดียว)
1. ขอ FRED API key ฟรีที่ https://fred.stlouisfed.org/docs/api/api_key.html
2. Settings → Secrets and variables → Actions → New repository secret ชื่อ `FRED_API_KEY`
3. Settings → Pages → Source เลือก **GitHub Actions**
4. Actions → "อัปเดตข้อมูลและเว็บ" → Run workflow

เว็บ: https://tungnuttapat-a11y.github.io/World-econnomic/

## ไฟล์ที่แก้เองได้
| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `config/manual.json` | กรอกตัวเลขที่ดึงอัตโนมัติไม่ได้ (CME FedWatch, ยอดซื้อขายสุทธิหุ้นไทย 4 กลุ่ม: ต่างชาติ สถาบัน โบรกเกอร์ รายย่อย) พร้อมวันที่กรอก |
| `assets/rules.js` | กฎตัดสินโหมดตลาด และเกณฑ์ตัวเลข |
| `assets/indicators.js` | ชื่อ คำอธิบาย แท็บ และปัจจัยที่ทำให้ราคาขยับ |
| `config/news.json` | คำค้นข่าวของแต่ละหัวข้อ (ไทย/อังกฤษ) |

## โครงสร้าง
- `index.html`, `assets/` หน้าเว็บ (HTML/CSS/JS ล้วน)
- `data/latest.json`, `data/history.json` ข้อมูลที่หน้าเว็บอ่าน
- `manifest.webmanifest`, `sw.js`, `icons/` ทำให้ติดตั้งเป็นแอปและเปิดตอนออฟไลน์ได้
- `scripts/fetch_data.py` ดึงราคา/ดอกเบี้ย → `data/latest.json`, `data/history.json`
  - ราคา: yfinance → Yahoo chart API → FRED (เฉพาะ S&P, Nasdaq, VIX, WTI, BTC, USD/THB)
  - ดอกเบี้ย: FRED API (ต้องมี `FRED_API_KEY`) → ไฟล์ CSV สาธารณะของ FRED
  - ทุกแหล่งลอง 3 ครั้ง ตรวจตัวเลขผิดปกติ ถ้าล้มทุกทางใช้ข้อมูลรอบก่อนพร้อมป้าย "ข้อมูลเก่า ณ ..."
- `scripts/fetch_news.py` ดึงพาดหัวข่าวจาก Google News → `data/news.json` (ลิงก์ไปเว็บต้นฉบับ)
- `scripts/make_sample_data.py` สร้างข้อมูลตัวอย่าง (ขั้นที่ 1 เท่านั้น)

## ทดสอบ
```
pip install -r requirements.txt
python3 -m unittest discover -s tests -v
```

## ข้อจำกัด
- yfinance ไม่ใช่ช่องทางทางการของ Yahoo อาจช้า 15–20 นาที หรือใช้งานไม่ได้ชั่วคราว
- FRED อัปเดตวันละครั้ง ช้ากว่าตลาดราว 1 วันทำการ
- "โหมดตลาด" และ "เงินไหลไปไหน" อนุมานจากการขยับของราคา ไม่ใช่ข้อมูลเงินไหลจริง
- ไม่ใช่คำแนะนำการลงทุน ห้ามใส่ข้อมูลส่วนตัวหรือพอร์ตลงใน repo นี้ (repo เป็น public)
