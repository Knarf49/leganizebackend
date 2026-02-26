# การตั้งค่า Google Cloud Speech-to-Text

Google Cloud Speech-to-Text ต้องใช้ **Service Account credentials** ในรูปแบบไฟล์ JSON

## Credentials ที่ต้องใช้

### 1. **Service Account JSON Key File**

ไฟล์ JSON ที่มีข้อมูลการยืนยันตัวตนจาก Google Cloud ประกอบด้วย:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "key-id",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "your-service-account@your-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
}
```

## ขั้นตอนการตั้งค่า

### Step 1: สร้าง Google Cloud Project

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/)
2. คลิก **"Select a project"** > **"New Project"**
3. ตั้งชื่อโปรเจกต์ เช่น `leganize-backend`
4. คลิก **"Create"**

### Step 2: เปิดใช้งาน Speech-to-Text API

1. ไปที่ **"APIs & Services"** > **"Library"**
2. ค้นหา **"Cloud Speech-to-Text API"**
3. คลิก API แล้วกด **"Enable"**

### Step 3: สร้าง Service Account

1. ไปที่ **"APIs & Services"** > **"Credentials"**
2. คลิก **"Create Credentials"** > **"Service Account"**
3. กรอกข้อมูล:
   - **Service account name**: `leganize-stt-service`
   - **Service account ID**: จะถูกสร้างอัตโนมัติ
   - **Description**: `Service account for Speech-to-Text API`
4. คลิก **"Create and Continue"**

### Step 4: กำหนด Permissions (Optional แต่แนะนำ)

1. เลือก Role: **"Cloud Speech Client"** หรือ **"Cloud Speech Administrator"**
2. คลิก **"Continue"** > **"Done"**

### Step 5: สร้างและดาวน์โหลด JSON Key

1. กลับไปที่ **"APIs & Services"** > **"Credentials"**
2. ในส่วน **"Service Accounts"** คลิกที่ service account ที่สร้างไว้
3. ไปที่แท็บ **"Keys"**
4. คลิก **"Add Key"** > **"Create new key"**
5. เลือก **"JSON"** format
6. คลิก **"Create"**
7. ไฟล์ JSON จะถูกดาวน์โหลดอัตโนมัติ

### Step 6: บันทึก JSON Key ในโปรเจกต์

1. เปลี่ยนชื่อไฟล์เป็น `google-credentials.json`
2. ย้ายไฟล์ไปยัง root directory ของโปรเจกต์:
   ```
   leganizebackend/
   ├── google-credentials.json  ← วางไฟล์ตรงนี้
   ├── .env
   ├── package.json
   └── ...
   ```

⚠️ **สำคัญ**: อย่า commit ไฟล์นี้เข้า Git! (ไฟล์นี้ถูกเพิ่มใน `.gitignore` แล้ว)

### Step 7: ตั้งค่า Environment Variable

เพิ่มใน `.env` file:

```env
GOOGLE_APPLICATION_CREDENTIALS="./google-credentials.json"
```

หรือตั้งค่าใน system environment:

**Windows PowerShell:**

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\leganizebackend\google-credentials.json"
```

**Windows CMD:**

```cmd
set GOOGLE_APPLICATION_CREDENTIALS=C:\leganizebackend\google-credentials.json
```

**Linux/Mac:**

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/leganizebackend/google-credentials.json"
```

## ตรวจสอบการตั้งค่า

หลังจากตั้งค่าเสร็จแล้ว ทดสอบด้วยคำสั่ง:

```bash
npm run dev
```

ถ้าตั้งค่าถูกต้อง คุณจะเห็น log:

```
🔄 Initializing Google Cloud Speech client...
🎤 Transcribing audio: /tmp/audio_xxx.wav
✅ Transcribed: [ข้อความ]
👥 Detected 2 speakers
```

## Permissions ที่ต้องการ

Service Account ต้องมี permissions ต่อไปนี้:

| Permission                   | Description                      |
| ---------------------------- | -------------------------------- |
| `speech.operations.get`      | ดึงสถานะของ operation            |
| `speech.recognitions.create` | สร้าง speech recognition request |
| `speech.recognitions.get`    | ดึงผลลัพธ์ recognition           |

**Roles ที่แนะนำ:**

- `roles/speech.client` - เพียงพอสำหรับการใช้งาน API
- `roles/speech.admin` - สำหรับการจัดการ API เต็มรูปแบบ (ถ้าต้องการ)

## ราคา (Pricing)

Google Cloud Speech-to-Text มีการคิดค่าใช้จ่ายตามการใช้งาน:

- **Standard model**: $0.006 USD ต่อ 15 วินาที (หรือ ~$1.44 ต่อชั่วโมง)
- **Enhanced model**: $0.009 USD ต่อ 15 วินาที (หรือ ~$2.16 ต่อชั่วโมง)
- **Speaker diarization**: +$0.0025 USD ต่อ 15 วินาที

📊 **Free Tier**: Google Cloud ให้ฟรี 60 นาทีต่อเดือนสำหรับการทดสอบ

อ่านเพิ่มเติม: https://cloud.google.com/speech-to-text/pricing

## การแก้ไขปัญหา

### ข้อผิดพลาด: "Could not load the default credentials"

**สาเหตุ**: ไม่พบไฟล์ credentials หรือ path ไม่ถูกต้อง

**วิธีแก้:**

1. ตรวจสอบว่าไฟล์ `google-credentials.json` อยู่ใน root directory
2. ตรวจสอบว่า `.env` มี `GOOGLE_APPLICATION_CREDENTIALS` ที่ถูกต้อง
3. ตรวจสอบว่า path ไม่มีช่องว่างหรืออักขระพิเศษ

### ข้อผิดพลาด: "Permission denied"

**สาเหตุ**: Service Account ไม่มี permissions เพียงพอ

**วิธีแก้:**

1. กลับไปที่ Google Cloud Console
2. เพิ่ม Role **"Cloud Speech Client"** ให้กับ Service Account
3. รอ 1-2 นาทีให้ permissions propagate

### ข้อผิดพลาด: "API not enabled"

**สาเหตุ**: Cloud Speech-to-Text API ยังไม่ได้เปิดใช้งาน

**วิธีแก้:**

1. ไปที่ [API Library](https://console.cloud.google.com/apis/library)
2. ค้นหา "Cloud Speech-to-Text API"
3. คลิก "Enable"

## คุณสมบัติที่ใช้งานอยู่

โปรเจกต์นี้ใช้คุณสมบัติต่อไปนี้:

✅ **Linear16 Encoding** - คุณภาพเสียงสูงที่ 16kHz  
✅ **Speaker Diarization** - แยกคนพูด 2-6 คนอัตโนมัติ  
✅ **Multi-language Support** - รองรับภาษาไทย + อังกฤษ  
✅ **Automatic Punctuation** - ใส่เครื่องหมายวรรคตอนอัตโนมัติ  
✅ **Word Time Offsets** - แสดง timestamp ของแต่ละคำ  
✅ **Enhanced Model** - ใช้ model `latest_long` เพื่อความแม่นยำสูง

## แหล่งข้อมูลเพิ่มเติม

- [Google Cloud Speech-to-Text Documentation](https://cloud.google.com/speech-to-text/docs)
- [Speaker Diarization Guide](https://cloud.google.com/speech-to-text/docs/multiple-voices)
- [Node.js Client Library](https://cloud.google.com/speech-to-text/docs/libraries#client-libraries-install-nodejs)
- [Best Practices](https://cloud.google.com/speech-to-text/docs/best-practices)
