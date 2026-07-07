"use client";
export default function Sparkline({
  points, width = 80, height = 24, stroke = "#22d3ee",
}: { points: { t: number; odds: number }[]; width?: number; height?: number; stroke?: string }) {
  if (!points.length) return <svg width={width} height={height} />;
  const xs = points.map(p => p.t);
  const ys = points.map(p => p.odds);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const xrange = xmax - xmin || 1;
  const yrange = ymax - ymin || 1;
  const d = points.map((p, i) => {
    const x = ((p.t - xmin) / xrange) * width;
    const y = height - ((p.odds - ymin) / yrange) * (height - 2) - 1;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  // Trend: lower odds = green (steam), higher = red
  const trend = ys[ys.length - 1] - ys[0];
  const color = trend < 0 ? "#22c55e" : trend > 0 ? "#ef4444" : stroke;
  return (
    <svg width={width} height={height} className="block">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
