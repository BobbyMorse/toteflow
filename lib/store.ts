"use client";
import { create } from "zustand";
import type { Race } from "./types";
import { apiUrl } from "./api-url";

interface Store {
  races: Race[];
  connected: boolean;
  lastTick: number;
  sources: string[];
  _ingest: (races: Race[], sources: string[]) => void;
  _connect: () => void;
  _disconnect: () => void;
  _es: EventSource | null;
}

export const useToteflow = create<Store>((set, get) => ({
  races: [],
  connected: false,
  lastTick: 0,
  sources: [],
  _ingest(races, sources) {
    set({ races, lastTick: Date.now(), sources });
  },
  _es: null,
  _connect() {
    if (typeof window === "undefined") return;
    if (get()._es) return;
    const es = new EventSource(apiUrl("/api/stream"));
    es.addEventListener("tick", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        get()._ingest(data.races ?? [], data.sources ?? []);
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
