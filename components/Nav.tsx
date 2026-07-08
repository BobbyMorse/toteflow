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
];

export default function Nav() {
  const pathname = usePathname();
  const connected = useToteflow(s => s.connected);
  const sources = useToteflow(s => s.sources);
  const live = sources.length > 0;
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-bg-0/80 border-b border-line">
      <StreamProvider />
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 py-2 sm:py-0 sm:h-14 flex flex-wrap items-center gap-x-3 sm:gap-x-6 gap-y-2">
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <Logo />
          <span className="font-display font-semibold tracking-tight">ToteFlow</span>
          <span className="hidden md:inline text-[10px] uppercase tracking-[0.18em] text-ink-2 ml-2">
            Live Tote Market Intelligence
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:order-last">
          <div className={clsx(
            "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] sm:text-[11px] font-mono uppercase tracking-wider",
            live
              ? "border-accent-overlay/40 bg-accent-overlay/10 text-accent-overlay"
              : "border-accent-warn/40 bg-accent-warn/10 text-accent-warn animate-pulse",
          )} title={live ? `Live data from ${sources.join(", ")}` : "No upstream provider responding"}>
            <span className={clsx("w-1.5 h-1.5 rounded-full",
              live ? "bg-accent-overlay" : "bg-accent-warn")}/>
            <span className="hidden sm:inline">{live ? `Live · ${sources.join("+")}` : "Offline"}</span>
            <span className="sm:hidden">{live ? "Live" : "Off"}</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <span className={clsx(
              "w-2 h-2 rounded-full",
              connected ? "bg-accent-overlay animate-pulse" : "bg-ink-2"
            )} />
            <span className="text-ink-2 font-mono uppercase tracking-wider">
              {connected ? "Conn" : "Off"}
            </span>
          </div>
        </div>
        <nav className="flex items-center gap-0.5 sm:gap-1 sm:ml-2 w-full sm:w-auto overflow-x-auto">
          {tabs.map(t => (
            <Link key={t.href} href={t.href}
              className={clsx(
                "px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm transition-colors whitespace-nowrap",
                pathname === t.href ? "bg-bg-3 text-ink-0" : "text-ink-1 hover:text-ink-0 hover:bg-bg-2"
              )}
            >{t.label}</Link>
          ))}
        </nav>
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
