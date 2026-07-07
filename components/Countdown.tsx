"use client";
import { useEffect, useState } from "react";
import { fmtCountdown, phaseOf } from "@/lib/format";
import clsx from "clsx";

const phaseStyle = {
  scheduled: "text-ink-1",
  discovery: "text-accent-info",
  action: "text-accent-warn",
  chaos: "text-accent-steam",
  off: "text-accent-steam",
} as const;

export default function Countdown({
  postTime, size = "md", showLabel = true,
}: { postTime: number; size?: "sm" | "md" | "lg" | "xl"; showLabel?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const ms = postTime - now;
  const { mm, ss } = fmtCountdown(ms);
  const phase = ms <= 0 ? "off" : phaseOf(ms);
  const cls = phaseStyle[phase];
  const sizes = {
    sm: "text-sm",
    md: "text-2xl",
    lg: "text-5xl",
    xl: "text-7xl md:text-8xl",
  } as const;
  return (
    <div className={clsx("font-mono tabular-nums leading-none", cls, sizes[size],
      phase === "chaos" && "animate-pulse-fast",
    )}>
      {ms <= 0 ? "OFF" : `${mm}:${ss}`}
      {showLabel && (
        <div className="mt-1 stat-label">{phase}</div>
      )}
    </div>
  );
}
