# ESP32 Audio Recording Example (I2S Microphone)

## ภาพรวม

ตัวอย่างโค้ด ESP32 สำหรับอัดเสียงจากไมโครโฟน I2S แล้วส่งไปยัง backend ผ่าน WebSocket SSL (wss://)

## Hardware ที่รองรับ

- **INMP441** - MEMS I2S Microphone
- **MAX9814** - Electret Microphone + AGC
- **SPH0645** - I2S MEMS Microphone

## การต่อสาย (สำหรับ INMP441)

```
INMP441    ->  ESP32
SCK        ->  GPIO14 (I2S_SCK)
WS         ->  GPIO15 (I2S_WS)
SD         ->  GPIO32 (I2S_SD)
L/R        ->  GND (Left channel)
VDD        ->  3.3V
GND        ->  GND
```

## ตัวอย่างโค้ด Arduino/PlatformIO

```cpp
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <driver/i2s.h>
#include <base64.h>

// WiFi credentials
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// WebSocket server
const char* wsHost = "leganizebackend.onrender.com";
const int wsPort = 443;

// Device ID (ตั้งชื่ออะไรก็ได้)
const char* DEVICE_ID = "esp32-meeting-01";

// I2S Configuration
#define I2S_WS 15
#define I2S_SCK 14
#define I2S_SD 32
#define I2S_PORT I2S_NUM_0
#define SAMPLE_RATE 16000
#define SAMPLE_BITS 16
#define CHANNELS 1

// Recording settings
#define BUFFER_SIZE 1024
bool isRecording = false;
int16_t audioBuffer[BUFFER_SIZE];

WebSocketsClient webSocket;

String roomId = "";
String accessToken = "";
bool configured = false;

void setupI2S() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = BUFFER_SIZE,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };

  i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pin_config);
  i2s_zero_dma_buffer(I2S_PORT);
}

void sendAudioChunk(uint8_t* data, size_t length) {
  if (!webSocket.isConnected() || roomId.isEmpty() || !isRecording) {
    return;
  }

  // Convert to base64
  String base64Audio = base64::encode(data, length);

  // Create JSON message
  StaticJsonDocument<4096> doc;
  doc["type"] = "esp32-audio-chunk";
  doc["roomId"] = roomId;
  doc["audio"] = base64Audio;

  String json;
  serializeJson(doc, json);

  webSocket.sendTXT(json);
  Serial.printf("📤 Sent %d bytes (base64: %d)\n", length, base64Audio.length());
}

void connectWithConfig() {
  String path = "/ws?type=esp32&deviceId=";
  path += DEVICE_ID;
  path += "&roomId=";
  path += roomId;
  path += "&accessToken=";
  path += accessToken;

  Serial.println("🔄 Reconnecting with config...");
  webSocket.disconnect();
  delay(500);
  webSocket.beginSSL(wsHost, wsPort, path.c_str());
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("✅ Connected to server");
      break;

    case WStype_TEXT: {
      StaticJsonDocument<512> doc;
      DeserializationError error = deserializeJson(doc, payload);

      if (error) {
        Serial.printf("❌ JSON parse error: %s\n", error.c_str());
        return;
      }

      const char* msgType = doc["type"];

      if (strcmp(msgType, "waiting-for-config") == 0) {
        Serial.printf("📡 Pending mode - deviceId: %s\n", DEVICE_ID);
        Serial.println("⏳ Waiting for browser to send config...");

      } else if (strcmp(msgType, "room-config") == 0) {
        roomId = doc["roomId"].as<String>();
        accessToken = doc["accessToken"].as<String>();
        configured = true;

        Serial.printf("✅ Config received!\n");
        Serial.printf("   roomId: %s\n", roomId.c_str());

        connectWithConfig();

      } else if (strcmp(msgType, "connected") == 0) {
        if (configured) {
          Serial.println("🎉 Fully connected to room!");
        }

      } else if (strcmp(msgType, "start-recording") == 0) {
        Serial.println("🎙️ Start recording command received");
        isRecording = true;
        i2s_zero_dma_buffer(I2S_PORT);  // Clear buffer

      } else if (strcmp(msgType, "stop-recording") == 0) {
        Serial.println("⏹️ Stop recording command received");
        isRecording = false;

      } else if (strcmp(msgType, "go-pending") == 0) {
        // Server is asking ESP32 to release this room and go back to pending mode
        Serial.println("🔄 go-pending received — returning to pending mode");
        isRecording = false;
        roomId = "";
        accessToken = "";
        configured = false;
        // Reconnect without roomId → server will put us in pending pool
        String path = "/ws?type=esp32&deviceId=";
        path += DEVICE_ID;
        webSocket.disconnect();
        delay(500);
        webSocket.beginSSL(wsHost, wsPort, path.c_str());

      } else {
        Serial.printf("📨 Message: %s\n", (char*)payload);
      }
      break;
    }

    case WStype_DISCONNECTED:
      Serial.println("❌ Disconnected");
      isRecording = false;  // Stop recording on disconnect
      if (configured) {
        Serial.println("🔄 Will reconnect...");
      }
      break;

    case WStype_ERROR:
      Serial.printf("❌ WebSocket Error: ");
      if (length > 0) {
        Serial.write(payload, length);
      }
      Serial.println();
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n🚀 ESP32 Audio WebSocket Client");
  Serial.printf("📍 Device ID: %s\n", DEVICE_ID);

  // Connect to WiFi
  Serial.printf("📶 Connecting to WiFi: %s", ssid);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n✅ WiFi Connected!");
  Serial.printf("📍 IP: %s\n", WiFi.localIP().toString().c_str());

  // Setup I2S
  setupI2S();
  Serial.println("✅ I2S Initialized");

  // Connect ครั้งแรก - pending mode
  String initPath = "/ws?type=esp32&deviceId=";
  initPath += DEVICE_ID;

  Serial.printf("🔌 Connecting to WSS: %s:%d%s\n", wsHost, wsPort, initPath.c_str());

  webSocket.beginSSL(wsHost, wsPort, initPath.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  webSocket.loop();

  // อัดเสียงถ้าได้รับคำสั่ง start-recording
  if (isRecording && configured && webSocket.isConnected()) {
    size_t bytesRead = 0;
    esp_err_t result = i2s_read(I2S_PORT, &audioBuffer, sizeof(audioBuffer), &bytesRead, portMAX_DELAY);

    if (result == ESP_OK && bytesRead > 0) {
      sendAudioChunk((uint8_t*)audioBuffer, bytesRead);
    }
  } else {
    delay(100);  // ประหยัด CPU ตอนไม่อัด
  }
}
```

## การใช้งาน

### 1. เตรียม ESP32

1. ติดตั้ง libraries ที่จำเป็น:
   - `ArduinoWebSockets` by Markus Sattler
   - `ArduinoJson` by Benoit Blanchon
   - `arduino-base64` by Densaugeo (สำหรับ base64 encoding)
2. แก้ไข WiFi credentials (`ssid` และ `password`)
3. แก้ไข `DEVICE_ID` ให้เป็นชื่อที่ไม่ซ้ำกัน
4. อัปโหลดโค้ดลง ESP32

### 2. เริ่มต้นใช้งาน

1. ESP32 จะเชื่อมต่อ WiFi และ WebSocket อัตโนมัติ
2. เปิดหน้า `https://leganizebackend.onrender.com/connect`
3. คลิกปุ่ม **"สร้าง Room สำหรับทดสอบ"**
4. ESP32 จะปรากฏในรายการ "ESP32 ที่รอการเชื่อมต่อ"
5. คลิกปุ่ม **"เชื่อมต่อ"** เพื่อส่ง room config ให้ ESP32
6. คลิกปุ่ม **"เริ่มอัดจาก ESP32"** เพื่อเริ่มอัด
7. พูดเข้าไมโครโฟน
8. คลิกปุ่ม **"หยุดอัด"** แล้วฟังเสียงที่อัด

## โฟลว์การทำงาน

```
1. ESP32 boot → เชื่อม WiFi
2. ESP32 → WebSocket (pending mode)
3. Browser → เข้า /connect → สร้าง room
4. Browser เห็น ESP32 ในรายการ → กด "เชื่อมต่อ"
5. Backend ส่ง room-config → ESP32
6. ESP32 reconnect พร้อม roomId + accessToken
7. Browser กด "เริ่มอัดจาก ESP32"
8. Backend relay คำสั่ง → ESP32 เริ่มอัด
9. ESP32 ส่ง audio chunks → Backend relay → Browser
10. Browser กด "หยุดอัด" → play เสียงที่อัด
```

## การปรับแต่ง

### ปรับ Sample Rate

```cpp
#define SAMPLE_RATE 16000  // 8000, 16000, 22050, 44100
```

### ปรับ Buffer Size (ส่งทีละเท่าไร)

```cpp
#define BUFFER_SIZE 1024  // 512, 1024, 2048, 4096
```

**หมายเหตุ:** Buffer ใหญ่ = ส่งถี่น้อย แต่ latency สูง

### ใช้ Stereo

```cpp
#define CHANNELS 2
.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
```

### ปรับ DMA Buffer (ถ้าเสียงแตก)

```cpp
.dma_buf_count = 8,  // เพิ่มจาก 4 เป็น 8
.dma_buf_len = 512,  // ลดลง
```

## การทดสอบแบบ Local

ถ้าต้องการทดสอบกับ backend ที่รันบนเครื่อง:

```cpp
const char* wsHost = "192.168.1.100";  // IP ของเครื่องคุณ
const int wsPort = 3000;

// ใน setup() เปลี่ยนเป็น:
webSocket.begin(wsHost, wsPort, initPath.c_str());  // ใช้ begin แทน beginSSL
```

## Troubleshooting

### ไม่มีเสียง / มีแต่ noise

- ตรวจสอบการต่อสาย (โดยเฉพาะ SCK, WS, SD)
- ลอง swap SCK กับ WS
- ตรวจสอบ L/R pin (GND = Left, 3.3V = Right)
- ตรวจสอบ VDD ต้องเป็น 3.3V (ไม่ใช่ 5V)

### เสียงแตก / มี glitch

- เพิ่ม DMA buffer: `dma_buf_count = 8`
- ลด sample rate เหลือ 8000 หรือ 16000
- เพิ่ม buffer size เป็น 2048
- ตรวจสอบ WiFi signal ต้องแรง

### WebSocket disconnects บ่อย

- ตรวจสอบ WiFi signal
- เปิด serial monitor ดู error message
- ลอง disable heartbeat: `// webSocket.enableHeartbeat(...);`

### ESP32 ไม่ปรากฏในรายการ

- ตรวจสอบว่า WiFi เชื่อมต่อแล้ว
- เช็ค serial monitor ว่ามี "Pending mode" หรือไม่
- ลอง refresh หน้า browser
- ตรวจสอบ `DEVICE_ID` ไม่ซ้ำกับเครื่องอื่น

### SSL/TLS Error

```cpp
// เพิ่มบรรทัดนี้ใน setup() ถ้า certificate มีปัญหา
webSocket.setInsecure();  // อนุญาต self-signed cert
```

## Format ของเสียงที่ส่ง

- **Raw PCM audio** encoded เป็น base64
- 16-bit signed integer samples
- Mono (1 channel)
- Sample rate: 16000 Hz (default)
- ส่งทีละ chunks (1024 samples = 2048 bytes)

## Bandwidth Usage

สำหรับ 16kHz mono, 16-bit:

- Raw PCM: 32 KB/s
- Base64 encoded: ~43 KB/s
- ส่งทุก 64ms (ถ้า buffer = 1024 samples)

## ข้อควรระวัง

⚠️ การส่งเสียงผ่าน WebSocket ใช้ bandwidth สูง  
⚠️ ใช้ WiFi ที่เสถียรและแรงสัญญาณ มิฉะนั้นเสียงจะขาดหาย  
⚠️ Base64 encoding ทำให้ข้อมูลใหญ่ขึ้น ~33%  
⚠️ ถ้าใช้ production (wss://) ต้องมี internet ที่เร็ว  
⚠️ ไม่ควรอัดเสียงนานเกิน 1-2 นาที เพราะจะใช้ memory เยอะ

## Advanced: เพิ่ม Opus Encoding (ประหยัด Bandwidth)

ถ้าต้องการลด bandwidth ให้น้อยลง สามารถใช้ Opus codec:

1. ติดตั้ง `libopus` for ESP32
2. Encode PCM → Opus ก่อนส่ง
3. Bandwidth ลดลงเหลือ ~4 KB/s (ประหยัด 90%)

แต่จะเพิ่มความซับซ้อนและใช้ CPU มากขึ้น

**ทดสอบระบบ transcript**

/\*\*

- ESP32 Google Cloud STT Stream via /ws/simple
-
- Hardware:
- - INMP441 I2S MEMS Microphone
- - MicroSD Card Module (SPI)
- - ESP32 (พร้อม WiFi)
-
- Wiring:
- INMP441 → ESP32
- SCK → GPIO14 (I2S_SCK)
- WS → GPIO15 (I2S_WS)
- SD → GPIO32 (I2S_SD)
- L/R → GND
- VDD → 3.3V
- GND → GND
-
- SD Module (SPI) → ESP32
- MOSI → GPIO23
- MISO → GPIO19
- SCK → GPIO18
- CS → GPIO5
-
- Button → GPIO0 (built-in BOOT button) → GND
- LED → GPIO2 (built-in)
-
- Libraries ที่ต้องติดตั้ง:
- - ArduinoWebSockets by Markus Sattler (Library Manager)
- - ArduinoJson by Benoit Blanchon (Library Manager)
- - arduino-base64 by Densaugeo (Library Manager หรือ ZIP)
-
- การทำงาน:
- 1.  Boot → เชื่อม WiFi → เชื่อม wss://server/ws/simple
- 2.  กด BOOT button ค้าง → เริ่มอัด (ส่ง start-stream + stream audio PCM)
- 3.  ปล่อย button → หยุดอัด (ส่ง stop-stream)
- 4.  Transcript interim แสดงใน Serial; final → บันทึกลง SD card (transcript.txt)
- 5.  STT stream จะ auto-restart ถ้า session หมดอายุ (~5 นาที)
      \*/

```cpp
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <driver/i2s.h>
#include <SD.h>
#include <SPI.h>
#include <base64.h>

// ======================== CONFIG ========================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// WebSocket server
const char* WS_HOST = "leganizebackend.onrender.com";
const int   WS_PORT = 443;
const char* WS_PATH = "/ws/simple";   // ← simple mode, ไม่ต้องใช้ roomId

// ======================== PINS ==========================
// I2S Microphone
#define I2S_SCK       14
#define I2S_WS        15
#define I2S_SD_PIN    32
#define I2S_PORT      I2S_NUM_0

// SD Card (SPI)
#define SD_CS         5

// Button & LED
#define BUTTON_PIN    0   // BOOT button (active LOW)
#define LED_PIN       2   // Built-in LED

// ======================== AUDIO =========================
#define SAMPLE_RATE       16000   // Hz — ต้องตรงกับ Google STT config
#define BITS_PER_SAMPLE   16
#define DMA_BUF_COUNT     4
#define DMA_BUF_LEN       256     // samples per DMA buffer

// ส่ง audio ทุกกี่ sample (256 = 16 ms ต่อ frame, ~62 frames/s)
#define SEND_FRAME_SAMPLES  256

// ======================== SD ============================
#define TRANSCRIPT_FILE   "/transcript.txt"

// ======================== STATE =========================
WebSocketsClient webSocket;

bool wsConnected   = false;
bool isRecording   = false;
bool streamStarted = false;   // server ยืนยัน stream เปิดแล้ว

// Button debounce
unsigned long lastButtonChange = 0;
bool prevButtonState = HIGH;

// ======================== HELPERS =======================

void blinkLED(int times, int ms = 100) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(ms);
    digitalWrite(LED_PIN, LOW);
    delay(ms);
  }
}

// ======================== SD CARD =======================

bool sdAvailable = false;

void initSD() {
  if (!SD.begin(SD_CS)) {
    Serial.println("⚠️  SD Card init failed — transcripts will not be saved");
    sdAvailable = false;
    return;
  }
  sdAvailable = true;
  Serial.println("✅ SD Card ready");
}

void saveTranscript(const String& text) {
  if (!sdAvailable) return;

  File f = SD.open(TRANSCRIPT_FILE, FILE_APPEND);
  if (!f) {
    Serial.println("❌ Failed to open transcript file");
    return;
  }

  // Timestamp-like separator (ESP32 ไม่มี RTC จึงใช้ millis)
  f.print("[");
  f.print(millis() / 1000);
  f.print("s] ");
  f.println(text);
  f.close();
  Serial.println("💾 Saved to SD: " + text.substring(0, 60));
}

// ======================== I2S ===========================

void setupI2S() {
  i2s_config_t config = {
    .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate          = SAMPLE_RATE,
    .bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count        = DMA_BUF_COUNT,
    .dma_buf_len          = DMA_BUF_LEN,
    .use_apll             = false,
    .tx_desc_auto_clear   = false,
    .fixed_mclk           = 0,
  };

  i2s_pin_config_t pins = {
    .bck_io_num   = I2S_SCK,
    .ws_io_num    = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num  = I2S_SD_PIN,
  };

  i2s_driver_install(I2S_PORT, &config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pins);
  i2s_zero_dma_buffer(I2S_PORT);
  Serial.println("✅ I2S initialized (16kHz, 16-bit, mono)");
}

// ======================== STT STREAM ====================

void sendStartStream() {
  if (!wsConnected) return;
  StaticJsonDocument<64> doc;
  doc["type"] = "start-stream";
  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(json);
  Serial.println("▶️  Sent start-stream");
}

void sendStopStream() {
  if (!wsConnected) return;
  streamStarted = false;
  StaticJsonDocument<64> doc;
  doc["type"] = "stop-stream";
  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(json);
  Serial.println("⏹️  Sent stop-stream");
}

/**
 * อ่าน 1 frame จาก I2S แล้วส่งเป็น audio-data (base64 PCM)
 * เรียกใน loop() ขณะกำลัง record
 */
void sendAudioFrame() {
  if (!wsConnected || !streamStarted) return;

  static int16_t frameBuf[SEND_FRAME_SAMPLES];
  size_t bytesRead = 0;

  // รอ blocking (portMAX_DELAY = ~10 ms ที่ 16kHz 256 samples)
  esp_err_t ret = i2s_read(I2S_PORT,
                            frameBuf,
                            SEND_FRAME_SAMPLES * sizeof(int16_t),
                            &bytesRead,
                            portMAX_DELAY);

  if (ret != ESP_OK || bytesRead == 0) return;

  // Base64 encode
  String b64 = base64::encode((uint8_t*)frameBuf, bytesRead);

  // Build JSON
  // StaticJsonDocument ขนาด = ~(base64 len + overhead)
  // 256 samples × 2 bytes = 512 bytes → base64 ~684 bytes
  // ใช้ DynamicJsonDocument เพื่อความปลอดภัย
  DynamicJsonDocument doc(1024);
  doc["type"]  = "audio-data";
  doc["audio"] = b64;

  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(json);
}

// ======================== WS EVENTS =====================

void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {

    case WStype_CONNECTED:
      wsConnected = true;
      Serial.println("✅ WebSocket connected");
      blinkLED(3);
      break;

    case WStype_DISCONNECTED:
      wsConnected   = false;
      streamStarted = false;
      isRecording   = false;
      digitalWrite(LED_PIN, LOW);
      Serial.println("❌ WebSocket disconnected — will retry...");
      break;

    case WStype_TEXT: {
      // Parse JSON
      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        Serial.printf("⚠️  JSON parse error: %s\n", err.c_str());
        break;
      }

      const char* msgType = doc["type"] | "";

      if (strcmp(msgType, "connected") == 0) {
        // Server ยืนยัน connection
        Serial.println("🔗 Server: connected");
        Serial.println("👆 กด BOOT button ค้างไว้เพื่อเริ่มอัดเสียง");

      } else if (strcmp(msgType, "stream-started") == 0) {
        // Server เปิด STT stream แล้ว
        streamStarted = true;
        digitalWrite(LED_PIN, HIGH);
        Serial.println("🎤 STT stream started — กำลังอัด...");
        i2s_zero_dma_buffer(I2S_PORT);  // flush เศษ noise ก่อนอัด

      } else if (strcmp(msgType, "partial-transcript") == 0) {
        // Interim result
        const char* text = doc["text"] | "";
        Serial.printf("💬 (interim) %s\n", text);

      } else if (strcmp(msgType, "transcribed") == 0) {
        // Final result
        const char* text = doc["text"] | "";
        Serial.printf("✅ (final)   %s\n", text);
        saveTranscript(String(text));
        blinkLED(2, 50);

      } else if (strcmp(msgType, "error") == 0) {
        const char* msg = doc["message"] | "unknown error";
        Serial.printf("❌ Server error: %s\n", msg);
        streamStarted = false;

      } else {
        Serial.printf("📨 Unknown message: %s\n", (char*)payload);
      }
      break;
    }

    case WStype_ERROR:
      Serial.printf("❌ WS Error: ");
      if (length > 0) Serial.write(payload, length);
      Serial.println();
      break;

    default:
      break;
  }
}

// ======================== BUTTON ========================

/**
 * กด = เริ่มอัด, ปล่อย = หยุดอัด
 * Debounce 80 ms
 */
void handleButton() {
  bool current = digitalRead(BUTTON_PIN);
  if (current == prevButtonState) return;

  unsigned long now = millis();
  if (now - lastButtonChange < 80) return;  // debounce
  lastButtonChange = now;
  prevButtonState  = current;

  if (current == LOW && !isRecording) {
    // กดลง → เริ่มอัด
    isRecording = true;
    Serial.println("🎙️  Button pressed — starting recording");
    sendStartStream();

  } else if (current == HIGH && isRecording) {
    // ปล่อย → หยุด
    isRecording   = false;
    streamStarted = false;
    Serial.println("⏹️  Button released — stopping recording");
    sendStopStream();
    digitalWrite(LED_PIN, LOW);
  }
}

// ======================== SERIAL COMMANDS ===============

/**
 * อ่านคำสั่งจาก Serial Monitor:
 *   r  → พิมพ์ transcript ทั้งหมดออก Serial
 *   c  → ลบไฟล์ transcript (เริ่มใหม่)
 */
void handleSerialCommands() {
  if (!Serial.available()) return;
  char cmd = (char)Serial.read();
  // flush remaining newline chars
  while (Serial.available()) Serial.read();

  if (cmd == 'r' || cmd == 'R') {
    Serial.println("\n========== TRANSCRIPT ==========");
    if (!sdAvailable) {
      Serial.println("⚠️  SD not available");
    } else {
      File f = SD.open(TRANSCRIPT_FILE, FILE_READ);
      if (!f) {
        Serial.println("(ไฟล์ว่างเปล่า หรือยังไม่มี transcript)");
      } else {
        while (f.available()) {
          Serial.write(f.read());
        }
        f.close();
      }
    }
    Serial.println("================================\n");

  } else if (cmd == 'c' || cmd == 'C') {
    if (!sdAvailable) {
      Serial.println("⚠️  SD not available");
    } else {
      if (SD.remove(TRANSCRIPT_FILE)) {
        Serial.println("🗑️  Transcript cleared");
      } else {
        Serial.println("ℹ️  ไม่มีไฟล์ให้ลบ");
      }
    }

  } else if (cmd == 'h' || cmd == 'H' || cmd == '?') {
    Serial.println("Commands: r=read  c=clear  h=help");
  }
}

// ======================== WIFI ==========================

void connectWifi() {
  Serial.printf("📶 Connecting to WiFi: %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n✅ WiFi connected — IP: %s\n",
                WiFi.localIP().toString().c_str());
}

// ======================== SETUP =========================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n🚀 ESP32 Google STT Stream Client");

  pinMode(LED_PIN,    OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  digitalWrite(LED_PIN, LOW);

  connectWifi();
  initSD();
  setupI2S();

  // Connect WebSocket
  Serial.printf("🔌 Connecting to wss://%s:%d%s\n", WS_HOST, WS_PORT, WS_PATH);
  webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);

  Serial.println("💡 Serial commands: r=read transcript  c=clear  h=help");
}

// ======================== LOOP ==========================

void loop() {
  webSocket.loop();
  handleButton();
  handleSerialCommands();

  // ส่ง audio frame ถ้ากำลัง record และ stream พร้อมแล้ว
  if (isRecording && streamStarted) {
    sendAudioFrame();
  } else {
    // ประหยัด CPU ตอนไม่อัด
    delay(5);
  }
}
```
