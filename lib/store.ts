"use client";
import { create } from "zustand";
import type { Race, Alert } from "./types";
import { apiUrl } from "./api-url";

interface Settings {
  evThreshold: number;
  steamThreshold: number;
  trackedTracks: Record<string, boolean>;
  alertsMuted: boolean;
}

interface Store {
  races: Race[];
  alerts: Alert[];
  connected: boolean;
  lastTick: number;
  sources: string[];
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  toast: Alert | null;
  pushToast: (a: Alert) => void;
  clearToast: () => void;
  _ingest: (races: Race[], alerts: Alert[], sources: string[]) => void;
  _connect: () => void;
  _disconnect: () => void;
  _es: EventSource | null;
}

const defaultSettings: Settings = {
  evThreshold: 10,
  steamThreshold: 60,
  trackedTracks: {},
  alertsMuted: false,
};

export const useToteflow = create<Store>((set, get) => ({
  races: [],
  alerts: [],
  connected: false,
  lastTick: 0,
  sources: [],
  settings: typeof window !== "undefined"
    ? { ...defaultSettings, ...readSettings() } : defaultSettings,
  setSettings(patch) {
    const merged = { ...get().settings, ...patch };
    set({ settings: merged });
    if (typeof window !== "undefined") writeSettings(merged);
  },
  toast: null,
  pushToast(a) {
    if (get().settings.alertsMuted) return;
    set({ toast: a });
    setTimeout(() => { if (get().toast?.id === a.id) set({ toast: null }); }, 4200);
  },
  clearToast() { set({ toast: null }); },
  _ingest(races, alerts, sources) {
    const prev = get().alerts;
    set({ races, alerts, lastTick: Date.now(), sources });
    const known = new Set(prev.map(a => a.id));
    const fresh = alerts.filter(a => !known.has(a.id));
    if (fresh.length) {
      const filtered = fresh.filter(a => !(a.type === "overlay" && a.severity === "info"));
      const last = filtered[0];
      if (last) get().pushToast(last);
    }
  },
  _es: null,
  _connect() {
    if (typeof window === "undefined") return;
    if (get()._es) return;
    const es = new EventSource(apiUrl("/api/stream"));
    es.addEventListener("tick", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        get()._ingest(data.races ?? [], data.alerts ?? [], data.sources ?? []);
        if (!get().connected) set({ connected: true });
      } catch {}
    });
    es.addEventListener("hello", () => set({ connected: true }));
    es.onerror = () => set({ connected: false });
    set({ _es: es });
  },
  _disconnect() {
    const es = get()._es;
    if (es) { es.close(); set({ _es: null, connected: false }); }
  },
}));

function readSettings(): Partial<Settings> {
  try { return JSON.parse(localStorage.getItem("toteflow:settings") || "{}"); }
  catch { return {}; }
}
function writeSettings(s: Settings) {
  try { localStorage.setItem("toteflow:settings", JSON.stringify(s)); } catch {}
}
