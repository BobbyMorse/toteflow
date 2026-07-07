import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { 0: "#05070b", 1: "#0a0e15", 2: "#10151f", 3: "#19202d" },
        ink: { 0: "#e7edf7", 1: "#9aa6b9", 2: "#5c6678" },
        accent: {
          steam: "#ff3b3b",
          overlay: "#22c55e",
          warn: "#f59e0b",
          info: "#38bdf8",
          chaos: "#ef4444",
          cyan: "#22d3ee",
        },
        line: "#1f2837",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        display: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-fast": "pulse 0.8s cubic-bezier(0.4,0,0.6,1) infinite",
        "ticker-flash": "tickerFlash 600ms ease-out",
        "chaos-pulse": "chaosPulse 1.2s ease-in-out infinite",
        "scan": "scan 3s linear infinite",
      },
      keyframes: {
        tickerFlash: {
          "0%": { backgroundColor: "rgba(34,211,238,0.35)" },
          "100%": { backgroundColor: "transparent" },
        },
        chaosPulse: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(239,68,68,0.55)" },
          "50%": { boxShadow: "0 0 0 16px rgba(239,68,68,0)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
