"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface Room {
  id: string;
  status: string;
  finalSummary: string | null;
  startedAt: string;
  endedAt: string | null;
  companyType: string;
}

export default function SummarizePage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let pollInterval: NodeJS.Timeout | undefined;

    const fetchRoomData = async () => {
      try {
        const response = await fetch(`/api/room/${roomId}`);

        if (!response.ok) {
          throw new Error("ไม่พบห้องหรือไม่มีสิทธิ์เข้าถึง");
        }

        const data = await response.json();
        setRoom(data.room);

        // If room has final summary or ended with error, stop polling
        if (data.room.finalSummary !== null) {
          setLoading(false);
          if (pollInterval) {
            clearInterval(pollInterval);
          }
        }
      } catch (err) {
        console.error("Error fetching room data:", err);
        setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
        setLoading(false);
        if (pollInterval) {
          clearInterval(pollInterval);
        }
      }
    };

    // Initial fetch
    fetchRoomData();

    // Poll every 2 seconds if summary is not ready
    pollInterval = setInterval(() => {
      if (room?.finalSummary === null) {
        fetchRoomData();
      }
    }, 2000);

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [roomId, room?.finalSummary]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
          <div className="text-red-600 text-xl mb-4">❌</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">
            เกิดข้อผิดพลาด
          </h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !room) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">กำลังโหลด...</h1>
          <p className="text-gray-600">กำลังดึงข้อมูลห้อง</p>
        </div>
      </div>
    );
  }

  const companyTypeLabel =
    room.companyType === "LIMITED" ? "บริษัทจำกัด" : "บริษัทมหาชนจำกัด";

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-blue-600 text-white p-6">
            <h1 className="text-2xl font-bold mb-2">สรุปการประชุม</h1>
            <div className="flex flex-col sm:flex-row sm:justify-between text-blue-100">
              <span>ห้อง: {roomId.slice(-8)}</span>
              <span>ประเภท: {companyTypeLabel}</span>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Status */}
            <div className="flex items-center mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <div className="text-sm text-gray-600 mb-1">สถานะ</div>
                <div
                  className={`font-medium ${room.status === "ENDED" ? "text-green-600" : "text-blue-600"}`}
                >
                  {room.status === "ENDED"
                    ? "สิ้นสุดแล้ว"
                    : room.status === "ACTIVE"
                      ? "กำลังดำเนินการ"
                      : room.status}
                </div>
              </div>
              {room.endedAt && (
                <div className="flex-1">
                  <div className="text-sm text-gray-600 mb-1">สิ้นสุดเมื่อ</div>
                  <div className="font-medium text-gray-800">
                    {new Date(room.endedAt).toLocaleString("th-TH")}
                  </div>
                </div>
              )}
            </div>

            {/* Summary Content */}
            {room.finalSummary === null ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  กำลังสรุป...
                </h2>
                <p className="text-gray-600">
                  ระบบกำลังประมวลผลและสรุปเนื้อหาการประชุม กรุณารอสักครู่
                </p>
                <div className="mt-4 text-sm text-gray-500">
                  หน้านี้จะอัพเดตอัตโนมัติเมื่อการสรุปเสร็จสิ้น
                </div>
              </div>
            ) : (
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-4">
                  ผลการสรุป
                </h2>
                <div className="bg-gray-50 p-6 rounded-lg">
                  <div className="prose max-w-none">
                    <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                      {room.finalSummary}
                    </div>
                  </div>
                </div>

                {room.endedAt && (
                  <div className="mt-4 text-sm text-gray-500 text-center">
                    สรุปเมื่อ: {new Date(room.endedAt).toLocaleString("th-TH")}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-8 flex justify-center">
              <button
                onClick={() => (window.location.href = "/")}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                กลับหน้าหลัก
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
