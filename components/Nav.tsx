"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useToteflow } from "@/lib/store";
import clsx from "clsx";
import StreamProvider from "./StreamProvider";

const tabs = [
  { href: "/",          label: "Race Radar" },
  { href: "/tickets",   label: "Tickets" },
  { href: "/stats",     label: "Results" },
  { href: "/analytics", label: "Analytics" },
  { href: "/providers", label: "Providers" },
  { href: "/settings",  label: "Settings" },
];

export default function Nav() {
  const pathname = usePathname();
  const connected = useToteflow(s => s.connected);
  const sources = useToteflow(s => s.sources);
  const live = sources.length > 0;
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-bg-0/80 border-b border-line">
      <StreamProvider />
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-display font-semibold tracking-tight">ToteFlow</span>
          <span className="hidden md:inline text-[10px] uppercase tracking-[0.18em] text-ink-2 ml-2">
            Live Tote Market Intelligence
          </span>
        </Link>
        <nav className="flex items-center gap-1 ml-2">
          {tabs.map(t => (
            <Link key={t.href} href={t.href}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname === t.href ? "bg-bg-3 text-ink-0" : "text-ink-1 hover:text-ink-0 hover:bg-bg-2"
              )}
            >{t.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className={clsx(
            "flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11px] font-mono uppercase tracking-wider",
            live
              ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay"
              : "border-accent-warn/40 bg-accent-warn/10 text-accent-warn animate-pulse",
          )} title={live ? `Live data from ${sources.join(", ")}` : "No upstream provider responding"}>
            <span className={clsx("w-1.5 h-1.5 rounded-full",
              live ? "bg-accent-overlay" : "bg-accent-warn")}/>
            {live ? `Live · ${sources.join("+")}` : "Offline"}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={clsx(
              "w-2 h-2 rounded-full",
              connected ? "bg-accent-overlay animate-pulse" : "bg-ink-2"
            )} />
            <span className="text-ink-2 font-mono uppercase tracking-wider">
              {connected ? "Conn" : "Off"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="#22d3ee" strokeWidth="1.5"/>
      <path d="M3 12h4l2-4 3 8 2-5 2 3h5" stroke="#22d3ee" strokeWidth="1.5" fill="none"/>
    </svg>
  );
}
