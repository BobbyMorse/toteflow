import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Post-Mortem: Testing 20+ Horse-Racing Betting Strategies — ToteFlow",
  description:
    "16,071 paper bets across more than twenty horse-racing betting strategies, graded on real pari-mutuel payouts. None produced positive expected value. The full writeup.",
};

// ---------------------------------------------------------------------------
// Point-in-time post-mortem. All figures as reported by /api/stats on
// 2026-09-18, graded on REAL tote payouts (estimated-payout exotic wins netted
// out). This is a dated report, not a live dashboard — numbers are frozen.
// ---------------------------------------------------------------------------

type Verdict = "loss" | "even";

interface Row {
  name: string;
  thesis: string;
  n: number;
  won: number;
  roi: number;
  lo: number | null;
  hi: number | null;
  v: Verdict;
}

// Placeable strategies only, ranked by sample size. Daily Double Consensus is
// deliberately excluded — it is not a real result (see the false-positive
// section) and does not belong in a table of things you could actually bet.
const MAIN: Row[] = [
  { name: "TVG Win Overlay (baseline)", thesis: "The core strategy. Bet a horse to WIN when TVG's model win probability is meaningfully higher than the probability implied by its current odds — i.e. positive expected value — on races the model rates high-confidence.", n: 5446, won: 661, roi: -12.5, lo: -23, hi: -3, v: "loss" },
  { name: "TVG Win Overlay — Harness", thesis: "The same win-overlay logic applied to standardbred / harness racing, at a reduced trust weight.", n: 5374, won: 662, roi: -26.7, lo: -36, hi: -17, v: "loss" },
  { name: "TVG Late Field Scan", thesis: "Measure-only control: flag any runner in the field getting crushed by late money, using no model input, to test whether the model adds anything over the raw market move.", n: 1061, won: 85, roi: -13.2, lo: -42, hi: 15, v: "even" },
  { name: "TVG Steam Confirm", thesis: "Bet a horse to WIN only when the model likes it AND late money is crushing its price (15–35% odds shortening) — the model and the market agreeing. The strongest candidate.", n: 1050, won: 197, roi: -1.6, lo: -20, hi: 16, v: "even" },
  { name: "Heavy-Favorite Fade", thesis: "Bet the 2nd choice when the favorite is odds-on (shorter than even money) in fields of 8 or more. Premise: the public overbets short favorites.", n: 589, won: 88, roi: -23.7, lo: -40, hi: -7, v: "loss" },
  { name: "Carryover Pick-N", thesis: "Play multi-race Pick-N tickets into inflated carryover pools, where undistributed money from prior days sweetens the payout. (Exotic; graded on real payouts where the feed supplied them, estimated wins netted out.)", n: 485, won: 5, roi: -36.0, lo: -100, hi: 2, v: "even" },
  { name: "Heavy-Favorite Fade — Harness", thesis: "Favorite-fade applied to harness racing.", n: 477, won: 66, roi: -17.6, lo: -40, hi: 5, v: "even" },
  { name: "Same-Day Track Bias — Harness", thesis: "Detect an inside/outside post-position bias from earlier races on the same track and surface, then bet horses whose post matches the bias.", n: 173, won: 26, roi: -19.2, lo: -55, hi: 17, v: "even" },
  { name: "Trifecta Top-3 Box", thesis: "Box the model's top 3 contenders when they clearly outrun the field — any in-the-money order pays.", n: 136, won: 6, roi: -60.9, lo: -97, hi: -25, v: "loss" },
  { name: "Dr. Z Place", thesis: "Ziemba–Hausch place-pool mispricing: bet a horse to PLACE when its win-pool probability materially exceeds its place-pool probability.", n: 64, won: 28, roi: -32.5, lo: -52, hi: -13, v: "loss" },
];

const SMALL: Row[] = [
  { name: "TVG Win Overlay — Quarter Horse", thesis: "", n: 29, won: 3, roi: -60.9, lo: -105, hi: -17, v: "even" },
  { name: "Exacta Overlay Pair", thesis: "", n: 26, won: 3, roi: -54.2, lo: -107, hi: -2, v: "even" },
  { name: "TVG Steam Confirm — Harness", thesis: "", n: 22, won: 1, roi: -81.2, lo: -117, hi: -45, v: "even" },
  { name: "TVG Win Overlay — Jumps", thesis: "", n: 14, won: 1, roi: -25.0, lo: -167, hi: 117, v: "even" },
  { name: "Dr. Z Place — Jumps", thesis: "", n: 8, won: 3, roi: -45.0, lo: -96, hi: 6, v: "even" },
  { name: "TVG Late Steam Scan", thesis: "", n: 5, won: 1, roi: -47.0, lo: -140, hi: 46, v: "even" },
  { name: "Same-Day Track Bias — QH", thesis: "", n: 5, won: 0, roi: -100, lo: -100, hi: -100, v: "even" },
  { name: "Same-Day Track Bias — Jumps", thesis: "", n: 2, won: 0, roi: -100, lo: -100, hi: -100, v: "even" },
  { name: "Heavy-Favorite Fade — QH", thesis: "", n: 2, won: 1, roi: 115, lo: -183, hi: 413, v: "even" },
  { name: "TVG Steam — Closing Gate", thesis: "", n: 1, won: 0, roi: -100, lo: null, hi: null, v: "even" },
];

// tvg-steam cumulative paper P&L, daily. [MM-DD, cumulative $].
const STEAM: [string, number][] = [
  ["07-17", -5], ["07-18", 313], ["07-19", -7], ["07-20", 443], ["07-21", 259], ["07-22", 101], ["07-23", 1], ["07-24", -57], ["07-25", 229], ["07-26", 349], ["07-27", 325], ["07-28", 799], ["07-29", 1006], ["07-30", 1074], ["07-31", 1225],
  ["08-01", 1068], ["08-02", 1326], ["08-03", 1612], ["08-04", 1494], ["08-05", 1423], ["08-06", 1596], ["08-07", 1418], ["08-08", 1292], ["08-09", 1168], ["08-10", 1060], ["08-11", 1318], ["08-12", 1632], ["08-13", 1428], ["08-14", 1189], ["08-15", 961], ["08-16", 1343], ["08-17", 1123], ["08-18", 1028], ["08-19", 1153], ["08-20", 970], ["08-21", 1455], ["08-22", 1215], ["08-23", 1015], ["08-24", 826], ["08-25", 807], ["08-26", 587], ["08-27", 565], ["08-28", 963], ["08-29", 817], ["08-30", 597], ["08-31", 839],
  ["09-01", 881], ["09-02", 573], ["09-03", 1235], ["09-04", 989], ["09-05", 709], ["09-06", 763], ["09-07", 989], ["09-08", 857], ["09-09", 643], ["09-10", 403], ["09-11", 273], ["09-12", 150], ["09-13", 136], ["09-14", 179], ["09-15", -1], ["09-16", -90], ["09-17", -244], ["09-18", -342],
];

const TIMELINE: [string, string, string][] = [
  ["Jun 30", "First bet", "The TVG win-overlay baseline goes live: bet WIN wherever the model's win probability beats the market price."],
  ["Jul 11", "Breed variants", "Harness, quarter-horse and jumps splits added at a low trust weight, to test whether the model carries across disciplines. It does not — harness is the worst-performing segment in the program."],
  ["Jul 13", "Real-payout grading", "Exotic bets begin settling at genuine per-combination tote payouts where the feed supplies them; estimated payouts are quarantined. This is the dividing line between verified and unverified P&L."],
  ["Jul 17", "Steam goes live", "TVG Steam Confirm starts firing: only bet the model's pick when late money is also crushing its price. Within two weeks it is up more than $1,200 on paper."],
  ["Aug 12", "Peak", "Steam reaches +$1,632 on paper. Hit rate and price momentum both look strong. It appears to be a working strategy."],
  ["Aug – Sep", "Variant testing", "Six variations attempt to isolate the profitable subset of steam bets: value-survival gates, longshot floors, a closing-EV gate, an overbet guard, and a model-free scanner. None clears the takeout."],
  ["Sep 15", "Back to zero", "Steam's cumulative paper P&L crosses back below break-even; the two-month lead is gone."],
  ["Sep 18", "Result", "16,071 bets in, no strategy has positive tote-verified P&L. Reporting closes here."],
];

// --- CI-vs-zero bar --------------------------------------------------------
const AX = 120;
const posPct = (v: number) => ((v + AX) / (2 * AX)) * 100;
const clamp = (p: number) => Math.max(0, Math.min(100, p));
const V_COLOR: Record<Verdict, string> = { loss: "#ff3b3b", even: "#5c6678" };

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
  return <span className="chip bg-bg-3 text-ink-2 border border-line">Inconclusive</span>;
}

const roiTxt = (r: number) => `${r > 0 ? "+" : ""}${r.toFixed(1)}%`;
const roiColor = (v: Verdict) => (v === "loss" ? "text-accent-steam" : "text-ink-1");

// --- Steam cumulative-P&L chart (server-rendered SVG) ----------------------
function SteamChart() {
  const W = 760, H = 240, padL = 6, padR = 6, padT = 26, padB = 24;
  const vals = STEAM.map((d) => d[1]);
  // Ceiling well above the $1,632 peak so its two-line label has clear
  // headroom inside the SVG and doesn't collide with the panel header.
  const ymin = -450, ymax = 2200;
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
        <p className="stat-label">TVG Steam Confirm · cumulative paper P&amp;L</p>
        <p className="text-xs text-ink-2 font-mono">Jul 17 → Sep 18 · 1,050 bets</p>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[540px]" role="img" aria-label="Cumulative profit and loss for the steam strategy: a two-month climb to a peak of $1,632 on August 12, followed by a decline to negative $342 by September 18.">
          <defs>
            <linearGradient id="steamfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="#5c6678" strokeWidth="1" strokeDasharray="3 3" />
          <text x={padL + 2} y={y(0) - 5} fill="#5c6678" fontSize="10" fontFamily="ui-monospace, monospace">break-even</text>
          <line x1={padL} y1={y(1000)} x2={W - padR} y2={y(1000)} stroke="#1f2837" strokeWidth="1" />
          <text x={padL + 2} y={y(1000) - 4} fill="#3a4759" fontSize="9.5" fontFamily="ui-monospace, monospace">+$1,000</text>
          <path d={area} fill="url(#steamfill)" />
          <path d={line} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(peakI)} cy={y(vals[peakI])} r="3.5" fill="#f59e0b" />
          <text x={x(peakI)} y={y(vals[peakI]) - 9} fill="#e7edf7" fontSize="11" fontWeight="600" textAnchor="middle" fontFamily="ui-monospace, monospace">+$1,632</text>
          <text x={x(peakI)} y={y(vals[peakI]) - 23} fill="#5c6678" fontSize="9.5" textAnchor="middle" fontFamily="ui-monospace, monospace">Aug 12 peak</text>
          {zeroCrossI > -1 && <circle cx={x(zeroCrossI)} cy={y(0)} r="3" fill="#ff3b3b" />}
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
    <div className="py-6 sm:py-10 max-w-3xl mx-auto space-y-14">

      {/* Masthead */}
      <header className="space-y-5 border-b border-line pb-10">
        <p className="flex items-center gap-2.5 text-[11px] font-mono uppercase tracking-[0.18em] text-accent-warn">
          <span className="inline-block w-6 h-px bg-accent-warn" />
          Field Research · Post-Mortem
        </p>
        <h1 className="font-display font-semibold tracking-tight text-4xl sm:text-5xl leading-[1.05] text-balance">
          Testing 20+ horse-racing betting strategies
        </h1>
        <p className="text-lg sm:text-xl text-ink-1 max-w-[48ch] leading-relaxed">
          A post-mortem on <strong className="text-ink-0">16,071 paper bets</strong>, graded on real pari-mutuel
          payouts. None of the strategies produced positive expected value. The strongest candidate — steam-following —
          reflects a genuine predictive signal that was still too small to overcome the track&apos;s takeout. What follows
          is what was tested, what happened, and why.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-2 font-mono pt-1">
          <span><span className="text-ink-1">WINDOW</span> 2026-06-30 → 2026-09-18</span>
          <span><span className="text-ink-1">STRATEGIES</span> 20+</span>
          <span><span className="text-ink-1">MONEY</span> paper only</span>
        </div>
      </header>

      {/* 01 — What this is */}
      <section className="space-y-5">
        <SecHead n="01" label="What this is" />
        <div className="space-y-4 text-ink-1 leading-relaxed text-[17px]">
          <p>
            ToteFlow is a research harness that paper-trades horse-racing betting strategies and grades them on real
            results. This page is the writeup of everything it has tested to date.
          </p>
          <p>
            <strong className="text-ink-0">The data source.</strong> Most strategies are built on TVG, a US
            horse-racing wagering platform. For many races, TVG publishes a <em>model win probability</em> for each
            runner — an estimate of how likely that horse is to win. That probability is the core signal.
          </p>
          <p>
            <strong className="text-ink-0">How the betting works.</strong> US racing is <em>pari-mutuel</em>: you bet
            into a shared pool against other bettors, not against a bookmaker. The track removes a fixed cut of every
            pool — the <em>takeout</em>, roughly 15% on win bets and up to 21% on exotics — and divides the rest among
            the winners. The final odds, and your payout, are set by the pool at post time, so{" "}
            <strong className="text-ink-0">you are paid at the closing price regardless of when you placed the bet.</strong>{" "}
            That detail matters throughout.
          </p>
          <p>
            <strong className="text-ink-0">The basic strategy.</strong> Convert a horse&apos;s current odds into the
            probability the market implies, and compare it to TVG&apos;s model probability. When the model says a horse
            is meaningfully more likely to win than its price implies, the bet has positive expected value. The baseline
            strategy bets those horses to win, on races the model rates high-confidence. Every other strategy is a
            variation on this idea: a different bet type (place, exacta, trifecta, daily double), a different or
            additional signal (late-money &ldquo;steam,&rdquo; fading heavy favorites, same-day track bias), or the same
            model applied to other breeds (harness, quarter-horse, jumps).
          </p>
          <p>
            <strong className="text-ink-0">How it&apos;s graded.</strong> Every bet is paper — no real money is
            wagered. Each is placed at a flat stake the moment its signal fires and settled at the real tote payout when
            results post. Performance is reported as ROI over settled stake, with a 95% confidence interval. A result is
            called statistically significant only when it has at least 30 settled bets and a confidence interval that
            excludes zero.
          </p>
        </div>
      </section>

      {/* 02 — Headline result */}
      <section className="space-y-5">
        <SecHead n="02" label="Headline result" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { l: "Bets placed", v: "16,071", s: "across 20+ strategies", c: "text-ink-0" },
            { l: "Total staked", v: "$288,930", s: "12.2% hit rate", c: "text-ink-0" },
            { l: "Net result", v: "−$52,124", s: "−18.0% blended ROI", c: "text-accent-steam" },
            { l: "Profitable strategies", v: "0", s: "on real payouts", c: "text-accent-steam" },
          ].map((k) => (
            <div key={k.l} className="panel p-4 sm:p-5">
              <p className="stat-label">{k.l}</p>
              <div className={`font-display font-semibold tabular-nums text-2xl sm:text-3xl mt-2 ${k.c}`}>{k.v}</div>
              <p className="text-ink-2 text-xs mt-2">{k.s}</p>
            </div>
          ))}
        </div>
        <p className="text-ink-1 leading-relaxed text-[17px]">
          No strategy finished with positive expected value on real payouts. The results split three ways: several are
          statistically significant losses; several more are indistinguishable from break-even; and one apparent winner
          turned out to be an accounting artifact. The most informative case is the near-miss — steam-following — because
          it shows what a real-but-insufficient edge looks like.
        </p>
      </section>

      {/* 03 — steam */}
      <section className="space-y-5">
        <SecHead n="03" label="The steam strategy: a real signal, short of the takeout" />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          &ldquo;Steam&rdquo; is money arriving late on a horse and shortening its price. The premise: when the model
          already rated a horse well <em>and</em> late money was also crushing its odds, that was two signals agreeing.
          The strategy fired only when a pick&apos;s odds were shortening 15–35% into post. It performed immediately —
          up more than $1,200 within two weeks, and past <strong className="text-ink-0">$1,600</strong> by mid-August.
        </p>
        <SteamChart />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          Two diagnostics suggested the signal was real rather than a lucky run:
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Stat v="18.8%" l="Steam hit rate" s="vs. 12.2% field-wide — steam picks won 55% more often" c="text-accent-overlay" />
          <Stat v="+40%" l="Price momentum (CLV)" s="odds kept shortening after the bet — see the caveat below" c="text-ink-0" />
          <Stat v="1,050" l="Settled bets" s="a substantial sample, not a few longshots" c="text-ink-0" />
        </div>
        <div className="panel p-5 border-l-2 border-l-accent-info">
          <h3 className="font-display font-semibold text-sm text-ink-0 mb-2">
            A caveat on that middle number: pari-mutuel CLV is not sports CLV
          </h3>
          <p className="text-ink-1 text-sm leading-relaxed max-w-none">
            In fixed-odds sports betting, beating the closing line is captured value — your bet stands at the price you
            locked in. Pari-mutuel does not work that way: <strong className="text-ink-0">you are paid at the final
            closing odds regardless of when you bet.</strong> So &ldquo;beating the close&rdquo; here does not secure a
            better price; it only means the odds kept moving in your direction after you fired — which, for a steam
            strategy, is nearly true by definition. It is reported as a <em>momentum</em> indicator (confirmation that
            the steam was genuine), not as value captured. The figure that actually determines the payout is closing EV,
            because the closing odds are the ones you are paid at.
          </p>
        </div>
        <p className="text-ink-1 leading-relaxed text-[17px]">
          Setting the momentum aside, the hit rate is the measure that is <em>not</em> an artifact of following steam,
          and it was genuinely above the field. The picks were better than average. So why did the strategy still lose?
        </p>
        <p className="text-ink-1 leading-relaxed text-[17px]">
          Because in pari-mutuel you are paid at the closing odds, and the late money being followed is precisely what
          shortens those odds. The signal that identified the horse also compressed the price it would pay. Re-priced at
          the closing odds, the model&apos;s edge was gone — expected value{" "}
          <strong className="text-accent-steam">−22%</strong>. The horses won more often than the field, but at prices
          the crowd had already bid down, and after the 15–21% takeout, the extra winners were not enough. Final result:{" "}
          <strong className="text-ink-0">−1.6% ROI over 1,050 bets</strong> (95% CI −20% to +16%) — the closest any
          strategy came to break-even, and still a loss.
        </p>
        <div className="panel p-5 border-l-2 border-l-accent-steam">
          <p className="text-ink-1 text-sm leading-relaxed max-w-none">
            <strong className="text-ink-0">The core finding.</strong> A signal that picked winners 55% more often than
            the crowd still netted −1.6% once the bet was paid at the crushed closing price and the house took its
            15–21%. The edge was real; it was not large enough to clear the takeout.
          </p>
        </div>
      </section>

      {/* 04 — variant hunt */}
      <section className="space-y-5">
        <SecHead n="04" label="Attempts to improve steam" />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          If the average steam bet falls just short of the takeout, a sharper filter might isolate the subset that
          clears it. Six variants tested that hypothesis. Each kept the steam idea and added a gate:
        </p>
        <ul className="space-y-2.5">
          {[
            ["Breed splits", "Separate steam handling for harness, quarter-horse and jumps. Harness steam went 1-for-22 (−81%); the effect is specific to thoroughbreds and does not carry to other breeds."],
            ["Value-survival gates", "Fire only when the model's expected value is still positive at the crushed price — an EV floor, plus a looser higher-volume version. These removed bets without improving the ones that remained."],
            ["Longshot floors", "Drop short-priced favorites, where the crush leaves little payout, and keep only longer prices where the edge was concentrated. The variance was concentrated there too; net, no clearance."],
            ["Closing-EV gate", "Reject any bet whose edge did not survive to the closing odds — the standard test that a real book only keeps close-surviving bets. It confirmed the diagnosis rather than beating it."],
            ["Model-free scanner", "Follow the late money with no model at all, to isolate whether the model added anything over the raw market move. It did not."],
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
        <p className="text-ink-1 leading-relaxed text-[17px]">
          None cleared the takeout. The underlying reason is structural: a filter changes which bets you skip, not the
          price of the bets you place. If the average qualifying bet cannot clear the takeout, no additional gate
          creates the missing margin — it can only decline to play.
        </p>
      </section>

      {/* 05 — full scoreboard */}
      <section className="space-y-4">
        <SecHead n="05" label="Full results" />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          Every placeable strategy with at least 30 settled bets, ranked by sample size. The bar shows each
          strategy&apos;s 95% ROI confidence interval against the zero line; if the interval does not cross zero, the
          result is statistically settled.
        </p>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[660px] border-collapse">
            <thead>
              <tr className="text-left">
                {["Strategy & description", "Bets", "ROI", "95% CI vs. break-even", "Verdict"].map((h, i) => (
                  <th key={h} className={`text-[10px] font-mono uppercase tracking-wider text-ink-2 font-semibold px-4 pt-4 pb-3 border-b border-line ${i === 1 || i === 2 || i === 4 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MAIN.map((s) => (
                <tr key={s.name} className="border-b border-line/60 last:border-b-0 align-middle">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-[15px] text-ink-0 tracking-tight">{s.name}</div>
                    <div className="text-xs text-ink-2 mt-1 max-w-[38em] leading-snug">{s.thesis}</div>
                  </td>
                  <td className="px-4 py-4 text-right font-mono tabular-nums text-sm text-ink-1 whitespace-nowrap">
                    {s.n.toLocaleString()}
                    <div className="text-[11px] text-ink-2">{s.won} won</div>
                  </td>
                  <td className="px-4 py-4 text-right whitespace-nowrap">
                    <span className={`font-mono tabular-nums font-semibold text-[15px] ${roiColor(s.v)}`}>{roiTxt(s.roi)}</span>
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
          <Legend color="#ff3b3b" label="Proven loss — confidence interval below zero" />
          <Legend color="#5c6678" label="Inconclusive — interval crosses zero" />
        </div>

        <details className="panel p-4 mt-2">
          <summary className="cursor-pointer text-sm text-ink-1 font-semibold select-none">
            Plus 10 variants with fewer than 30 settled bets — sample too small to draw a conclusion
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

      {/* 06 — false positive */}
      <section className="space-y-5">
        <SecHead n="06" label="An error, not a strategy: Daily Double Consensus" />
        <p className="text-ink-1 leading-relaxed text-[17px]">
          This one was a mistake in the harness, not a strategy. It showed a statistically significant{" "}
          <strong className="text-accent-overlay">+51% ROI</strong> over 1,101 bets — on the dashboard, the only
          apparent edge in the program — and it should never have been counted. Two independent problems make it
          invalid, and the first is disqualifying on its own.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="panel p-5">
            <p className="stat-label">Disqualifying — the bets can&apos;t be placed</p>
            <p className="text-ink-1 text-sm leading-relaxed mt-2 max-w-none">
              The strategy paired the model&apos;s top pick in two consecutive races into a Daily Double. But tracks
              only offer Daily Doubles on specific <em>designated</em> race pairs — typically the early daily double and
              a few rolling doubles — not on every consecutive pair. It generated tickets on pairs where no Daily Double
              wager exists, so most of them could never have been placed. That is a bug in the strategy, not an edge.
            </p>
          </div>
          <div className="panel p-5">
            <p className="stat-label">Reason 2 — estimated payouts</p>
            <p className="text-ink-1 text-sm leading-relaxed mt-2 max-w-none">
              The data feed exposes no per-combination Daily Double price, so 55 of the 123 &ldquo;wins&rdquo; were
              settled at an <em>estimated</em> payout rather than a real one. Those estimates overpaid by roughly 2×.
              Graded on real payouts alone, the strategy lost <strong className="text-accent-steam">$517</strong>.
            </p>
          </div>
        </div>
        <p className="text-ink-1 leading-relaxed text-[17px]">
          It is excluded from the results above and kept here as a cautionary example: a large sample and a significant
          confidence interval mean nothing if the bets could not be placed and the payouts are not real. The harness
          separately quarantines estimated-payout wins so a result like this cannot be mistaken for an edge.
        </p>
      </section>

      {/* 07 — what generalizes */}
      <section className="space-y-4">
        <SecHead n="07" label="What generalizes" />
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            ["01", "A calibrated probability is not an edge.", "TVG's model is well-calibrated — closing EV on the baseline is approximately zero, not negative. But a probability the market also knows is already reflected in the price. To profit, an estimate must beat the closing odds you are paid at, which these mostly did not."],
            ["02", "Takeout is the binding constraint.", "The house keeps 15–21% of every pool. A signal has to beat the market by more than that margin to profit. Steam beat the field on win rate and still lost, because the margin was smaller than the takeout."],
            ["03", "Filters cannot manufacture margin.", "Six variants added gates to isolate profitable steam bets. A filter only changes which bets you skip; it does not change the price of the bets you place. If the average qualifying bet cannot clear the takeout, no gate creates the difference."],
            ["04", "Performance figures need a date.", "Steam was +$1,632 in mid-August and negative by mid-September on identical logic. Any ROI or edge estimate should be reported with the window it was measured over."],
            ["05", "Grade exotics only on real payouts.", "Where the feed supplies no per-combination price, payouts are estimated and unreliable. Daily Double Consensus showed +51% entirely on estimated payouts and lost on real ones. Treat estimated-payout results as unverified."],
            ["06", "A negative result is a valid outcome.", "The purpose of the harness is to measure strategy performance before any money is committed. Establishing that these strategies do not beat the market, and identifying why, is the deliverable."],
          ].map(([num, title, body]) => (
            <div key={num} className="panel p-5">
              <span className="font-mono text-xs font-bold text-accent-warn tracking-wider">{num}</span>
              <h3 className="font-display font-semibold text-lg text-ink-0 mt-2 mb-2 text-balance">{title}</h3>
              <p className="text-ink-1 text-sm leading-relaxed max-w-none">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 08 — timeline */}
      <section className="space-y-4">
        <SecHead n="08" label="Timeline" />
        <ol className="relative border-l border-line ml-2 space-y-6 pt-1">
          {TIMELINE.map(([date, title, body]) => (
            <li key={date + title} className="pl-6 relative">
              <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent-warn border-2 border-bg-0" />
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-mono text-xs text-accent-warn tabular-nums">{date}</span>
                <span className="font-display font-semibold text-ink-0">{title}</span>
              </div>
              <p className="text-sm text-ink-1 mt-1 leading-relaxed max-w-[54ch]">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Bottom line */}
      <section className="border-t border-line pt-10 space-y-3">
        <SecHead n="—" label="Bottom line" />
        <p className="text-ink-1 leading-relaxed text-[17px] max-w-[54ch]">
          Across 16,071 paper bets and more than twenty strategies, none produced positive expected value on real
          pari-mutuel payouts. The strongest candidate, steam-following, reflects a genuine predictive signal that was
          still too small to overcome the takeout. The remainder were either significant losses or statistically
          indistinguishable from zero. No real money was committed, and the measurement served its purpose.
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-line pt-8 space-y-3 text-xs text-ink-2">
        <p className="font-mono uppercase tracking-[0.1em] text-ink-1 text-[11px]">Method &amp; caveats</p>
        <p className="max-w-[54em] leading-relaxed">
          Paper trades only; no real money was wagered. ROI is realized profit over settled stake, bucketed in the
          viewer&apos;s calendar timezone. Confidence intervals are 95% on per-bet ROI; a result is called significant
          only with at least 30 settled bets and an interval that excludes zero. Closing-line value (CLV) is reported as
          a momentum indicator only — in pari-mutuel, bets settle at the final closing odds regardless of when they are
          placed, so beating the close is not captured value as it would be in fixed-odds sports betting. Exotic P&amp;L
          is trusted only where the tote feed supplied a real per-combination price; estimated-payout wins are
          quarantined and excluded from every verdict here. The model-calibration weights for the win-overlay family
          were fitted on earlier data, so their in-sample ROI is partly curve-fit; out-of-sample bets point the same
          direction. All figures frozen as reported on 2026-09-18.
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
