# Aetheria Wiki (unofficial)

วิกิแฟนคลับแบบหน้าเดียวของ [Aetheria Online](https://aetheria-online.in.th/wiki) — เมนูอยู่ด้านบน รายการอยู่ซ้าย รายละเอียดอยู่ขวา
พร้อมตัวคำนวณธาตุ การ์ดอาวุธ และการ์ดป้องกันในหน้าแผนที่

ข้อมูลและรูปทั้งหมดเป็นของ Aetheria Online ดึงจากวิกิทางการ

## Build

```bash
python3 build.py            # โหลดข้อมูลล่าสุดแล้วสร้าง index.html
python3 build.py --offline  # สร้างใหม่จากไฟล์ใน cache/
```

GitHub Actions (`.github/workflows/deploy.yml`) build และ deploy ขึ้น GitHub Pages ทุกครั้งที่ push และทุกวันเวลา 06:30 น. (เวลาไทย)
