import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "PACTA - ระบบจัดการประชุมทางกฎหมาย",
  description: "ระบบถ่ายทอดสดและจัดการเอกสารประชุมสำหรับบริษัทจำกัดและมหาชน",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>
        <div className="app-shell">
          <Navbar />
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
