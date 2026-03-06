"use client";

import {
  ChevronLeft,
  ChevronDown,
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronRight,
  Plus,
  Trash2,
  RotateCcw,
  PenTool,
} from "lucide-react";
import { useState, useRef } from "react";
import SignatureCanvas from "react-signature-canvas";
import Link from "next/link";
import { motion } from "framer-motion";
//TODO:  add POST /api/room body companyType,meetingType,meetingTopic 
//TODO:  add pdf loader from langchain

export default function CreateMeetingForm() {
  const options1 = ["บจก. (บริษัท จำกัด)", "บมจ. (บริษัท มหาชน จำกัด)"];
  const options2 = [
    "ประชุมสามัญผู้ถือหุ้น",
    "ประชุมวิสามัญผู้ถือหุ้น",
    "ประชุมคณะกรรมการ",
  ];
  const options3 = ["สามัญ", "วิสามัญ"];

  const [selected1, setSelected1] = useState("");
  const [selected2, setSelected2] = useState("");
  const [callerName, setCallerName] = useState("");
  const [subject, setSubject] = useState("");
  const [meetingNo, setMeetingNo] = useState("");
  const [meetingSubType, setMeetingSubType] = useState("");
  const [attendees, setAttendees] = useState("");
  const [location, setLocation] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingDateSent, setMeetingDateSent] = useState("");
  const [agendas, setAgendas] = useState([""]);
  const [signerName, setSignerName] = useState("");
  const [signerPosition, setSignerPosition] = useState("");

  const [isOpen1, setIsOpen1] = useState(false);
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

  const addAgenda = () => setAgendas([...agendas, ""]);
  const updateAgenda = (index: number, value: string) => {
    const newAgendas = [...agendas];
    newAgendas[index] = value;
    setAgendas(newAgendas);
    if (value.trim()) setErrors((prev) => ({ ...prev, agendas: false }));
  };
  const removeAgenda = (index: number) => {
    if (agendas.length > 1) setAgendas(agendas.filter((_, i) => i !== index));
  };

  const clearSignature = () => {
    sigCanvas.current?.clear();
    setIsSigned(false);
    setErrors((prev) => ({ ...prev, signature: false }));
  };

  const closeAllDropdowns = () => {
    setIsOpen1(false);
    setIsOpen2(false);
    setIsOpen3(false);
    setShowCalendar(false);
    setShowCalendarSent(false);
  };

  const handleSave = () => {
    const isSigEmpty = sigCanvas.current ? sigCanvas.current.isEmpty() : true;
    const newErrors: { [key: string]: boolean } = {
      companyType: !selected1,
      meetingType: !selected2,
      caller: !callerName.trim(),
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

    // ============================================================
    // TODO [BACKEND]: Wire up meeting creation API here.
    //
    // 1. Build the payload:
    //    import { CreateMeetingPayload } from "../types";
    //    const payload: CreateMeetingPayload = {
    //      companyType: selected1 as CompanyType,
    //      meetingType: selected2 as MeetingType,
    //      meetingSubType: meetingSubType as MeetingSubType,
    //      callerName,
    //      subject,
    //      meetingNo,
    //      attendees,
    //      location,
    //      meetingDate,
    //      dateSent: meetingDateSent,
    //      agendas,
    //      signerName,
    //      signerPosition,
    //      signatureDataUrl: sigCanvas.current?.toDataURL("image/png") ?? "",
    //    };
    //
    // 2. POST to /api/meetings:
    //    const res = await fetch("/api/meetings", {
    //      method: "POST",
    //      headers: { "Content-Type": "application/json" },
    //      body: JSON.stringify(payload),
    //    });
    //    const result = await res.json();
    //
    // 3. Handle response:
    //    if (result.success) router.push(`/summary`);
    //    else setErrors({ ...errors, submit: true });
    //
    // See: HANDOFF.md § "API Routes to Implement"
    // See: app/types/meeting.ts for all type definitions
    // ============================================================
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
      className="create-form-wrapper"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <header className="create-form-header">
        <Link href="/" className="create-form-back">
          <ChevronLeft size={22} />
          <h1>สร้างหนังสือเชิญประชุม</h1>
        </Link>
      </header>

      <div className="create-form-card">
        {/* 1. Company type */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>เลือกประเภทบริษัท</label>
            {errors.companyType && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <div className="create-form-select-wrapper">
            <button
              onClick={() => {
                closeAllDropdowns();
                setIsOpen1(!isOpen1);
              }}
              className={`create-form-select ${errors.companyType ? "create-form-select-error" : ""}`}
            >
              <span className={selected1 ? "" : "create-form-placeholder"}>
                {selected1 || "คลิกเลือกประเภทบริษัท..."}
              </span>
              <ChevronDown size={18} />
            </button>
            {isOpen1 && (
              <motion.div
                className="create-form-dropdown"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {options1.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setSelected1(opt);
                      setIsOpen1(false);
                      setErrors({ ...errors, companyType: false });
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
              <ChevronDown size={18} />
            </button>
            {isOpen2 && (
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
            )}
          </div>
        </div>

        {/* 3. Caller */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>ผู้เรียกประชุม</label>
            {errors.caller && (
              <span className="create-form-error">
                <AlertCircle size={12} /> จำเป็น
              </span>
            )}
          </div>
          <input
            type="text"
            value={callerName}
            placeholder="ชื่อบริษัท หรือ ชื่อผู้เรียก..."
            onChange={(e) => {
              setCallerName(e.target.value);
              setErrors({ ...errors, caller: false });
            }}
            className={`create-form-input ${errors.caller ? "create-form-input-error" : ""}`}
          />
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

        {/* 9. Agendas */}
        <div className="create-form-field">
          <div className="create-form-field-header">
            <label>วาระการประชุม</label>
            {errors.agendas && (
              <span className="create-form-error">
                <AlertCircle size={12} /> กรุณากรอกวาระ
              </span>
            )}
          </div>
          <div className="create-form-agendas">
            {agendas.map((agenda, index) => (
              <motion.div
                key={index}
                className="create-form-agenda-row"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.2 }}
              >
                <div className="create-form-agenda-input-wrapper">
                  <span className="create-form-agenda-number">
                    {index + 1}.
                  </span>
                  <input
                    type="text"
                    value={agenda}
                    placeholder={`วาระที่ ${index + 1}...`}
                    onChange={(e) => updateAgenda(index, e.target.value)}
                    className={`create-form-input create-form-agenda-input ${errors.agendas && !agenda.trim() ? "create-form-input-error" : ""}`}
                  />
                </div>
                {agendas.length > 1 && (
                  <button
                    onClick={() => removeAgenda(index)}
                    className="create-form-agenda-remove"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </motion.div>
            ))}
            <button onClick={addAgenda} className="create-form-agenda-add">
              <div className="create-form-agenda-add-icon">
                <Plus size={16} />
              </div>
              <span>เพิ่มวาระการประชุม</span>
            </button>
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

        {/* 11. Position */}
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

        {/* 12. Digital signature */}
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

        {/* 13. Date sent */}
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
