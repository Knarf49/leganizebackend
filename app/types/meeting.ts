/**
 * Shared TypeScript types for the PACTA meeting management system.
 *
 * These types define the data contracts between the frontend and backend.
 * Backend developers: implement your API responses to match these shapes exactly.
 */

// ============================================================
// CORE DOMAIN TYPES
// ============================================================

/** Company type values aligned with POST /api/room */
export type CompanyType = "LIMITED" | "PUBLIC_LIMITED";

/** Meeting category */
export type MeetingType =
  | "ประชุมสามัญผู้ถือหุ้น"
  | "ประชุมวิสามัญผู้ถือหุ้น"
  | "ประชุมคณะกรรมการ";

/** Meeting sub-type (ordinary vs. extraordinary) */
export type MeetingSubType = "สามัญ" | "วิสามัญ";

/** Meeting status for lifecycle tracking */
export type MeetingStatus =
  | "draft"
  | "upcoming"
  | "live"
  | "completed"
  | "cancelled";

/** Color tag identifiers used on meeting cards */
export type TagColor = "red" | "yellow" | "green" | "blue";

// ============================================================
// AGENDA
// ============================================================

export interface Agenda {
  no: number;
  title: string;
  description: string;
  subItems?: string[];
}

// ============================================================
// MEETING — the central entity
// ============================================================

/** Compact meeting shape used in card listings (dashboard, summary) */
export interface MeetingCard {
  id: string; // UUID — assigned by backend
  title: string;
  company: string;
  type: MeetingType;
  no: string; // e.g. "2/2569"
  date: string; // Thai locale string, e.g. "25 มกราคม 2569"
  time: string; // e.g. "13:30 น. - 16:30 น."
  location: string;
  tags: TagColor[];
  status: MeetingStatus;
  isLive?: boolean;
  attendees?: number;
}

/** Full meeting detail (used on the live-meeting page & detail view) */
export interface MeetingDetail extends MeetingCard {
  agendas: Agenda[];
  resolution?: string;
}

// ============================================================
// CREATE MEETING — form payload
// ============================================================

/** Payload sent to the backend when creating a new meeting invitation */
export interface CreateMeetingPayload {
  companyType: CompanyType;
  meetingType: MeetingType;
  meetingSubType: MeetingSubType;
  callerName: string; // ผู้เรียกประชุม
  subject: string; // เรื่อง
  meetingNo: string; // e.g. "1/2569"
  attendees: string; // เรียน (recipients)
  location: string;
  meetingDate: string; // ISO-8601 or Thai locale
  dateSent: string; // วันที่ส่ง
  agendas: string[]; // list of agenda titles
  aoaFile: File | null;
  signerName: string;
  signerPosition: string;
  signatureDataUrl: string; // base64 PNG from signature canvas
}

/** Response after successful meeting creation */
export interface CreateMeetingResponse {
  id: string;
  createdAt: string; // ISO-8601
  status: MeetingStatus;
}

// ============================================================
// CALENDAR
// ============================================================

export interface CalendarEvent {
  day: number;
  color: string;
  label?: string;
}

// ============================================================
// API RESPONSE WRAPPERS (suggestions for backend)
// ============================================================

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
