"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  Plus,
  Radio,
  FileText,
  LayoutDashboard,
  ClipboardList,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export default function Navbar() {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const navItems = [
    { label: "ถ่ายทอดสดการประชุม", href: "/dashboard", icon: Radio },
    { label: "สรุปการประชุม", href: "/summarize", icon: ClipboardList },
    { label: "ภาพรวมข้อมูล", href: "/", icon: LayoutDashboard },
  ];

  const currentItem =
    navItems.find((item) => item.href === pathname) || navItems[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="navbar-left">
          <div className="navbar-dropdown-wrapper" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="navbar-dropdown-trigger"
              aria-expanded={isDropdownOpen}
              aria-haspopup="listbox"
            >
              <currentItem.icon size={16} className="navbar-dropdown-icon" />
              <span>{currentItem.label}</span>
              <ChevronDown
                size={14}
                className={`navbar-chevron ${isDropdownOpen ? "navbar-chevron-open" : ""}`}
              />
            </button>

            <AnimatePresence>
              {isDropdownOpen && (
                <motion.div
                  className="navbar-dropdown-menu"
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsDropdownOpen(false)}
                        className={`navbar-dropdown-item ${isActive ? "navbar-dropdown-item-active" : ""}`}
                      >
                        <item.icon size={16} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Link href="/create-meeting" className="navbar-new-meeting-btn">
            <Plus size={16} />
            <span>New Meeting</span>
          </Link>
        </div>

        <div className="navbar-right">
          <span className="navbar-brand-text">
            custom for Charoen Pokphand Group Co., Ltd.
          </span>
        </div>
      </div>
    </nav>
  );
}
