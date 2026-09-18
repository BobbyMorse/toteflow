import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Post-Mortem: A Real Edge, Not a Big Enough One — ToteFlow",
  description:
    "16,071 paper bets across every horse-racing strategy I could formalize. Steam-following genuinely found winners for two months — and still lost to the takeout. The honest account.",
};

// ---------------------------------------------------------------------------
// Point-in-time post-mortem. All figures as reported by /api/stats on
// 2026-09-18, graded on REAL tote payouts (estimated-payout exotic wins netted
// out). This is a dated narrative, not a live dashboard — numbers are frozen.
// ---------------------------------------------------------------------------

type Verdict = "loss" | "even" | "mirage";

interface Row {
  name: string;
  thesis: string;
  n: number;
  won: number;
  roi: number;
  lo: number | null;
  hi: number | null;
  v: Verdict;
  note?: string;
}

const MAIN: Row[] = [
  { name: "TVG Model Overlay (baseline)", thesis: "Bet WIN when the calibrated model's win probability beats the market's implied odds (positive EV), on high-confidence races. The whole program's foundation.", n: 5446, won: 661, roi: -12.5, lo: -23, hi: -3, v: "loss" },
  { name: "TVG Model Overlay — Harness", thesis: "The same model logic applied to standardbred / harness racing, at a reduced trust weight.", n: 5374, won: 662, roi: -26.7, lo: -36, hi: -17, v: "loss" },
  { name: "Daily Double Consensus", thesis: "Pair the model's top overlay pick in two consecutive races into a single-combo Daily Double.", n: 1101, won: 123, roi: -47.0, lo: null, hi: null, v: "mirage", note: "showed +51% on estimated payouts" },
  { name: "TVG Late Field Scan", thesis: "Measure-only: flag any runner getting crushed by late money, with no model input — a control for whether the model itself adds anything over the raw market move.", n: 1061, won: 85, roi: -13.2, lo: -42, hi: 15, v: "even" },
  { name: "TVG Steam Confirm", thesis: "Bet WIN only when the model's pick is ALSO being hammered by late money (15–35% odds crush) — 'smart money' confirmation. The strategy I was sure about.", n: 1050, won: 197, roi: -1.6, lo: -20, hi: 16, v: "even" },
  { name: "Heavy-Favorite Fade", thesis: "Bet the 2nd choice when the favorite is odds-on (below even money) in fields of 8+. Thesis: the public overbets short favorites.", n: 589, won: 88, roi: -23.7, lo: -40, hi: -7, v: "loss" },
  { name: "Carryover Pick-N", thesis: "Play multi-race Pick-N tickets into inflated carryover pools where dead money sweetens the payout.", n: 485, won: 5, roi: -36.0, lo: -100, hi: 2, v: "even", note: "estimated payouts netted out" },
  { name: "Heavy-Favorite Fade — Harness", thesis: "Favorite-fade applied to harness racing.", n: 477, won: 66, roi: -17.6, lo: -40, hi: 5, v: "even" },
  { name: "Same-Day Track Bias — Harness", thesis: "Detect inside/outside post-position bias from earlier races on the same track, then ride horses whose post matches the bias.", n: 173, won: 26, roi: -19.2, lo: -55, hi: 17, v: "even" },
  { name: "Trifecta Top-3 Box", thesis: "Box the model's top 3 contenders when they clearly outrun the field — any in-the-money order pays.", n: 136, won: 6, roi: -60.9, lo: -97, hi: -25, v: "loss" },
  { name: "Dr. Z Place", thesis: "Ziemba–Hausch place-pool mispricing: bet PLACE when a horse's win-pool probability materially exceeds its place-pool probability.", n: 64, won: 28, roi: -32.5, lo: -52, hi: -13, v: "loss" },
];

const SMALL: Row[] = [
  { name: "TVG Model Overlay — Quarter Horse", thesis: "", n: 29, won: 3, roi: -60.9, lo: -105, hi: -17, v: "even" },
  { name: "Exacta Overlay Pair", thesis: "", n: 26, won: 3, roi: -54.2, lo: -107, hi: -2, v: "even" },
  { name: "TVG Steam Confirm — Harness", thesis: "", n: 22, won: 1, roi: -81.2, lo: -117, hi: -45, v: "even" },
  { name: "TVG Model Overlay — Jumps", thesis: "", n: 14, won: 1, roi: -25.0, lo: -167, hi: 117, v: "even" },
  { name: "Dr. Z Place — Jumps", thesis: "", n: 8, won: 3, roi: -45.0, lo: -96, hi: 6, v: "even" },
  { name: "TVG Late Steam Scan", thesis: "", n: 5, won: 1, roi: -47.0, lo: -140, hi: 46, v: "even" },
  { name: "Same-Day Track Bias — QH", thesis: "", n: 5, won: 0, roi: -100, lo: -100, hi: -100, v: "even" },
  { name: "Same-Day Track Bias — Jumps", thesis: "", n: 2, won: 0, roi: -100, lo: -100, hi: -100, v: "even" },
  { name: "Heavy-Favorite Fade — QH", thesis: "", n: 2, won: 1, roi: 115, lo: -183, hi: 413, v: "even" },
  { name: "TVG Steam — Closing Gate", thesis: "", n: 1, won: 0, roi: -100, lo: null, hi: null, v: "even" },
];

// tvg-steam cumulative paper P&L, daily. [MM-DD, cumulative $]. The curve that
// convinced me — up past $1,600, then five weeks giving it all back.
const STEAM: [string, number][] = [
  ["07-17", -5], ["07-18", 313], ["07-19", -7], ["07-20", 443], ["07-21", 259], ["07-22", 101], ["07-23", 1], ["07-24", -57], ["07-25", 229], ["07-26", 349], ["07-27", 325], ["07-28", 799], ["07-29", 1006], ["07-30", 1074], ["07-31", 1225],
  ["08-01", 1068], ["08-02", 1326], ["08-03", 1612], ["08-04", 1494], ["08-05", 1423], ["08-06", 1596], ["08-07", 1418], ["08-08", 1292], ["08-09", 1168], ["08-10", 1060], ["08-11", 1318], ["08-12", 1632], ["08-13", 1428], ["08-14", 1189], ["08-15", 961], ["08-16", 1343], ["08-17", 1123], ["08-18", 1028], ["08-19", 1153], ["08-20", 970], ["08-21", 1455], ["08-22", 1215], ["08-23", 1015], ["08-24", 826], ["08-25", 807], ["08-26", 587], ["08-27", 565], ["08-28", 963], ["08-29", 817], ["08-30", 597], ["08-31", 839],
  ["09-01", 881], ["09-02", 573], ["09-03", 1235], ["09-04", 989], ["09-05", 709], ["09-06", 763], ["09-07", 989], ["09-08", 857], ["09-09", 643], ["09-10", 403], ["09-11", 273], ["09-12", 150], ["09-13", 136], ["09-14", 179], ["09-15", -1], ["09-16", -90], ["09-17", -244], ["09-18", -342],
];

const TIMELINE: [string, string, string][] = [
  ["Jun 30", "First bet", "The TVG model overlay goes live — bet WIN wherever the calibrated probability beats the market price."],
  ["Jul 11", "Breed variants", "Harness, quarter-horse and jumps splits added at a low trust weight, to see if the model travels across disciplines. (It doesn't — harness is the worst bleeder in the whole program.)"],
  ["Jul 13", "Real-tote grading", "Exotic bets start settling at genuine per-combo payouts where the feed supplies them; estimated payouts get quarantined. The dividing line between real and imagined P&L."],
  ["Jul 17", "Steam goes live", "TVG Steam Confirm starts firing: only bet the model's pick when late money is also crushing its price. Within two weeks it's up over $1,200."],
  ["Aug 12", "The peak", "Steam tops out at +$1,632 on paper. Every diagnostic — hit rate, closing-line value — says the signal is real. I'm convinced this is the one."],
  ["Aug – Sep", "The variant hunt", "Value-survival gates, longshot floors, a closing-EV gate, an overbet guard, a model-free pure-steam scanner. Each tries to isolate the good steam bets from the bad. None clears the takeout."],
  ["Sep 15", "Back to zero", "Steam's cumulative paper P&L crosses back below break-even. The two-month lead is gone."],
  ["Sep 18", "The verdict", "16,071 bets in, no strategy has positive tote-verified P&L. The edge was real; it was never big enough."],
];

// --- CI-vs-zero bar --------------------------------------------------------
const AX = 120;
const posPct = (v: number) => ((v + AX) / (2 * AX)) * 100;
const clamp = (p: number) => Math.max(0, Math.min(100, p));
const V_COLOR: Record<Verdict, string> = { loss: "#ff3b3b", even: "#5c6678", mirage: "#f59e0b" };

function CiBar({ lo, hi, roi, v }: { lo: number | null; hi: number | null; roi: number; v: Verdict }) {
  const color = V_COLOR[v];
  const zero = posPct(0);
  if (lo === null || hi === null) {
    return (
      <div className="relative h-[22px] min-w-[150px] w-full rounded bg-bg-2">
        <span className="absolute -top-[3px] -bottom-[3px] w-px bg-ink-2/60" style={{ left: `${zero}%` }} />
        <span className="absolute top-1.5 text-[10px] text-ink-2 font-mono" style={{ left: `${clamp(posPct(roi))}%`, transform: "translateX(-50%)" }}>n=1</span>
      </div>
    );
  }
  const l = clamp(posPct(lo));
  const h = clamp(posPct(hi));
  return (
    <div className="relative h-[22px] min-w-[150px] w-full rounded bg-bg-2">
      <span className="absolute -top-[3px] -bottom-[3px] w-px bg-ink-2/60" style={{ left: `${zero}%` }} />
      <span className="absolute top-[7px] h-2 rounded-full opacity-85" style={{ left: `${l}%`, width: `${h - l}%`, background: color }} />
      <span className="absolute top-1 h-3.5 w-[3px] rounded-sm" style={{ left: `${clamp(posPct(roi))}%`, background: color }} />
      {lo < -AX && <span className="absolute top-1.5 left-0.5 text-[10px] text-ink-2 leading-none">‹</span>}
      {hi > AX && <span className="absolute top-1.5 right-0.5 text-[10px] text-ink-2 leading-none">›</span>}
    </div>
  );
}

function VerdictChip({ v }: { v: Verdict }) {
  if (v === "loss") return <span className="chip bg-accent-steam/15 text-accent-steam border border-accent-steam/30">Proven loss</span>;
  if (v === "mirage") return <span className="chip bg-accent-warn/15 text-accent-warn border border-accent-warn/30">Mirage</span>;
  return <span className="chip bg-bg-3 text-ink-2 border border-line">Inconclusive</span>;
}

const roiTxt = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(1)}%`;
const roiColor = (v: Verdict) => (v === "loss" || v === "mirage" ? "text-accent-steam" : "text-ink-1");

// --- Steam cumulative-P&L chart (server-rendered SVG) ----------------------
function SteamChart() {
  const W = 760, H = 230, padL = 6, padR = 6, padT = 16, padB = 22;
  const vals = STEAM.map((d) => d[1]);
  const ymin = -450, ymax = 1750;
  const n = STEAM.length;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - ymin) / (ymax - ymin)) * (H - padT - padB);
  const line = STEAM.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[1]).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const peakI = vals.indexOf(Math.max(...vals));
  const zeroCrossI = STEAM.findIndex((d, i) => i > peakI && d[1] < 0);
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="stat-label">TVG Steam · cumulative paper P&amp;L</p>
        <p className="text-xs text-ink-2 font-mono">Jul 17 → Sep 18 · 1,050 bets</p>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[540px]" role="img" aria-label="Cumulative profit and loss for the steam strategy: a two-month climb to a peak of $1,632 followed by a decline to negative $342.">
          <defs>
            <linearGradient id="steamfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* zero line */}
          <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="#5c6678" strokeWidth="1" strokeDasharray="3 3" />
          <text x={padL + 2} y={y(0) - 5} fill="#5c6678" fontSize="10" fontFamily="ui-monospace, monospace">break-even</text>
          {/* +1000 gridline */}
          <line x1={padL} y1={y(1000)} x2={W - padR} y2={y(1000)} stroke="#1f2837" strokeWidth="1" />
          <text x={padL + 2} y={y(1000) - 4} fill="#3a4759" fontSize="9.5" fontFamily="ui-monospace, monospace">+$1,000</text>
          {/* area + line */}
          <path d={area} fill="url(#steamfill)" />
          <path d={line} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {/* peak marker */}
          <circle cx={x(peakI)} cy={y(vals[peakI])} r="3.5" fill="#f59e0b" />
          <text x={x(peakI)} y={y(vals[peakI]) - 9} fill="#e7edf7" fontSize="11" fontWeight="600" textAnchor="middle" fontFamily="ui-monospace, monospace">+$1,632</text>
          <text x={x(peakI)} y={y(vals[peakI]) - 23} fill="#5c6678" fontSize="9.5" textAnchor="middle" fontFamily="ui-monospace, monospace">Aug 12 peak</text>
          {/* zero-cross marker */}
          {zeroCrossI > -1 && <circle cx={x(zeroCrossI)} cy={y(0)} r="3" fill="#ff3b3b" />}
          {/* end marker */}
          <circle cx={x(n - 1)} cy={y(vals[n - 1])} r="3.5" fill="#ff3b3b" />
          <text x={x(n - 1) - 4} y={y(vals[n - 1]) + 16} fill="#ff3b3b" fontSize="11" fontWeight="600" textAnchor="end" fontFamily="ui-monospace, monospace">−$342</text>
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function ResearchPage() {
  return (
    <div className="py-6 sm:py-10 max-w-3xl mx-auto space-y-16">

      {/* Masthead */}
      <header className="space-y-5 border-b border-line pb-10">
        <p className="flex items-center gap-2.5 text-[11px] font-mono uppercase tracking-[0.18em] text-accent-warn">
          <span className="inline-block w-6 h-px bg-accent-warn" />
          Field Research · Post-Mortem
        </p>
        <h1 className="font-display font-semibold tracking-tight text-4xl sm:text-6xl leading-[1.03] text-balance">
          There was an edge.<br />It just couldn&apos;t clear the fees.
        </h1>
        <p className="text-lg sm:text-xl text-ink-1 max-w-[46ch] leading-relaxed">
          A post-mortem of <strong className="text-ink-0">16,071 paper bets</strong> and every horse-racing
          strategy I could formalize. One of them — steam-following — genuinely found winners for two months.
          It still lost money. This is the honest account of why, kept public so the next person doesn&apos;t
          have to relearn it the hard way.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-2 font-mono pt-1">
          <span><span className="text-ink-1">WINDOW</span> 2026-06-30 → 2026-09-18</span>
          <span><span className="text-ink-1">STRATEGIES</span> 20+</span>
          <span><span className="text-ink-1">MONEY</span> paper only</span>
        </div>
      </header>

      {/* Ch 1 — why an edge should exist */}
      <section className="space-y-4">
        <SecHead n="01" label="Why I thought this was winnable" />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          US horse racing runs on <strong className="text-ink-0">pari-mutuel</strong> pools: you bet against other
          bettors, not a bookmaker, and the track skims a cut of every pool — the <em>takeout</em>, typically
          15% on win bets and up to 21% on exotics. Because the house isn&apos;t your counterparty, it has no
          reason to hide sharp signal from you. Useful probability estimates exist in the open, and the crowd that
          has to absorb them is famously noisy. If you could find the right signal and be disciplined about when to
          fire, positive expected value should show up in specific pockets. That was the whole thesis. It is not
          obviously wrong — and that&apos;s what makes the answer interesting.
        </p>
        <div className="panel p-5 border-l-2 border-l-accent-warn">
          <p className="text-ink-1 text-sm leading-relaxed max-w-none">
            The catch, visible only in hindsight: that takeout is a <strong className="text-ink-0">15–21% wall</strong>{" "}
            standing in front of every bet. A signal doesn&apos;t just have to be right. It has to be right by
            <em> more than the wall is tall.</em>
          </p>
        </div>
      </section>

      {/* Ch 2 — the steam story */}
      <section className="space-y-5">
        <SecHead n="02" label="The bet I was sure about" />
        <p className="font-display text-xl sm:text-2xl text-ink-0 max-w-[30ch] text-balance leading-snug">
          For two months, steam-following looked exactly like a real edge — because it was one.
        </p>
        <p className="text-ink-1 leading-relaxed text-[17px]">
          &ldquo;Steam&rdquo; is money pouring onto a horse late, crushing its price. The idea: when my model already
          liked a horse <em>and</em> the late money was hammering it too, that was two independent signals agreeing.
          I only fired when a pick&apos;s odds were being crushed 15–35% into post. It started immediately. Inside two
          weeks it was up over $1,200 on paper; by the second week of August it had climbed past{" "}
          <strong className="text-ink-0">$1,600</strong>. I was convinced steam was the one.
        </p>
        <SteamChart />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          And the diagnostics backed it up. This wasn&apos;t a lucky streak on a dead signal — every measure of
          quality said the steam picks were genuinely better than the field:
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Stat v="18.8%" l="Steam hit rate" s="vs. 12.2% field-wide — steam picks won 55% more often" c="text-accent-overlay" />
          <Stat v="+40%" l="Closing-line value" s="captured prices consistently beat the closing odds" c="text-accent-overlay" />
          <Stat v="1,050" l="Bets" s="a real sample, not a handful of lucky longshots" c="text-ink-0" />
        </div>
        <p className="text-ink-2 text-sm leading-relaxed">
          More winners than the field. Better prices than the close. On any normal read, that is what an edge looks like.
        </p>
      </section>

      {/* Ch 3 — the wall */}
      <section className="space-y-5">
        <SecHead n="03" label="Then it gave all of it back" />
        <p className="font-display text-xl sm:text-2xl text-ink-0 max-w-[32ch] text-balance leading-snug">
          The signal was real. The takeout was bigger.
        </p>
        <p className="text-ink-1 leading-relaxed text-[17px]">
          From the August 12 peak, steam bled for five straight weeks and crossed back below break-even on September 15.
          Final tally: <strong className="text-ink-0">−1.6% ROI over 1,050 bets</strong>, confidence interval −20% to +16%
          — statistically a coin flip, the closest any real strategy came to break-even, and still not profitable.
        </p>
        <p className="text-ink-1 leading-relaxed text-[17px]">
          Here is the resolution to the paradox, and the single most important number in this whole writeup. When I
          re-priced each steam pick at the <em>closing</em> odds, its expected value was{" "}
          <strong className="text-accent-steam">−22%</strong>. The late money I was following didn&apos;t just confirm
          the horse — it shortened the price past fair value. The horses won more often (the signal was real), and I
          got better prices than the close (my timing was real), but by the time the gates opened, the price after
          takeout was already too short to profit from. The edge and the takeout were roughly the same size, and
          &ldquo;roughly the same&rdquo; means you lose slowly instead of quickly.
        </p>
        <div className="panel p-5 border-l-2 border-l-accent-steam">
          <h3 className="font-display font-semibold text-sm text-ink-0 mb-2">The fee wall, in one line</h3>
          <p className="text-ink-1 text-sm leading-relaxed max-w-none">
            A signal that picks winners 55% more often than the crowd, and beats the closing line by 40%, nets to
            −1.6% after the house takes its 15–21%. <strong className="text-ink-0">The edge was real. It just
            wasn&apos;t a big enough edge to clear the fees.</strong>
          </p>
        </div>
      </section>

      {/* Ch 4 — the variant hunt */}
      <section className="space-y-5">
        <SecHead n="04" label="Everything I tried to save it" />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          If the base signal is a hair short of the wall, maybe a sharper filter finds the subset of bets that clears
          it. I spent six weeks testing that hope from every angle. Each variant kept the steam idea and added a gate:
        </p>
        <ul className="space-y-2.5">
          {[
            ["Breed splits", "Separate steam models for harness, quarter-horse and jumps. Harness steam went 1-for-22 (−81%); the signal is a thoroughbred phenomenon and doesn't travel."],
            ["Value-survival gates", "Only fire when the model's EV is still positive at the crushed price (an EV floor, and a looser higher-volume 'continuation' version). Filtered out bets — didn't lift the ones that remained."],
            ["Longshot floors", "Drop short-priced favorites, where the crush leaves no payout, and keep only longer prices. The edge was concentrated there, but so was the variance; net, no clearance."],
            ["Closing-EV gate", "Shadow-reject any bet whose edge didn't survive to the close — the honest 'a real book only keeps close-surviving bets' test. It confirmed the diagnosis rather than beating it."],
            ["Model-free pure-steam scanner", "Follow the late money with no model at all, to isolate whether the model added anything on top of the raw market move. It didn't."],
          ].map(([t, d]) => (
            <li key={t} className="panel p-4 flex gap-3">
              <span className="text-accent-warn font-mono text-xs mt-1 shrink-0">◆</span>
              <div>
                <div className="font-semibold text-[15px] text-ink-0">{t}</div>
                <div className="text-sm text-ink-1 mt-0.5 leading-snug">{d}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="panel p-5 border-l-2 border-l-accent-warn">
          <p className="text-ink-1 text-sm leading-relaxed max-w-none">
            The lesson underneath all of it: <strong className="text-ink-0">a filter changes which bets you skip, not
            the price of the ones you make.</strong> If the average steam bet can&apos;t clear the takeout, no gate
            stacked on top can conjure margin that the pool never offered. You can only decline to play.
          </p>
        </div>
      </section>

      {/* Ch 5 — full scoreboard */}
      <section className="space-y-4">
        <SecHead n="05" label="The whole board" />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          Steam was the near-miss. Everything else was more decisive. Ranked by sample size; the bar shows each
          strategy&apos;s 95% ROI interval against the zero line — if it doesn&apos;t cross zero, the result is
          statistically settled.
        </p>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[660px] border-collapse">
            <thead>
              <tr className="text-left">
                {["Strategy & thesis", "Bets", "ROI", "95% CI vs. break-even", "Verdict"].map((h, i) => (
                  <th key={h} className={`text-[10px] font-mono uppercase tracking-wider text-ink-2 font-semibold px-4 pt-4 pb-3 border-b border-line ${i === 1 || i === 2 || i === 4 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MAIN.map((s) => (
                <tr key={s.name} className="border-b border-line/60 last:border-b-0 align-middle">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-[15px] text-ink-0 tracking-tight">{s.name}</div>
                    <div className="text-xs text-ink-2 mt-1 max-w-[34em] leading-snug">{s.thesis}</div>
                  </td>
                  <td className="px-4 py-4 text-right font-mono tabular-nums text-sm text-ink-1 whitespace-nowrap">
                    {s.n.toLocaleString()}
                    <div className="text-[11px] text-ink-2">{s.won} won</div>
                  </td>
                  <td className="px-4 py-4 text-right whitespace-nowrap">
                    <span className={`font-mono tabular-nums font-semibold text-[15px] ${roiColor(s.v)}`}>{roiTxt(s.roi)}</span>
                    {s.note && <div className="text-[11px] text-accent-warn mt-0.5">{s.note}</div>}
                  </td>
                  <td className="px-4 py-4 min-w-[190px]"><CiBar lo={s.lo} hi={s.hi} roi={s.roi} v={s.v} /></td>
                  <td className="px-4 py-4 text-right"><VerdictChip v={s.v} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between text-[10px] font-mono text-ink-2 px-1 max-w-[660px]">
          <span>−100%</span><span>break-even (0)</span><span>+100%</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-1 pt-1">
          <Legend color="#ff3b3b" label="Proven loss — CI below zero" />
          <Legend color="#5c6678" label="Break-even / inconclusive" />
          <Legend color="#f59e0b" label="Mirage — profit was estimated payouts" />
        </div>

        <details className="panel p-4 mt-2">
          <summary className="cursor-pointer text-sm text-ink-1 font-semibold select-none">
            Plus 10 variants too small to conclude (n &lt; 30) — record them, don&apos;t believe them
          </summary>
          <div className="overflow-x-auto mt-3">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="text-left">
                  {["Strategy", "Bets", "ROI", "95% CI"].map((h, i) => (
                    <th key={h} className={`text-[10px] font-mono uppercase tracking-wider text-ink-2 font-semibold px-3 pb-2 border-b border-line ${i === 1 || i === 2 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SMALL.map((s) => (
                  <tr key={s.name} className="border-b border-line/60 last:border-b-0">
                    <td className="px-3 py-2.5 text-sm text-ink-1">{s.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-sm text-ink-2">{s.n}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-sm text-ink-2">{roiTxt(s.roi)}</td>
                    <td className="px-3 py-2.5 min-w-[160px]"><CiBar lo={s.lo} hi={s.hi} roi={s.roi} v="even" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* Ch 6 — the mirage */}
      <section className="space-y-5">
        <SecHead n="06" label="The one that lied" />
        <p className="font-display text-xl sm:text-2xl text-ink-0 max-w-[36ch] text-balance leading-snug">
          One strategy showed a significant +51%. It was an accounting artifact.
        </p>
        <p className="text-ink-1 leading-relaxed text-[17px]">
          Daily Double Consensus pairs the model&apos;s top pick in two consecutive races into a single Daily Double.
          On the dashboard it looked like the only edge in the entire program — 1,101 bets, confidence interval safely
          above zero. But the data feed exposes no per-combo Daily Double price, so 55 of its 123 wins were paid at an{" "}
          <em>estimated</em> payout. Those estimates overpaid by roughly 2×, and that overpayment <em>was</em> the
          entire edge.
        </p>
        <div className="panel p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-6 sm:gap-9">
            <div>
              <p className="stat-label">On the dashboard</p>
              <div className="font-display font-semibold tabular-nums text-3xl sm:text-4xl text-accent-overlay mt-2">+51.3%</div>
              <p className="text-ink-2 text-xs mt-2 max-w-[15em]">1,101 bets · CI +7% to +96% · flagged &ldquo;significant&rdquo;</p>
            </div>
            <div className="text-ink-2 text-2xl self-center rotate-90 sm:rotate-0">→</div>
            <div>
              <p className="stat-label">On real tote payouts only</p>
              <div className="font-display font-semibold tabular-nums text-3xl sm:text-4xl text-accent-steam mt-2">−$517</div>
              <p className="text-ink-2 text-xs mt-2 max-w-[16em]">Strip the 55 estimated-payout wins (+$1,082 of fiction) and it loses like the rest.</p>
            </div>
          </div>
          <p className="text-ink-1 text-sm leading-relaxed mt-5 max-w-none">
            It never reached real money because the system quarantines estimated-payout wins in a separate column,
            precisely so a mirage can&apos;t be mistaken for an edge.{" "}
            <strong className="text-ink-0">The strategies failed; the measurement passed its hardest test.</strong>
          </p>
        </div>
      </section>

      {/* Ch 7 — lessons */}
      <section className="space-y-4">
        <SecHead n="07" label="What transfers to anyone" />
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            ["01", "A calibrated model is not an edge.", "The probabilities were honest — closing EV on the flagship sits at zero, not negative. But an accurate estimate you share with the market is worth nothing. The edge has to survive to the closing price, and mostly it didn't."],
            ["02", "The takeout is the opponent.", "Steam picked winners 55% more often than the field and still lost, because the 15–21% house cut is taller than almost any signal you can find in the open. Beat the crowd by a little and you still pay the wall."],
            ["03", "Filters can't create margin.", "Six variants tried to isolate the profitable subset of steam bets. A gate only decides which bets you skip; it can't change the price of the ones you make. If the average bet can't clear takeout, no filter conjures the difference."],
            ["04", "Edges rot — date every one.", "Steam was up $1,600 in August and underwater by September. Same code, same signal, opposite result eight weeks apart. An edge without a timestamp is a story you tell yourself."],
            ["05", "Grade exotics on real payouts or not at all.", "A +51%, significant, four-figure-sample 'winner' evaporated the instant estimated payouts were netted out. If you can't settle at the real combo price, you don't have a result — you have a hope with a chart."],
            ["06", "A clean null result is the deliverable.", "Most people testing betting systems never learn they don't work — they churn a bankroll mistaking variance for skill. Running the honest experiment and reporting 'the market won' is the rare and valuable outcome. That's this page."],
          ].map(([num, title, body]) => (
            <div key={num} className="panel p-5">
              <span className="font-mono text-xs font-bold text-accent-warn tracking-wider">{num}</span>
              <h3 className="font-display font-semibold text-lg text-ink-0 mt-2 mb-2 text-balance">{title}</h3>
              <p className="text-ink-1 text-sm leading-relaxed max-w-none">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Ch 8 — timeline */}
      <section className="space-y-4">
        <SecHead n="08" label="How it unfolded" />
        <ol className="relative border-l border-line ml-2 space-y-6 pt-1">
          {TIMELINE.map(([date, title, body]) => (
            <li key={date + title} className="pl-6 relative">
              <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent-warn border-2 border-bg-0" />
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-mono text-xs text-accent-warn tabular-nums">{date}</span>
                <span className="font-display font-semibold text-ink-0">{title}</span>
              </div>
              <p className="text-sm text-ink-1 mt-1 leading-relaxed max-w-[52ch]">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Kicker */}
      <section className="text-center py-6 space-y-3 border-t border-line pt-12">
        <p className="font-display text-2xl sm:text-3xl text-ink-0 max-w-[26ch] mx-auto text-balance leading-snug">
          &ldquo;I ran the honest experiment and the market won&rdquo; is a{" "}
          <span className="text-accent-warn font-semibold">very different sentence</span> from &ldquo;I fooled myself.&rdquo;
        </p>
        <p className="text-ink-2 text-sm max-w-[32ch] mx-auto">
          The difference is the entire point of building the measurement before the bankroll.
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-line pt-8 space-y-3 text-xs text-ink-2">
        <p className="font-mono uppercase tracking-[0.1em] text-ink-1 text-[11px]">Provenance &amp; caveats</p>
        <p className="max-w-[52em] leading-relaxed">
          Paper trades only; no real money was wagered. ROI is realized profit over settled stake, bucketed in the
          viewer&apos;s calendar timezone. Confidence intervals are 95% on per-bet ROI; &ldquo;significant&rdquo;
          requires n ≥ 30 and an interval that excludes zero. Exotic P&amp;L is trustworthy only where the tote
          payoff feed supplied a real per-combo price; estimated-payout wins are quarantined and excluded from every
          verdict here. The model-calibration weights for the <span className="font-mono">tvg-baseline</span> family
          were fitted on earlier data, so their in-sample ROI is partly curve-fit — out-of-sample bets tell the same
          story and point the same direction. All figures frozen as reported on 2026-09-18.
        </p>
        <p className="font-mono text-[11px]">
          ToteFlow · window 2026-06-30 to 2026-09-18 · 16,071 settled paper bets · −$52,124 net · −18.0% blended ROI
        </p>
      </footer>
    </div>
  );
}

function SecHead({ n, label }: { n: string; label: string }) {
  return (
    <h2 className="text-[11px] font-mono uppercase tracking-[0.14em] text-ink-2 font-semibold">
      <span className="text-accent-warn mr-2.5">{n}</span>{label}
    </h2>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block w-5 h-2 rounded" style={{ background: color }} />
      {label}
    </span>
  );
}

function Stat({ v, l, s, c }: { v: string; l: string; s: string; c: string }) {
  return (
    <div className="panel p-4">
      <div className={`font-display font-semibold tabular-nums text-2xl sm:text-3xl ${c}`}>{v}</div>
      <p className="text-ink-0 text-xs font-semibold mt-1.5">{l}</p>
      <p className="text-ink-2 text-[11px] mt-1 leading-snug">{s}</p>
    </div>
  );
}
