# 🔧 แก้ไข Permission Error ทันที

## ปัญหาที่เจอ

```
Permission 'storage.objects.create' denied on resource
cloud-speech-client@project-a36762be-276c-4821-928.iam.gserviceaccount.com does not have storage.objects.create access
```

## วิธีแก้แบบด่วน (2 นาที) ⚡

### วิธีที่ 1: ผ่าน Google Cloud Console (แนะนำ - ง่ายที่สุด)

1. **เปิด Storage Browser**
   - ไปที่: https://console.cloud.google.com/storage
   - Login ด้วย Google Account ที่เป็น owner ของ project

2. **คลิกที่ bucket ของคุณ**
   - หา bucket: `leganize-audio-transcription`
   - (ถ้ายังไม่มี ให้สร้างก่อน: คลิก CREATE BUCKET)

3. **เพิ่ม Permission**
   - คลิกแท็บ **PERMISSIONS**
   - คลิก **GRANT ACCESS**
   - กรอก:
     - **New principals**: `cloud-speech-client@project-a36762be-276c-4821-928.iam.gserviceaccount.com`
     - **Role**: เลือก `Storage Object Admin`
   - คลิก **SAVE**

4. **✅ เสร็จแล้ว!** Restart server และลองใหม่

---

### วิธีที่ 2: ผ่าน Command Line

```bash
# 1. Login (ถ้ายังไม่ได้ login)
gcloud auth login

# 2. ตั้งค่า project
gcloud config set project YOUR_PROJECT_ID

# 3. ให้สิทธิ์ (แทนที่ชื่อ bucket ถ้าต่างกัน)
gsutil iam ch serviceAccount:cloud-speech-client@project-a36762be-276c-4821-928.iam.gserviceaccount.com:objectAdmin gs://leganize-audio-transcription

# 4. ตรวจสอบว่าใช้ได้
gsutil iam get gs://leganize-audio-transcription
```

---

## ตรวจสอบว่าแก้ไขสำเร็จ

```bash
# ทดสอบสร้างไฟล์ใน bucket
echo "test" > test.txt
gsutil cp test.txt gs://leganize-audio-transcription/test.txt
gsutil rm gs://leganize-audio-transcription/test.txt
rm test.txt

# ถ้าไม่มี error แสดงว่าใช้ได้แล้ว! ✅
```

---

## ⚠️ ถ้ายังไม่มี Bucket

สร้าง bucket ก่อน:

```bash
# ผ่าน command line
gsutil mb gs://leganize-audio-transcription

# หรือผ่าน Console
# https://console.cloud.google.com/storage → CREATE BUCKET
```

---

## สรุป

**Service Account ที่ต้องการสิทธิ์:**

- `cloud-speech-client@project-a36762be-276c-4821-928.iam.gserviceaccount.com`

**Bucket:**

- `leganize-audio-transcription`

**Role ที่ต้องการ:**

- `Storage Object Admin`

**ระยะเวลา:**

- 2-5 นาที

หลังจากแก้แล้ว **Restart server** แล้วลองอัดเสียงใหม่ควรจะทำงานแล้ว! 🎉
