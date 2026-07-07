"use client";
import { useToteflow } from "@/lib/store";
import { useMemo } from "react";

export default function SettingsPage() {
  const settings = useToteflow(s => s.settings);
  const setSettings = useToteflow(s => s.setSettings);
  const races = useToteflow(s => s.races);

  const tracks = useMemo(() => {
    const m = new Map<string, string>();
    races.forEach(r => m.set(r.trackCode, r.track));
    return [...m.entries()].sort();
  }, [races]);

  return (
    <div className="py-6 max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-display font-semibold">Settings</h1>
        <p className="stat-label">Tune what fires an alert.</p>
      </header>

      <section className="panel p-5 space-y-4">
        <h2 className="text-sm font-semibold">Alert Thresholds</h2>
        <Range label={`Overlay EV ≥ ${settings.evThreshold}%`} min={0} max={40} step={1} value={settings.evThreshold} onChange={v => setSettings({ evThreshold: v })}/>
        <Range label={`Steam score ≥ ${settings.steamThreshold}`} min={0} max={100} step={5} value={settings.steamThreshold} onChange={v => setSettings({ steamThreshold: v })}/>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={settings.alertsMuted}
            onChange={e => setSettings({ alertsMuted: e.target.checked })}
            className="w-4 h-4 accent-accent-cyan"/>
          Mute toast notifications
        </label>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-3">Track Filter</h2>
        {tracks.length === 0 ? <div className="text-ink-2 text-sm">No tracks yet. Open the radar to populate.</div> : (
          <div className="grid grid-cols-2 gap-2">
            {tracks.map(([code, name]) => {
              const on = settings.trackedTracks[code] !== false; // default on
              return (
                <label key={code} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={on} onChange={e => setSettings({
                    trackedTracks: { ...settings.trackedTracks, [code]: e.target.checked },
                  })} className="w-4 h-4 accent-accent-cyan"/>
                  <span className="font-mono text-ink-2">{code}</span>
                  <span className="text-ink-0">{name}</span>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-2">About</h2>
        <p className="text-sm text-ink-1">
          ToteFlow is a live tote market intelligence and strategy-validation interface for horse racing.
          Live odds come from TVG&apos;s open GraphQL feed; strategies are evaluated against real outcomes
          with CLV-tracked paper bets. It is not a tipping service.
        </p>
      </section>
    </div>
  );
}

function Range({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm">{label}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-accent-cyan" />
    </label>
  );
}
