# ESP32 Audio Recording Example (I2S Microphone)

## ภาพรวม

ตัวอย่างโค้ด ESP32 สำหรับอัดเสียงจากไมโครโฟน I2S แล้วส่งไปยัง backend ผ่าน WebSocket

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

// WebSocket server (ใช้ production หรือ localhost)
const char* ws_host = "localhost"; // หรือ "leganizebackend.onrender.com"
const int ws_port = 3000; // หรือ 443 สำหรับ wss://
const char* ws_path = "/ws";

// Device & Room Info
String deviceId = "ESP32_001";
String roomId = "";
String accessToken = "";

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

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("❌ WebSocket Disconnected");
      break;

    case WStype_CONNECTED:
      Serial.println("✅ WebSocket Connected");
      break;

    case WStype_TEXT: {
      StaticJsonDocument<512> doc;
      deserializeJson(doc, payload, length);

      String msgType = doc["type"];

      if (msgType == "waiting-for-config") {
        Serial.println("⏳ Waiting for room configuration...");
      }
      else if (msgType == "room-config") {
        roomId = doc["roomId"].as<String>();
        accessToken = doc["accessToken"].as<String>();
        Serial.printf("✅ Received config - Room: %s\n", roomId.c_str());

        // Reconnect with room credentials
        webSocket.disconnect();
        delay(1000);

        String path = String(ws_path) + "?type=esp32&roomId=" + roomId +
                     "&accessToken=" + accessToken + "&deviceId=" + deviceId;
        webSocket.begin(ws_host, ws_port, path);
      }
      else if (msgType == "start-recording") {
        Serial.println("🎙️ Start recording command received");
        isRecording = true;
      }
      else if (msgType == "stop-recording") {
        Serial.println("⏹️ Stop recording command received");
        isRecording = false;
      }
      break;
    }
  }
}

void sendAudioChunk(uint8_t* data, size_t length) {
  if (!webSocket.isConnected() || roomId.isEmpty()) {
    return;
  }

  // Convert to base64
  String base64Audio = base64::encode(data, length);

  // Create JSON message
  StaticJsonDocument<2048> doc;
  doc["type"] = "esp32-audio-chunk";
  doc["roomId"] = roomId;
  doc["audio"] = base64Audio;

  String json;
  serializeJson(doc, json);

  webSocket.sendTXT(json);
}

void setup() {
  Serial.begin(115200);
  Serial.println("🚀 ESP32 Audio Recorder Starting...");

  // Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Connected");

  // Setup I2S
  setupI2S();
  Serial.println("✅ I2S Initialized");

  // Connect to WebSocket (pending state)
  String path = String(ws_path) + "?type=esp32&deviceId=" + deviceId;
  webSocket.begin(ws_host, ws_port, path);
  webSocket.onEvent(webSocketEvent);
  Serial.println("📡 WebSocket Connecting...");
}

void loop() {
  webSocket.loop();

  if (isRecording && !roomId.isEmpty()) {
    size_t bytesRead = 0;
    i2s_read(I2S_PORT, &audioBuffer, sizeof(audioBuffer), &bytesRead, portMAX_DELAY);

    if (bytesRead > 0) {
      sendAudioChunk((uint8_t*)audioBuffer, bytesRead);
      Serial.printf("📤 Sent %d bytes\n", bytesRead);
    }
  }

  delay(100); // Adjust based on your needs
}
```

## การใช้งาน

### 1. เตรียม ESP32

1. ติดตั้ง libraries ที่จำเป็น:
   - `ArduinoWebSockets` by Markus Sattler
   - `ArduinoJson` by Benoit Blanchon
2. แก้ไข WiFi credentials
3. แก้ไข `ws_host` และ `ws_port` ให้ตรงกับ backend
4. อัปโหลดโค้ดลง ESP32

### 2. เริ่มต้นใช้งาน

1. ESP32 จะเชื่อมต่อ WiFi และ WebSocket อัตโนมัติ
2. เปิดหน้า `/connect?roomId=xxx&accessToken=xxx`
3. ESP32 จะปรากฏในรายการ "ESP32 ที่รอการเชื่อมต่อ"
4. คลิกปุ่ม "เชื่อมต่อ" เพื่อส่ง room config ให้ ESP32
5. คลิกปุ่ม "เริ่มอัดจาก ESP32" เพื่อเริ่มอัด
6. พูดเข้าไมโครโฟน
7. คลิกปุ่ม "หยุดอัด" แล้วฟังเสียงที่อัด

## การปรับแต่ง

### ปรับ Sample Rate

```cpp
#define SAMPLE_RATE 16000  // 8000, 16000, 44100
```

### ปรับ Buffer Size (ส่งทีละเท่าไร)

```cpp
#define BUFFER_SIZE 1024  // 512, 1024, 2048
```

### ใช้ Stereo

```cpp
#define CHANNELS 2
.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
```

## Troubleshooting

### ไม่มีเสียง / มีแต่ noise

- ตรวจสอบการต่อสาย (โดยเฉพาะ SCK, WS, SD)
- ลอง swap SCK กับ WS
- ตรวจสอบ L/R pin (GND = Left, 3.3V = Right)

### เสียงแตก / มี glitch

- เพิ่ม DMA buffer: `dma_buf_count = 8`
- ลด sample rate
- เพิ่ม `delay()` ใน loop

### WebSocket disconnects

- ตรวจสอบ WiFi signal
- เพิ่ม reconnection logic
- ใช้ `wss://` สำหรับ production

## Format ของเสียงที่ส่ง

- **Raw PCM audio** encoded เป็น base64
- 16-bit signed integer samples
- Mono (1 channel) หรือ Stereo (2 channels)
- ส่งทีละ chunks (1024 samples)

## ข้อควรระวัง

⚠️ การส่งเสียงผ่าน WebSocket ใช้ bandwidth สูง (~32 KB/s สำหรับ 16kHz mono)  
⚠️ ใช้ WiFi ที่เสถียร มิฉะนั้นเสียงจะขาดหาย  
⚠️ Base64 encoding จะทำให้ขนาดข้อมูลใหญ่ขึ้น ~33%
