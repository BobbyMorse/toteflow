"use client";
import { useToteflow } from "@/lib/store";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";

const sevStyle: Record<string, string> = {
  info: "border-accent-info/40 bg-accent-info/10 text-accent-info",
  warn: "border-accent-warn/40 bg-accent-warn/10 text-accent-warn",
  high: "border-accent-steam/40 bg-accent-steam/10 text-accent-steam",
};
const sevIcon: Record<string, string> = { info: "⚡", warn: "🔥", high: "🚨" };

export default function AlertHost() {
  const toast = useToteflow(s => s.toast);
  const clear = useToteflow(s => s.clearToast);
  return (
    <div className="fixed top-16 right-4 z-50 pointer-events-none">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className={`pointer-events-auto w-[340px] rounded-lg border ${sevStyle[toast.severity] || sevStyle.info} backdrop-blur-md shadow-2xl shadow-black/40`}
          >
            <Link href={`/race/${toast.raceId}`} onClick={clear} className="block p-3">
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider">
                <span>{sevIcon[toast.severity] || "⚡"}</span>
                <span>{toast.type}</span>
                <span className="ml-auto opacity-70">{new Date(toast.ts).toLocaleTimeString([], { hour12: false })}</span>
              </div>
              <div className="mt-1.5 text-sm font-semibold text-ink-0">{toast.title}</div>
              <div className="text-xs text-ink-1 mt-0.5">{toast.body}</div>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
