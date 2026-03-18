"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";

export interface Question {
  id: number;
  title: string;
  type?: "input" | "options" | "agenda";
  placeholder?: string;
  options?: string[];
  [key: string]: any;
}
export const questions = [
  {
    id: 1,
    title: "นัดประชุม ต้องประชุมเพราะอะไร",
    type: "options",
    options: ["ประชุมสามัญ (AGM)", "ประชุมวิสามัญ (EGM)"],
  },
  {
    id: 2,
    title: "ใครเป็นคนเรียกประชุม",
    type: "input",
    placeholder: "เขียนชื่อ-นามสกุล",
  },
  {
    id: 3,
    title: "กำหนดวาระการประชุม",
    type: "agenda",
    regularAgendas: [
      "รับรองรายงานการประชุมครั้งก่อน",
      "รับรองงบการเงิน",
      "อนุมัติจ่ายเงินปันผล",
      "แต่งตั้งผู้สอบบัญชี",
      "กำหนดค่าตอบแทนผู้สอบบัญชี",
      "เลือกตั้งกรรมการบริษัท",
      "ถอดถอนกรรมการ",
      "อนุมัติค่าตอบแทนกรรมการ",
      "อนุมัติธุรกรรมทั่วไปของบริษัท",
    ],
    specialAgendas: [
      "แก้ไขหนังสือบริคณห์สนธิ",
      "แก้ไขข้อบังคับบริษัท",
      "เพิ่มทุนจดทะเบียน",
      "ลดทุน",
      "เปลี่ยนชื่อบริษัท",
      "ควบรวมบริษัท",
      "เลิกบริษัท",
      "แปลงสภาพบริษัท",
      "ออกหุ้นบุริมสิทธิ",
    ],
  },
];

export default function QuizPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<any>({});
  const [inputValue, setInputValue] = useState("");
  const [selectedAgendas, setSelectedAgendas] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const currentQuestion = questions[step];
  const authorizedNames = ["สมชาย ใจดี", "วิภา เรียนรู้", "จีน"];

  const handleNext = (value: any) => {
    // 1. เก็บคำตอบข้อปัจจุบันเข้าใน Object answers
    const newAnswers = { ...answers, [currentQuestion.id]: value };
    setAnswers(newAnswers);
    if (currentQuestion.type === "input") {
      const trimmedValue = value.trim();

      // เช็คว่าไม่ได้ใส่ค่าอะไรเลย
      if (!trimmedValue) {
        setErrorMsg("กรุณากรอกชื่อ");
        return;
      }

      // เช็คว่าชื่อตรงกับที่กำหนดไหม
      if (!authorizedNames.includes(trimmedValue)) {
        setErrorMsg("ไม่มีอำนาจในการสร้างประชุม");
        return;
      }
    }

    // 2. ถ้ายังไม่ถึงข้อสุดท้าย ให้ไปข้อถัดไป
    if (step < questions.length - 1) {
      setStep((prev) => prev + 1);
      setInputValue("");
      setSelectedAgendas([]);
      setErrorMsg("");
    } else {
      // 3. ข้อสุดท้าย: บันทึก Object answers ทั้งหมดลง localStorage
      localStorage.setItem("meeting_draft", JSON.stringify(newAnswers));
      router.push("/create-meeting");
    }
  };

  const toggleAgenda = (item: string) => {
    setSelectedAgendas((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item],
    );
  };

  // ป้องกัน Error กรณี currentQuestion หายไปชั่วขณะ
  if (!currentQuestion) return null;

  return (
    <motion.div
      className="max-w-2xl mx-auto mt-10 px-4"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="create-form-card">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="create-form-field"
          >
            <div className="flex justify-between">
              <label className="block mb-4 text-gray-700 font-medium">
                {currentQuestion.title}
              </label>
              <h1 className="text-sm text-gray-400">
                ({step + 1}/{questions.length})
              </h1>
            </div>

            {currentQuestion.type === "input" ? (
              <div className="flex flex-col gap-2">
                <input
                  className={`create-form-input ${errorMsg ? "create-form-input-error" : ""}`}
                  placeholder={currentQuestion.placeholder}
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setErrorMsg("");
                  }}
                />
                {errorMsg && (
                  <span className="create-form-error flex items-center gap-1">
                    <AlertCircle size={12} /> {errorMsg}
                  </span>
                )}
                <button
                  onClick={() => handleNext(inputValue)}
                  className="create-form-submit mt-2"
                >
                  ถัดไป
                </button>
              </div>
            ) : currentQuestion.type === "agenda" ? (
              <div className="space-y-4">
                <div className="create-form-agendas">
                  {["regularAgendas", "specialAgendas"].map((type) => (
                    <div key={type} className="mb-4">
                      <h3 className="font-bold text-sm mb-2 uppercase text-gray-500">
                        {type === "regularAgendas" ? "มติธรรมดา" : "มติพิเศษ"}
                      </h3>
                      {(currentQuestion as any)[type]?.map((item: string) => (
                        <label
                          key={item}
                          className="flex items-center gap-3 py-2 cursor-pointer border-b border-gray-50 last:border-0"
                        >
                          <input
                            type="checkbox"
                            onChange={() => toggleAgenda(item)}
                            checked={selectedAgendas.includes(item)}
                          />
                          <span className="text-gray-700">{item}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => handleNext(selectedAgendas)}
                  className="create-form-submit"
                >
                  ยืนยันวาระ
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {currentQuestion.options?.map((opt: string) => (
                  <button
                    key={opt}
                    onClick={() => handleNext(opt)}
                    className="create-form-select text-left hover:bg-gray-50"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
