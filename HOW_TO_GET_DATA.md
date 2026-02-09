ดาวน์โหลดข้อมูลผลเลือกตั้ง สส. แบบแบ่งเขต (รายเขต) ด้วยการแทน `AREA-xxxx` จาก `common-data.json`

Template URL:

https://election69-data.thaipbs.or.th/result-latest-constituency/2026-02-09-14-35-02-673/areas/AREA-8101.json

วิธีใช้งาน (อัตโนมัติทุกเขต):

```bash
python3 scripts/fetch_all_area_candidates.py \
  --common common-data.json \
  --out-dir area-constituency \
  --template-url 'https://election69-data.thaipbs.or.th/result-latest-constituency/2026-02-09-14-35-02-673/areas/AREA-8101.json' \
  --sleep 0
```

หมายเหตุ:
- สคริปต์จะแทน `AREA-8101` เป็นทุก `AREA-xxxx` ที่มีใน `common-data.json`
- ไฟล์ผลลัพธ์จะถูกบันทึกที่โฟลเดอร์ `area-constituency/`
