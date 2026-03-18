"use client";

import {
  ChevronLeft,
  ChevronDown,
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronRight,
  RotateCcw,
  PenTool,
} from "lucide-react";
import { useState, useRef } from "react";
import SignatureCanvas from "react-signature-canvas";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";

export default function CreateMeetingForm() {
  const router = useRouter();
  const options3 = ["สามัญ", "วิสามัญ"];

  const getInitialDraft = () => {
    try {
      const raw = localStorage.getItem("meeting_draft");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const draft = typeof window !== "undefined" ? getInitialDraft() : {};

  const [selected2] = useState<string>(draft["1"] ?? ""); // set from quiz draft
  const [callerName] = useState<string>(draft["2"] ?? ""); // set from quiz draft
  const [subject, setSubject] = useState("");
  const [meetingNo, setMeetingNo] = useState("");
  const [meetingSubType, setMeetingSubType] = useState("");
  const [attendees, setAttendees] = useState("");
  const [location, setLocation] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingDateSent, setMeetingDateSent] = useState("");
  const [agendas] = useState<string[]>(draft["3"] ?? [""]);
  const [signerName, setSignerName] = useState("");
  const [signerPosition, setSignerPosition] = useState("");

  const [isOpen2, setIsOpen2] = useState(false);
  const [isOpen3, setIsOpen3] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showCalendarSent, setShowCalendarSent] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [errors, setErrors] = useState<{ [key: string]: boolean }>({});

  const sigCanvas = useRef<SignatureCanvas | null>(null);
  const [isSigned, setIsSigned] = useState(false);

  const daysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) =>
    new Date(year, month, 1).getDay();

  const changeMonth = (offset: number) => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1),
    );
  };

  const selectDate = (day: number) => {
    const selected = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day,
    );
    setMeetingDate(
      selected.toLocaleDateString("th-TH", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    );
    setShowCalendar(false);
    setErrors((prev) => ({ ...prev, date: false }));
  };

  const selectDateSent = (day: number) => {
    const selected = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day,
    );
    setMeetingDateSent(
      selected.toLocaleDateString("th-TH", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    );
    setShowCalendarSent(false);
    setErrors((prev) => ({ ...prev, dateSent: false }));
  };

  const clearSignature = () => {
    sigCanvas.current?.clear();
    setIsSigned(false);
    setErrors((prev) => ({ ...prev, signature: false }));
  };

  const closeAllDropdowns = () => {
    setIsOpen2(false);
    setIsOpen3(false);
    setShowCalendar(false);
    setShowCalendarSent(false);
  };

  const handleReset = () => {
    if (
      confirm(
        "คุณต้องการล้างข้อมูลทั้งหมดและเริ่มสร้างการประชุมใหม่ใช่หรือไม่?",
      )
    ) {
      localStorage.removeItem("meeting_draft");
      window.location.reload();
    }
  };

  const handleSave = async () => {
    const isSigEmpty = sigCanvas.current ? sigCanvas.current.isEmpty() : true;
    const newErrors: { [key: string]: boolean } = {
      meetingType: !selected2,
      subject: !subject.trim(),
      meetingNo: !meetingNo.trim(),
      meetingSubType: !meetingSubType,
      attendees: !attendees.trim(),
      location: !location.trim(),
      date: !meetingDate,
      dateSent: !meetingDateSent,
      signer: !signerName.trim(),
      position: !signerPosition.trim(),
      agendas: agendas.some((a) => !a.trim()),
      signature: isSigEmpty,
    };
    setErrors(newErrors);
    const hasError = Object.values(newErrors).some((v) => v);
    if (hasError) return;

    const MEETING_TYPE_MAP: Record<string, string> = {
      "ประชุมสามัญ (AGM)": "AGM",
      "ประชุมวิสามัญ (EGM)": "EGM",
      ประชุมสามัญผู้ถือหุ้น: "AGM",
      ประชุมวิสามัญผู้ถือหุ้น: "EGM",
      ประชุมคณะกรรมการ: "BOD",
    };
    const meetingTypeEnum = MEETING_TYPE_MAP[selected2] ?? selected2;

    const formData = new FormData();
    formData.append("companyType", "LIMITED");
    formData.append("meetingType", meetingTypeEnum);
    formData.append("calledBy", callerName);
    formData.append("location", location);
    formData.append("agendas", JSON.stringify(agendas));
    formData.append("startedAt", new Date().toISOString());
    formData.append("meetingNo", meetingNo);

    try {
      const res = await fetch("/api/room", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        console.error("Failed to create room:", error);
        setErrors({ ...errors, submit: true });
        return;
      }

      const result = await res.json();
      console.log("Room created:", result);

      if (result.id && result.accessToken) {
        router.push(`/dashboard`);
      }
    } catch (error) {
      console.error("Error creating room:", error);
      setErrors({ ...errors, submit: true });
    }
  };

  const renderCalendarGrid = (onSelectDay: (day: number) => void) => (
    <motion.div
      className="create-form-calendar"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <div className="create-form-calendar-header">
        <button
          onClick={() => changeMonth(-1)}
          className="create-form-calendar-nav"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="create-form-calendar-month">
          {currentMonth.toLocaleDateString("th-TH", {
            month: "long",
            year: "numeric",
          })}
        </span>
        <button
          onClick={() => changeMonth(1)}
          className="create-form-calendar-nav"
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="create-form-calendar-grid">
        {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d) => (
          <span key={d} className="create-form-calendar-day-label">
            {d}
          </span>
        ))}
        {Array.from({
          length: firstDayOfMonth(
            currentMonth.getFullYear(),
            currentMonth.getMonth(),
          ),
        }).map((_, i) => (
          <div key={`e-${i}`} />
        ))}
        {Array.from({
          length: daysInMonth(
            currentMonth.getFullYear(),
            currentMonth.getMonth(),
          ),
        }).map((_, i) => (
          <button
            key={i}
            onClick={() => onSelectDay(i + 1)}
            className="create-form-calendar-day"
          >
            {i + 1}
          </button>
        ))}
      </div>
    </motion.div>
  );

  return (
    <motion.div
      className="max-w-2xl mx-auto mt-10 px-4"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex justify-between items-center mb-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition"
        >
          <ChevronLeft size={20} />
          <span>ย้อนกลับ</span>
        </Link>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 text-sm text-red-500 hover:text-red-700 transition px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-50"
        >
          <RotateCcw size={14} />
          สร้างการประชุมใหม่
        </button>
      </div>

      <div className="create-form-card">
        {/* 1. Company name (static) */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>ชื่อบริษัท</label>
          </div>
          <div className="create-form-select-wrapper">
            <div className="create-form-select">
              <h1>Legal Tech จำกัด.</h1>
            </div>
          </div>
        </div>

        {/* 2. Meeting type */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>ประเภทการประชุม</label>
            {errors.meetingType && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <div className="create-form-select-wrapper">
            <button
              onClick={() => {
                closeAllDropdowns();
                setIsOpen2(!isOpen2);
              }}
              className={`create-form-select ${errors.meetingType ? "create-form-select-error" : ""}`}
            >
              <span className={selected2 ? "" : "create-form-placeholder"}>
                {selected2 || "คลิกเลือกประเภท..."}
              </span>
              {/* <ChevronDown size={18} /> */}
            </button>
            {/* {isOpen2 && (
              <motion.div
                className="create-form-dropdown"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {options2.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setSelected2(opt);
                      setIsOpen2(false);
                      setErrors({ ...errors, meetingType: false });
                    }}
                    className="create-form-dropdown-item"
                  >
                    {opt}
                  </button>
                ))}
              </motion.div>
            )} */}
          </div>
        </div>

        {/* 3. Caller (read-only from localStorage) */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>ผู้เรียกประชุม</label>
          </div>
          <div className="create-form-input bg-gray-50 text-gray-700">
            {callerName || (
              <span className="text-gray-400">ไม่มีข้อมูลจากหน้า Quiz</span>
            )}
          </div>
        </div>

        {/* 4. Subject */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>เรื่อง</label>
            {errors.subject && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <input
            type="text"
            value={subject}
            placeholder="หนังสือนัดประชุม..."
            onChange={(e) => {
              setSubject(e.target.value);
              setErrors({ ...errors, subject: false });
            }}
            className={`create-form-input ${errors.subject ? "create-form-input-error" : ""}`}
          />
        </div>

        {/* 5. Attendees */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>เรียน</label>
            {errors.attendees && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <input
            type="text"
            value={attendees}
            placeholder="ผู้ถือหุ้น..."
            onChange={(e) => {
              setAttendees(e.target.value);
              setErrors({ ...errors, attendees: false });
            }}
            className={`create-form-input ${errors.attendees ? "create-form-input-error" : ""}`}
          />
        </div>

        {/* 6. Meeting number + subtype */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>ครั้งที่</label>
            {(errors.meetingNo || errors.meetingSubType) && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <div className="create-form-row">
            <input
              type="text"
              value={meetingNo}
              placeholder="1/2569"
              onChange={(e) => {
                setMeetingNo(e.target.value);
                setErrors({ ...errors, meetingNo: false });
              }}
              className={`create-form-input create-form-input-short ${errors.meetingNo ? "create-form-input-error" : ""}`}
            />
            <div className="create-form-select-wrapper create-form-flex-1">
              <button
                onClick={() => {
                  closeAllDropdowns();
                  setIsOpen3(!isOpen3);
                }}
                className={`create-form-select ${errors.meetingSubType ? "create-form-select-error" : ""}`}
              >
                <span
                  className={meetingSubType ? "" : "create-form-placeholder"}
                >
                  {meetingSubType || "เลือกประเภท..."}
                </span>
                <ChevronDown size={18} />
              </button>
              {isOpen3 && (
                <motion.div
                  className="create-form-dropdown"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {options3.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        setMeetingSubType(opt);
                        setIsOpen3(false);
                        setErrors({ ...errors, meetingSubType: false });
                      }}
                      className="create-form-dropdown-item"
                    >
                      {opt}
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* 7. Meeting date */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>วันที่ประชุม</label>
            {errors.date && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <div className="create-form-select-wrapper">
            <button
              onClick={() => {
                closeAllDropdowns();
                setShowCalendar(!showCalendar);
              }}
              className={`create-form-select ${errors.date ? "create-form-select-error" : ""}`}
            >
              <span className={meetingDate ? "" : "create-form-placeholder"}>
                {meetingDate || "กดเพื่อเลือกวันที่..."}
              </span>
              <CalendarIcon size={18} />
            </button>
            {showCalendar && renderCalendarGrid(selectDate)}
          </div>
        </div>

        {/* 8. Location */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>สถานที่</label>
            {errors.location && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <input
            type="text"
            value={location}
            placeholder="ระบุสถานที่ประชุม..."
            onChange={(e) => {
              setLocation(e.target.value);
              setErrors({ ...errors, location: false });
            }}
            className={`create-form-input ${errors.location ? "create-form-input-error" : ""}`}
          />
        </div>

        {/* 9. Agendas (read-only from localStorage) */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>วาระการประชุม</label>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            {agendas.length > 0 ? (
              <ul className="list-decimal pl-5 text-sm space-y-1">
                {agendas.map((agenda, index) => (
                  <li key={index} className="text-gray-700">
                    {agenda}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-gray-400 text-sm">ไม่มีข้อมูลวาระ...</span>
            )}
          </div>
        </div>

        <div className="create-form-divider" />

        {/* 10. Signer */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>ลงชื่อ</label>
            {errors.signer && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <input
            type="text"
            value={signerName}
            placeholder="ชื่อ-นามสกุล ของผู้ลงนาม..."
            onChange={(e) => {
              setSignerName(e.target.value);
              setErrors({ ...errors, signer: false });
            }}
            className={`create-form-input ${errors.signer ? "create-form-input-error" : ""}`}
          />
        </div>

        {/* 12. Position */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>ตำแหน่ง</label>
            {errors.position && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <input
            type="text"
            value={signerPosition}
            placeholder="เช่น กรรมการผู้มีอำนาจลงนาม..."
            onChange={(e) => {
              setSignerPosition(e.target.value);
              setErrors({ ...errors, position: false });
            }}
            className={`create-form-input ${errors.position ? "create-form-input-error" : ""}`}
          />
        </div>

        {/* 13. Digital signature */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label className="create-form-label-with-icon">
              <PenTool size={16} />
              ลงลายมือชื่อ
            </label>
            <button onClick={clearSignature} className="create-form-clear-sig">
              <RotateCcw size={12} />
              ล้างลายเส้น
            </button>
          </div>
          <div
            className={`create-form-signature ${errors.signature ? "create-form-signature-error" : ""}`}
          >
            <SignatureCanvas
              ref={sigCanvas}
              penColor="black"
              onBegin={() => {
                setIsSigned(true);
                setErrors({ ...errors, signature: false });
              }}
              canvasProps={{ className: "create-form-signature-canvas" }}
            />
            {!isSigned && (
              <div className="create-form-signature-placeholder">
                ใช้นิ้ววาดลายเซ็นที่นี่
              </div>
            )}
          </div>
        </div>

        {/* 14. Date sent */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>วันที่ส่งนัดหมาย</label>
            {errors.dateSent && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <div className="create-form-select-wrapper">
            <button
              onClick={() => {
                closeAllDropdowns();
                setShowCalendarSent(!showCalendarSent);
              }}
              className={`create-form-select ${errors.dateSent ? "create-form-select-error" : ""}`}
            >
              <span
                className={meetingDateSent ? "" : "create-form-placeholder"}
              >
                {meetingDateSent || "เลือกวันที่ส่ง..."}
              </span>
              <CalendarIcon size={18} />
            </button>
            <p className="create-form-hint">
              * ต้องส่งไม่น้อยกว่า 7 วัน ก่อนวันประชุม (ถ้ามติพิเศษ ไม่น้อยกว่า
              14 วัน)
            </p>
            {showCalendarSent && renderCalendarGrid(selectDateSent)}
          </div>
        </div>
      </div>

      <motion.button
        onClick={handleSave}
        className="create-form-submit"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.97 }}
      >
        สร้างหนังสือเชิญประชุม
      </motion.button>
    </motion.div>
  );
}
