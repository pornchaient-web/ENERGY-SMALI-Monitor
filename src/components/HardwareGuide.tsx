import React, { useState } from "react";
import { firebaseConfig, firestoreDatabaseId } from "../firebase";
import { BookOpen, Copy, Check, Cpu, Wifi, List, Hammer, AlertTriangle } from "lucide-react";

export default function HardwareGuide() {
  const [activeTab, setActiveTab] = useState<"wiring" | "code" | "libraries">("wiring");
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getArduinoCode = () => {
    return `/**
 * ESP32 + PZEM-004T Power Monitor with Firebase Firestore
 * พัฒนาโดยใช้บอร์ด ESP32 และโมดูลวัดพลังงานไฟฟ้า PZEM-004T v3.0
 * 
 * ไลบรารีที่ต้องติดตั้งใน Arduino IDE:
 * 1. "PZEM004Tv30" โดย Jakub Mandula
 * 2. "Firebase ESP Client" โดย Mobizt (เวอร์ชัน 4.x+)
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <PZEM004Tv30.h>

// ส่วนเสริมของระบบ Token และ RTDB/Firestore Helpers ของ Mobizt
#include <addons/TokenHelper.h>

// 1. ตั้งค่าการเชื่อมต่อ WiFi
#define WIFI_SSID "YOUR_WIFI_SSID"      // ใส่ชื่อ WiFi ของคุณ
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD" // ใส่รหัสผ่าน WiFi ของคุณ

// 2. ตั้งค่าการเชื่อมต่อ Firebase (ใส่ข้อมูลโปรเจกต์ของคุณแล้วโดยอัตโนมัติ)
#define API_KEY "${firebaseConfig.apiKey}"
#define FIREBASE_PROJECT_ID "${firebaseConfig.projectId}"
#define FIREBASE_DATABASE_ID "${firestoreDatabaseId}"

// 3. กำหนดขาเชื่อมต่อ PZEM-004T (ใช้ HardwareSerial 2 ของ ESP32)
// บน ESP32: RX2 = GPIO 16, TX2 = GPIO 17
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

// กำหนด Hardware Serial ช่อง 2
HardwareSerial pzemSerial(2);
PZEM004Tv30 pzem(pzemSerial, PZEM_RX_PIN, PZEM_TX_PIN);

// ประกาศออบเจกต์สำหรับการส่งข้อมูล Firebase
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

unsigned long lastSendTime = 0;
const unsigned long sendInterval = 10000; // ส่งข้อมูลทุกๆ 10 วินาที (10000 ms)

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\\n--- ESP32 PZEM-004T Power Monitor ---");

  // เริ่มต้นการเชื่อมต่อ WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\\nWiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // ตั้งค่า Firebase
  config.api_key = API_KEY;
  
  // กำหนดการยืนยันตัวตนแบบ Anonymous
  auth.user.anonymous = true;

  // เชื่อมต่อและกำหนดค่าเริ่มต้น Firebase
  Firebase.reconnectWiFi(true);
  fbdo.setResponseSize(2048);
  Firebase.begin(&config, &auth);

  Serial.println("Firebase initialized.");
}

void loop() {
  // ตรวจสอบและส่งข้อมูลตามรอบเวลาที่กำหนด
  if (millis() - lastSendTime >= sendInterval || lastSendTime == 0) {
    lastSendTime = millis();

    // 1. อ่านค่าจากเซนเซอร์ PZEM-004T
    float voltage = pzem.voltage();
    float current = pzem.current();
    float power = pzem.power();
    float energy = pzem.energy();
    float frequency = pzem.frequency();
    float pf = pzem.pf();

    // ตรวจสอบว่าค่าที่อ่านได้ถูกต้องหรือไม่ (ไม่เป็น NaN)
    if (isnan(voltage) || isnan(current) || isnan(power)) {
      Serial.println("Error: Failed to read from PZEM-004T");
      return;
    }

    Serial.println("\\n--- New Reading ---");
    Serial.printf("Voltage: %.1f V\\n", voltage);
    Serial.printf("Current: %.3f A\\n", current);
    Serial.printf("Power: %.1f W\\n", power);
    Serial.printf("Energy: %.4f kWh\\n", energy);
    Serial.printf("Frequency: %.1f Hz\\n", frequency);
    Serial.printf("Power Factor: %.2f\\n", pf);

    // ตรวจสอบความพร้อมของ Firebase Token ก่อนส่งข้อมูล
    if (Firebase.ready()) {
      Serial.println("Sending data to Firebase Firestore...");

      // สร้าง JSON Payload สำหรับ Firestore
      FirebaseJson content;
      
      content.set("fields/voltage/doubleValue", voltage);
      content.set("fields/current/doubleValue", current);
      content.set("fields/power/doubleValue", power);
      content.set("fields/energy/doubleValue", energy);
      content.set("fields/frequency/doubleValue", frequency);
      content.set("fields/pf/doubleValue", pf);
      content.set("fields/deviceId/stringValue", "esp32_pzem_01");

      // เพิ่มเวลาเซิร์ฟเวอร์ (serverTimestamp)
      content.set("fields/timestamp/timestampValue", "REQUEST_TIME");

      // ส่งข้อมูลเข้าเซิร์ฟเวอร์ (สร้างเอกสารใหม่ในพาร์ท power_readings แบบ Auto ID)
      if (Firebase.Firestore.createDocument(&fbdo, FIREBASE_PROJECT_ID, FIREBASE_DATABASE_ID, "power_readings", content.raw())) {
        Serial.println("Data sent successfully!");
        Serial.println(fbdo.payload().c_str());
      } else {
        Serial.print("Firestore Error: ");
        Serial.println(fbdo.errorReason().c_str());
      }
    } else {
      Serial.println("Firebase not ready yet, skipping this loop");
    }
  }
}
`;
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-xl" id="guide-container">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 bg-emerald-500/15 text-emerald-400 rounded-xl border border-emerald-500/25 shadow-inner">
          <BookOpen className="w-5 h-5 fill-emerald-500/20 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white text-base">คู่มือเชื่อมต่อบอร์ดจริง (Hardware Manual)</h3>
          <p className="text-xs text-zinc-400">วิธีการต่อวงจร ติดตั้งไลบรารี และซอร์สโค้ดเพื่อส่งค่าจาก ESP32</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800/80 mb-6" id="tabs-hardware">
        <button
          onClick={() => setActiveTab("wiring")}
          className={`flex items-center gap-1.5 pb-3 px-4 text-xs font-bold uppercase tracking-wider transition-all border-b-2 font-mono ${
            activeTab === "wiring"
              ? "border-emerald-400 text-emerald-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Hammer className={`w-4 h-4 transition-all duration-300 ${activeTab === 'wiring' ? 'text-emerald-400 fill-emerald-400/20 scale-110' : 'text-zinc-500'}`} /> 1. Wiring Schema
        </button>
        <button
          onClick={() => setActiveTab("libraries")}
          className={`flex items-center gap-1.5 pb-3 px-4 text-xs font-bold uppercase tracking-wider transition-all border-b-2 font-mono ${
            activeTab === "libraries"
              ? "border-emerald-400 text-emerald-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <List className={`w-4 h-4 transition-all duration-300 ${activeTab === 'libraries' ? 'text-emerald-400 fill-emerald-400/20 scale-110' : 'text-zinc-500'}`} /> 2. Libraries
        </button>
        <button
          onClick={() => setActiveTab("code")}
          className={`flex items-center gap-1.5 pb-3 px-4 text-xs font-bold uppercase tracking-wider transition-all border-b-2 font-mono ${
            activeTab === "code"
              ? "border-emerald-400 text-emerald-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Cpu className={`w-4 h-4 transition-all duration-300 ${activeTab === 'code' ? 'text-emerald-400 fill-emerald-400/20 scale-110' : 'text-zinc-500'}`} /> 3. ESP32 Code
        </button>
      </div>

      {/* Content Panels */}
      {activeTab === "wiring" && (
        <div className="space-y-6 animate-fade-in" id="wiring-panel">
          <div className="bg-black/35 rounded-2xl p-5 border border-zinc-800/80">
            <h4 className="font-semibold text-zinc-300 mb-4 text-xs uppercase tracking-widest font-mono flex items-center gap-1.5">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              แผนผังขาเชื่อมต่อ (Pin mapping)
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Wiring Table */}
              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full text-xs text-left text-zinc-400 font-mono">
                  <thead className="text-[10px] text-zinc-500 uppercase bg-black/60">
                    <tr>
                      <th className="px-4 py-2.5">PZEM-004T PIN</th>
                      <th className="px-4 py-2.5">ESP32 PIN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    <tr>
                      <td className="px-4 py-3 font-semibold text-rose-400">VCC (5V)</td>
                      <td className="px-4 py-3 text-zinc-300">5V / VIN (ไฟเลี้ยงบอร์ด)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-semibold text-zinc-400">GND</td>
                      <td className="px-4 py-3 text-zinc-300">GND (กราวด์ร่วม)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-semibold text-blue-400">TX</td>
                      <td className="px-4 py-3 text-zinc-300">GPIO 16 (RX2 ของ ESP32)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-semibold text-amber-400">RX</td>
                      <td className="px-4 py-3 text-zinc-300">GPIO 17 (TX2 ของ ESP32)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Tips */}
              <div className="space-y-3 bg-zinc-950/50 p-4 rounded-xl border border-zinc-800">
                <h5 className="font-semibold text-zinc-300 text-xs flex items-center gap-1 uppercase tracking-wider font-mono">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> ข้อควรระวังสำคัญ (Caution):
                </h5>
                <ul className="text-[11px] text-zinc-400 space-y-2 list-disc pl-4 leading-relaxed">
                  <li>
                    <strong className="text-zinc-200">ระบบไฟ 220V AC:</strong> ต้องเชื่อมต่อสาย AC 220V ขั้ว L และ N เพื่อจ่ายพลังงานเลี้ยงเซนเซอร์ให้ทำงานเสถียร
                  </li>
                  <li>
                    <strong className="text-zinc-200">การคล้องคอยล์ CT:</strong> ให้คล้องสายไฟผ่าน CT เพียง <span className="text-emerald-400 font-bold">สายไลน์ (L) เส้นเดียว</span> ห้ามคล้องทั้งสองสายรวมกันมิฉะนั้นระบบจะไม่วัดค่ากระแสไฟฟ้า
                  </li>
                  <li>
                    <strong className="text-zinc-200">Optocoupler:</strong> โมดูลต้องการไฟ 5V นิ่งๆ เพื่อให้การสื่อสารข้อมูลแบบ UART ไหลลื่น
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="border border-emerald-950 bg-emerald-950/10 rounded-2xl p-5 flex flex-col md:flex-row gap-4 items-center">
            <div className="p-3 bg-emerald-500/15 text-emerald-400 rounded-full border border-emerald-500/25 shadow-inner">
              <Wifi className="w-6 h-6 text-emerald-400 fill-emerald-400/20" />
            </div>
            <div>
              <h4 className="font-semibold text-white text-sm">ข้อมูล Firebase บูตแอปของคุณ เรียบร้อยแล้ว!</h4>
              <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                คุณสามารถไปที่แท็บ <strong className="font-bold text-emerald-400">"3. ESP32 Code"</strong> เพื่อคัดลอกโค้ดไปใช้อัปโหลดได้ทันที API Key และรายละเอียด Database ID ถูกเขียนให้อัตโนมัติตรงกับ Firebase Database โปรเจกต์ปัจจุบันของคุณแล้ว
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "libraries" && (
        <div className="space-y-4 animate-fade-in" id="libraries-panel">
          <div className="space-y-3 font-mono">
            <div className="p-4 bg-black/40 rounded-xl border border-zinc-800 flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">1</div>
              <div>
                <h5 className="font-semibold text-white text-xs uppercase tracking-wider">ติดตั้งบอร์ด ESP32 บน Arduino IDE</h5>
                <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                  ไปที่ File &gt; Preferences ใส่ลิงก์บอร์ดลงใน "Additional Boards Manager URLs":
                  <code className="block bg-black p-2 border border-zinc-800/80 rounded text-[11px] font-mono mt-1.5 text-emerald-400 overflow-x-auto select-all">
                    https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
                  </code>
                  จากนั้นค้นหา <strong className="font-semibold text-zinc-200">esp32</strong> ใน Boards Manager แล้วกด Install
                </p>
              </div>
            </div>

            <div className="p-4 bg-black/40 rounded-xl border border-zinc-800 flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">2</div>
              <div>
                <h5 className="font-semibold text-white text-xs uppercase tracking-wider">ติดตั้งไลบรารี PZEM004Tv30</h5>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                  ค้นหาใน Library Manager ด้วยคำว่า <strong className="font-semibold text-zinc-200">"PZEM004Tv30"</strong> (โดย Jakub Mandula) จากนั้นกดติดตั้ง
                </p>
              </div>
            </div>

            <div className="p-4 bg-black/40 rounded-xl border border-zinc-800 flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">3</div>
              <div>
                <h5 className="font-semibold text-white text-xs uppercase tracking-wider">ติดตั้งไลบรารี Firebase ESP Client</h5>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                  ค้นหาคำว่า <strong className="font-semibold text-zinc-200">"Firebase ESP Client"</strong> (โดย Mobizt) และกดติดตั้ง เพื่อสื่อสารข้อมูลร่วมกับฐานข้อมูล Firestore และ Authentication
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "code" && (
        <div className="space-y-4 animate-fade-in" id="code-panel">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500 font-mono">esp32_pzem_firestore.ino</span>
            <button
              onClick={() => copyToClipboard(getArduinoCode())}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg transition-all border border-zinc-700"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> คัดลอกสำเร็จ!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> คัดลอกโค้ด
                </>
              )}
            </button>
          </div>

          <div className="relative">
            <pre className="text-xs text-zinc-300 bg-black/75 p-5 rounded-2xl overflow-x-auto font-mono max-h-[380px] leading-relaxed border border-zinc-800 shadow-inner select-all whitespace-pre">
              <code>{getArduinoCode()}</code>
            </pre>
          </div>

          <div className="flex items-center gap-2 p-3 bg-amber-950/20 border border-amber-900/40 text-amber-400 rounded-xl">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            <span className="text-[10px] leading-relaxed">
              อย่าลืมระบุค่าเครือข่าย <strong className="font-bold">"YOUR_WIFI_SSID"</strong> และ <strong className="font-bold">"YOUR_WIFI_PASSWORD"</strong> ให้ตรงกับเราเตอร์ WiFi ปลายทางของคุณก่อนทำการอัปโหลดโค้ดลงบอร์ดจริง
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
