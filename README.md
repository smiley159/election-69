# Election 69 Research Dashboard (GitHub Pages)

แดชบอร์ดหน้าเดียวเชิง Research สำหรับการเลือกตั้งปี 69 โดยเทียบ:

- การเลือกตั้ง สส. แบบแบ่งเขต
- การเลือกตั้ง สส. แบบบัญชีรายชื่อ (Party List)

และรองรับการเทียบข้ามปีกับข้อมูลปี 66 จาก `election-66.xlsx`

## โครงสร้างหลัก

- `scripts/normalize_election66.py`
  - แปลง Excel ปี 66 เป็น schema กลางระดับเขต-พรรค
- `scripts/normalize_election69.py`
  - รวม JSON ปี 69 (แบ่งเขต + บัญชีรายชื่อ) เป็น schema กลาง
- `scripts/build_crossyear_dataset.py`
  - แมปพรรค/เขตข้ามปีและสร้างชุดข้อมูล comparative
- `scripts/build_research_page_data.py`
  - สร้าง section JSON สำหรับหน้า research
- `docs/index.html`
  - หน้าเดียวแบบ narrative + TOC + interactive table/filter/sort/export
- `docs/assets/research.js`
  - logic ฝั่งหน้าเว็บ
- `docs/assets/research.css`
  - สไตล์หน้าเว็บ
- `docs/data/research/*.json`
  - ข้อมูล precompute สำหรับหน้าเว็บ

## ไฟล์อินพุตที่ต้องมี

- ปี 69:
  - `common-data.json`
  - `party-data.json`
  - `summary.json`
  - `area-constituency/AREA-*.json`
  - `area-candidates/AREA-*.json`
- ปี 66:
  - `election-66.xlsx`

## Config ที่ใช้

- `config/research-settings.json`
- `config/province-aliases.json`
- `config/party-crosswalk-66-69.csv`

## วิธีรัน pipeline ทั้งหมด

```bash
python3 scripts/normalize_election66.py \
  --input election-66.xlsx \
  --sheet Sheet1 \
  --province-aliases config/province-aliases.json \
  --out data/normalized/election66_normalized.json

python3 scripts/normalize_election69.py \
  --common common-data.json \
  --parties party-data.json \
  --const-dir area-constituency \
  --plist-dir area-candidates \
  --province-aliases config/province-aliases.json \
  --out data/normalized/election69_normalized.json

python3 scripts/build_crossyear_dataset.py \
  --in66 data/normalized/election66_normalized.json \
  --in69 data/normalized/election69_normalized.json \
  --parties party-data.json \
  --crosswalk config/party-crosswalk-66-69.csv \
  --settings config/research-settings.json \
  --out-features data/research/crossyear_features.json \
  --out-summary data/research/crossyear_summary.json \
  --out-quality data/research/mapping_quality_report.json

python3 scripts/build_research_page_data.py \
  --input-dir . \
  --out-dir docs/data/research
```

## Local preview

```bash
python3 -m http.server -d docs 8080
```

เปิด `http://localhost:8080`

## Deploy GitHub Pages

1. Push โค้ดขึ้น repo
2. ตั้งค่า Pages:
   - Source: `Deploy from a branch`
   - Branch: branch หลักของคุณ
   - Folder: `/docs`
3. หน้า research จะพร้อมใช้งานที่ URL ของ GitHub Pages

## Validation ที่ควรเช็กทุกครั้ง

- `data/research/crossyear_summary.json`
  - ตรวจ `coverage` และ `counts`
- `docs/data/research/manifest.json`
  - ตรวจ `generatedAt` และ `counts`
- หน้าเว็บ `docs/index.html`
  - ตาราง/กราฟ/ฟิลเตอร์/การ export ทำงานครบ
