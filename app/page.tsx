"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col gap-4 px-16 py-32 bg-white dark:bg-black">
        <Link href="/record">
          <button className="px-4 py-2 border rounded-md bg-secondary cursor-pointer">
            Go to record page
          </button>
        </Link>
      </main>
    </div>
  );
}
