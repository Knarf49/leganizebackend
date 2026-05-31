# Google Cloud Storage Setup สำหรับ Audio Transcription

## ⚠️ สำคัญ: ต้อง Setup ก่อนใช้งาน!

Google Cloud Speech-to-Text มีข้อจำกัด:

- **Inline content (base64)**: ≤ **60 วินาที** หรือ 80 MB
- **GCS URI**: ไม่จำกัดเวลา ✅

ระบบจะใช้:

- ไฟล์ < 1 MB (< 30 วินาที) → ส่งแบบ inline (base64)
- ไฟล์ > 1 MB (> 30 วินาที) → **ต้อง upload ไป GCS** (ต้อง setup!)

## Quick Setup (5 นาที)

### 1. สร้าง GCS Bucket

```bash
# Login to Google Cloud
gcloud auth login

# Set project (แทนที่ด้วย project ID ของคุณ)
gcloud config set project YOUR_PROJECT_ID

# สร้าง bucket (ใช้ชื่อที่ unique - แทนที่ YOUR_PROJECT_ID)
gsutil mb -p YOUR_PROJECT_ID gs://leganize-audio-transcription

# หรือใช้ Console: https://console.cloud.google.com/storage
# คลิก "CREATE BUCKET" → ตั้งชื่อ → Create
```

### 2. ⚠️ ให้ Permission แก่ Service Account (สำคัญ!)

```bash
# หา service account email ที่ใช้งาน
# ดูจาก google-credentials.json หรือจาก error message
# ตัวอย่าง: cloud-speech-client@project-xxx.iam.gserviceaccount.com

# ให้สิทธิ์ Storage Object Admin แก่ service account
gsutil iam ch serviceAccount:YOUR_SERVICE_ACCOUNT_EMAIL:objectAdmin gs://leganize-audio-transcription

# ตัวอย่างคำสั่งจริง:
# gsutil iam ch serviceAccount:cloud-speech-client@project-a36762be-276c-4821-928.iam.gserviceaccount.com:objectAdmin gs://leganize-audio-transcription
```

**หรือผ่าน Console (ง่ายกว่า):**

1. ไปที่ [Storage Browser](https://console.cloud.google.com/storage)
2. คลิกที่ bucket ของคุณ (leganize-audio-transcription)
3. ไปที่แท็บ **PERMISSIONS**
4. คลิก **GRANT ACCESS**
5. เพิ่ม:
   - **New principals**: `cloud-speech-client@project-a36762be-276c-4821-928.iam.gserviceaccount.com`
   - **Role**: `Storage Object Admin`
6. คลิก **SAVE**

### 3. ตั้งค่า Auto-Delete (ประหยัดค่าใช้จ่าย)

```bash
# สร้าง lifecycle rule - ลบไฟล์เก่าอัตโนมัติหลัง 1 วัน
cat > lifecycle.json << EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 1}
      }
    ]
  }
}
EOF

gsutil lifecycle set lifecycle.json gs://leganize-audio-transcription
```

หรือผ่าน Console:

1. ไปที่ bucket → Lifecycle tab
2. Add Rule → Delete object → Age = 1 day

### 4. เพิ่ม Environment Variable

สร้างไฟล์ `.env` (ถ้ายังไม่มี) และเพิ่ม:

```env
GCS_BUCKET_NAME=leganize-audio-transcription
```

### 5. ✅ เสร็จแล้ว! Restart Server

```bash
# Ctrl+C ปิด server แล้วรันใหม่
npm run dev
```

## การทำงานของระบบ

1. **ไฟล์เสียง < 1 MB (< 30 วินาที)**:
   - ส่งแบบ inline (base64) ไม่ต้องใช้ GCS
   - รวดเร็ว ไม่มีค่าใช้จ่าย storage

2. **ไฟล์เสียง > 1 MB (> 30 วินาที)**:
   - Upload ไป GCS bucket
   - ส่ง URI ให้ Speech-to-Text API
   - ลบไฟล์อัตโนมัติหลัง 1 ชั่วโมง (ใน code)
   - - lifecycle policy ลบหลัง 1 วัน (backup)

## 🔧 Troubleshooting

### Error: "Permission denied" หรือ "storage.objects.create"

**ปัญหา:** Service account ไม่มีสิทธิ์เขียนไฟล์ไป GCS

**วิธีแก้:**

1. หา service account email จาก error message หรือ `google-credentials.json`
2. ให้สิทธิ์ผ่าน Console (วิธีง่าย):
   - [Storage Browser](https://console.cloud.google.com/storage) → คลิก bucket
   - PERMISSIONS tab → GRANT ACCESS
   - New principals: `YOUR_SERVICE_ACCOUNT_EMAIL@xxx.iam.gserviceaccount.com`
   - Role: **Storage Object Admin**
   - SAVE

หรือผ่าน command line:

```bash
gsutil iam ch serviceAccount:YOUR_SERVICE_ACCOUNT_EMAIL:objectAdmin gs://leganize-audio-transcription
```

### Error: "Bucket does not exist"

**วิธีแก้:**

```bash
# ตรวจสอบว่า bucket มีอยู่จริง
gsutil ls | grep leganize-audio-transcription

# ถ้าไม่มี สร้างใหม่
gsutil mb gs://leganize-audio-transcription
```

### Error: "GCS_BUCKET_NAME environment variable is required"

**วิธีแก้:**

1. สร้างไฟล์ `.env` ในโฟลเดอร์ root ของโปรเจค
2. เพิ่ม: `GCS_BUCKET_NAME=leganize-audio-transcription`
3. Restart server

## ค่าใช้จ่าย

- **Cloud Storage**: ~$0.02/GB/month
- **ไฟล์เสียง 100 MB**: ~$0.002/เดือน
- **Lifecycle policy**: ลบอัตโนมัติหลัง 1 วัน → ค่าใช้จ่ายเกือบ 0

## Alternative: ถ้าไม่ต้องการใช้ GCS

หากไม่ต้องการ setup GCS และไฟล์เสียงยาว > 1 นาที:

1. **แบ่งไฟล์เสียง**: ตัดเป็นชิ้นเล็กๆ < 60 วินาที แล้ว transcribe แยก
2. **ใช้ Streaming API**: เหมาะสำหรับ realtime แต่ต้องเปลี่ยน architecture
3. **Compress audio**: ใช้ FLAC แทน WAV เพื่อลดขนาด

แต่ GCS คือวิธีที่ง่ายและ reliable ที่สุดครับ! 🚀
