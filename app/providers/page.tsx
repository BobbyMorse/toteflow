"use client";
import { useEffect, useState } from "react";
import type { ProviderSummary } from "@/lib/types";
import { apiUrl } from "@/lib/api-url";
import clsx from "clsx";

const dot: Record<ProviderSummary["status"], string> = {
  live: "bg-accent-overlay",
  demo: "bg-accent-info",
  offline: "bg-ink-2",
  "needs-key": "bg-accent-warn",
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  useEffect(() => {
    fetch(apiUrl("/api/providers")).then(r => r.json()).then(j => setProviders(j.providers ?? []));
  }, []);
  return (
    <div className="py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-display font-semibold">Data Providers</h1>
        <p className="stat-label">Real upstream tote feeds. No simulated data.</p>
      </header>
      <div className="panel divide-y divide-line/40">
        {providers.map(p => (
          <div key={p.id} className="grid grid-cols-[140px_1fr_110px] gap-3 px-4 py-3 items-center text-sm">
            <span className="font-mono uppercase tracking-wider text-ink-2">{p.id}</span>
            <div>
              <div className="text-ink-0">{p.label}</div>
              {p.notes && <div className="text-[12px] text-ink-2 mt-0.5">{p.notes}</div>}
            </div>
            <div className="flex items-center gap-2 justify-end">
              <span className={clsx("w-2 h-2 rounded-full", dot[p.status])} />
              <span className="font-mono uppercase tracking-wider text-xs text-ink-1">{p.status}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 panel p-4 text-sm text-ink-1 space-y-2">
        <p><span className="text-ink-0 font-semibold">How to enable additional feeds:</span></p>
        <ul className="list-disc pl-5 space-y-1 text-ink-2">
          <li><span className="text-ink-1">TVG</span> — already live (open GraphQL, no auth). Source of US/AU/INT&apos;L tote odds.</li>
          <li><span className="text-ink-1">The Racing API</span> — set <code className="font-mono text-accent-cyan">RACING_API_USER</code> and <code className="font-mono text-accent-cyan">RACING_API_PASS</code> in <code className="font-mono">.env.local</code> for UK/IRE coverage.</li>
          <li><span className="text-ink-1">Betfair Exchange</span> — set <code className="font-mono text-accent-cyan">BETFAIR_APP_KEY</code> and <code className="font-mono text-accent-cyan">BETFAIR_SESSION_TOKEN</code>.</li>
          <li><span className="text-ink-1">HKJC</span> — parser is unwired; needs HTML scraping to enable.</li>
        </ul>
      </div>
    </div>
  );
}
