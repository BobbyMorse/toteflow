import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How It Works — ToteFlow",
  description: "How the tvg-baseline strategy turns TVG's public model into a bet.",
};

export default function HowItWorksPage() {
  return (
    <div className="py-6 sm:py-8 space-y-8 max-w-4xl">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold">How ToteFlow Works</h1>
        <p className="text-ink-2">
          A plain-English walkthrough of the tvg-baseline strategy —
          what feeds it, what filters it applies, and why it fires almost exclusively on longshots.
        </p>
      </header>

      <Section title="The one-liner">
        <p>
          When TVG&apos;s public win-probability model is confident and the market is only
          halfway convinced, take the horse they&apos;re both leaning toward &mdash;
          but only trust the model 30%, because it consistently over-hypes bombs.
        </p>
      </Section>

      <Section title="What is TVG's model, and why do we get it for free?">
        <p>
          TVG is an advance-deposit wagering platform for US horse racing, owned by
          FanDuel Group. Like every major operator, they run a proprietary
          machine-learning model that outputs a <strong>win probability</strong>
          for every horse in every race they list &mdash; a number between 0 and 1
          that represents the model&apos;s estimate of how often that horse would
          win if the race were run a thousand times.
        </p>
        <p>
          We don&apos;t know exactly what feeds their model &mdash; that&apos;s the
          secret sauce &mdash; but based on the industry standard it&apos;s almost
          certainly trained on decades of past-performance data (speed figures,
          class, jockey and trainer records, surface and distance suitability,
          workouts, pace projections, etc.). The same inputs professional
          handicappers have used for a hundred years, run through modern ML
          pipelines on datasets most solo bettors can&apos;t afford to license.
        </p>
        <p>
          The model output is <strong>public</strong> &mdash; anyone can query TVG&apos;s
          GraphQL endpoint with no authentication and get the exact same numbers that
          power their own website. That surprises most people. Why would they give
          away what looks like sharp signal?
        </p>
        <div className="panel p-4 space-y-2 text-sm">
          <div className="font-mono text-xs text-ink-2 uppercase tracking-wider">The reason: pari-mutuel economics</div>
          <p>
            TVG is not the counterparty on your bet. In a pari-mutuel pool, players bet
            against <em>each other</em> &mdash; the platform just takes a cut of the total
            pool (the &ldquo;takeout,&rdquo; usually 15&ndash;20%). TVG&apos;s revenue is
            <strong> takeout &times; handle</strong>. That means:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-ink-1">
            <li>Sharps using the model &rarr; still get taxed on every ticket.</li>
            <li>Squares using the model &rarr; still get taxed on every ticket.</li>
            <li>Either way, more handle through TVG = more revenue for TVG.</li>
          </ul>
          <p>
            Giving away a decent model is <em>marketing</em>. It draws bettors to their
            platform without denting their margin. A sportsbook giving away its model
            would go bankrupt because the sportsbook is the counterparty &mdash; every
            sharp bet is money out of their pocket. TVG has no such conflict.
          </p>
        </div>
        <p>
          <strong>How good is the model?</strong> On liquid US thoroughbred markets
          (Santa Anita, Saratoga, Gulfstream, Belmont, Churchill) it&apos;s genuinely
          sharp &mdash; sharp enough that the pool drifts toward its view before post
          (that&apos;s where our +20% CLV comes from). On thin-data cards (international,
          harness, small tracks) it collapses to nearly-uniform &ldquo;I don&apos;t
          know&rdquo; output. Our quality gate exists to detect and skip those cases.
        </p>
        <p className="text-ink-2 text-sm">
          The model is proprietary to TVG. We consume its output &mdash; we didn&apos;t
          build it and couldn&apos;t replicate it without a Bloomberg-terminal-sized data
          budget. Everything ToteFlow does is a calibration and filtering layer wrapped
          around that free public signal.
        </p>
      </Section>

      <Section title="The data we start with">
        <p>
          Every ~10 seconds we hit TVG&apos;s public GraphQL endpoint. For every race
          currently on their board, we get:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-ink-1">
          <li>Every runner, their current tote odds, morning-line odds, and scratch status.</li>
          <li>Pool sizes (Win, Place, Show, Exacta, Trifecta, Pick-Ns).</li>
          <li>A <Mono>winProbability</Mono> per runner &mdash; TVG&apos;s own ML model output. This is their proprietary number, given away free to power their site.</li>
          <li>Minimum wager amounts by wager type.</li>
        </ul>
        <p>
          The <Mono>winProbability</Mono> is the input everything downstream is built on.
          Everything else is our own logic sitting on top of it.
        </p>
      </Section>

      <Section title="Stage 1 — The proprietary model-quality gate">
        <p>
          TVG&apos;s model will happily emit numbers on every race, including cards where it
          has thin data and no real opinion. We built our own quality check to catch this.
        </p>
        <p>
          For each race we compute one number: <strong>the highest model probability divided by the lowest</strong> (across live, non-scratched runners with odds under 60/1).
        </p>
        <div className="panel p-4 space-y-3 text-sm">
          <div className="font-mono text-xs text-ink-2 uppercase tracking-wider">Example — healthy race</div>
          <pre className="font-mono text-xs text-ink-0 whitespace-pre">{`Horse 1: 35%   <- highest
Horse 2: 20%
Horse 3: 15%
Horse 4: 10%
Horse 5:  8%
Horse 6:  6%
Horse 7:  4%
Horse 8:  2%   <- lowest

spread = 35 / 2 = 17.5x  ->  HIGH quality`}</pre>
          <div className="font-mono text-xs text-ink-2 uppercase tracking-wider">Example — flat / shrug</div>
          <pre className="font-mono text-xs text-ink-0 whitespace-pre">{`Horse 1: 15%
Horse 2: 14%
Horse 3: 13%
Horse 4: 12%
Horse 5: 12%
Horse 6: 12%
Horse 7: 11%
Horse 8: 11%

spread = 15 / 11 = 1.36x  ->  LOW quality (skip)`}</pre>
        </div>
        <p>Tiering:</p>
        <ul className="list-disc pl-5 space-y-1 text-ink-1">
          <li><strong>&ge; 4&times;</strong> &rarr; <Mono>high</Mono>. Model has a real opinion. Strategy is allowed to bet.</li>
          <li><strong>2.5&times; to 4&times;</strong> &rarr; <Mono>medium</Mono>. Model is noisy. Skip.</li>
          <li><strong>&lt; 2.5&times;</strong> &rarr; <Mono>low</Mono>. Model is shrugging. Skip.</li>
        </ul>
        <p className="text-ink-2 text-sm">
          The tiers, thresholds, and this filter are ToteFlow-invented &mdash; TVG doesn&apos;t
          tell us how good their own output is on any given race. Portable IP: swap
          TVG for any other probability source and the same guardrail still works.
        </p>
      </Section>

      <Section title="Stage 2 — The 30/70 skepticism dial">
        <p>
          For each horse that passes the quality gate, we compute a{" "}
          <strong>calibrated win probability</strong> as a weighted average of two views:
        </p>
        <div className="panel p-4 font-mono text-sm">
          calibratedP = <span className="text-accent-cyan">0.30</span> &times; TVG&apos;s modelP + <span className="text-accent-cyan">0.70</span> &times; marketP
        </div>
        <p>
          Where <Mono>marketP = 1 / currentOdds</Mono>. This is the pool&apos;s implied
          view: what the crowd&apos;s money says about the horse&apos;s chances.
        </p>
        <p>
          <strong>Why the model gets only 30%.</strong> An earlier audit showed the strategy at
          &minus;21% ROI when TVG&apos;s model got its default 65% weight. The model is sharp
          but it systematically over-rates longshots, and the tote also has favorite-longshot
          bias in the same direction &mdash; so at 65% weight we were doubling up on the
          same overrated bombs. Pulling model weight down to 30% forces the crowd&apos;s
          more conservative view to dominate. Only horses where the model is{" "}
          <em>dramatically</em> more optimistic than the market can move the calibrated
          probability enough to matter.
        </p>
      </Section>

      <Section title="Stage 3 — The positive-EV filter">
        <p>
          Now we ask one question per horse in the race:
        </p>
        <div className="panel p-4">
          <p className="text-ink-0 italic">
            &ldquo;If we bet $20 on this horse a thousand times at today&apos;s price,
            would we make money on average?&rdquo;
          </p>
        </div>
        <p>
          The arithmetic per $1 staked, after the track&apos;s takeout (typically 15&ndash;20%):
        </p>
        <div className="panel p-4 font-mono text-sm">
          EV = calibratedP &times; (odds &minus; 1) &times; (1 &minus; takeout) &minus; (1 &minus; calibratedP)
        </div>
        <p>Two worked examples on a real race:</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="panel p-4 space-y-2 text-sm">
            <div className="font-mono text-xs text-ink-2 uppercase tracking-wider">The 2/1 favorite</div>
            <ul className="space-y-1">
              <li>Payout: $3 back per $1</li>
              <li>Market: 33.3% chance</li>
              <li>TVG model: 38%</li>
              <li>Calibrated: 30% &times; 38% + 70% &times; 33.3% = <strong>34.5%</strong></li>
              <li className="pt-1 font-mono">EV = 0.345 &times; 2 &times; 0.84 &minus; 0.655 = <span className="text-accent-warn">&minus;$0.08</span></li>
            </ul>
            <p className="text-ink-2 text-xs">Negative &rarr; <strong>skip</strong>. The tote already pays the favorite roughly what it&apos;s worth; takeout eats the middle.</p>
          </div>

          <div className="panel p-4 space-y-2 text-sm">
            <div className="font-mono text-xs text-ink-2 uppercase tracking-wider">The 20/1 shot</div>
            <ul className="space-y-1">
              <li>Payout: $21 back per $1</li>
              <li>Market: 4.8% chance</li>
              <li>TVG model: 12% (confident)</li>
              <li>Calibrated: 30% &times; 12% + 70% &times; 4.8% = <strong>6.9%</strong></li>
              <li className="pt-1 font-mono">EV = 0.069 &times; 20 &times; 0.84 &minus; 0.931 = <span className="text-accent-overlay">+$0.23</span></li>
            </ul>
            <p className="text-ink-2 text-xs">Positive &rarr; <strong>candidate</strong>. Even at 6.9% (loses 93% of the time), the payout multiplier compensates for the losing streak.</p>
          </div>
        </div>

        <p>
          If <em>no</em> horse in the race clears zero EV after calibration and takeout,
          we don&apos;t bet. If one or more do, we fire on the horse with the largest EV.
        </p>
      </Section>

      <Section title="Why the strategy structurally lives on longshots">
        <p>
          The 30/70 blend anchors our calibrated probability close to the tote&apos;s
          implied probability. For EV to clear zero, TVG&apos;s model needs to disagree
          with the market by <em>roughly 2&times;</em> at every price point. Same ratio
          across the board &mdash; but wildly different absolute gaps:
        </p>

        <div className="panel overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead className="text-ink-2 uppercase tracking-wider text-xs">
              <tr className="border-b border-line">
                <th className="text-left p-3">Odds</th>
                <th className="text-right p-3">Market %</th>
                <th className="text-right p-3">Model must say &ge;</th>
                <th className="text-right p-3">Absolute gap</th>
              </tr>
            </thead>
            <tbody className="text-ink-0">
              <tr className="border-b border-line/40"><td className="p-3">2/1 favorite</td><td className="p-3 text-right">33.3%</td><td className="p-3 text-right">58.0%</td><td className="p-3 text-right text-accent-warn">+24.7 pts</td></tr>
              <tr className="border-b border-line/40"><td className="p-3">5/1</td><td className="p-3 text-right">16.7%</td><td className="p-3 text-right">30.9%</td><td className="p-3 text-right text-accent-warn">+14.2 pts</td></tr>
              <tr className="border-b border-line/40"><td className="p-3">10/1</td><td className="p-3 text-right">9.1%</td><td className="p-3 text-right">17.8%</td><td className="p-3 text-right">+8.7 pts</td></tr>
              <tr className="border-b border-line/40"><td className="p-3">20/1</td><td className="p-3 text-right">4.8%</td><td className="p-3 text-right">8.6%</td><td className="p-3 text-right text-accent-overlay">+3.8 pts</td></tr>
              <tr className="border-b border-line/40"><td className="p-3">40/1</td><td className="p-3 text-right">2.4%</td><td className="p-3 text-right">4.2%</td><td className="p-3 text-right text-accent-overlay">+1.8 pts</td></tr>
              <tr><td className="p-3">60/1</td><td className="p-3 text-right">1.6%</td><td className="p-3 text-right">2.8%</td><td className="p-3 text-right text-accent-overlay">+1.2 pts</td></tr>
            </tbody>
          </table>
        </div>

        <p>
          On a 2/1 favorite the model has to say <strong>58%</strong> to overcome
          takeout &mdash; a 25-point jump above market. TVG&apos;s model never says that;
          probability mass at the top of the field has ceilings. On a 20/1 shot the
          model just needs to say <strong>8.6%</strong> instead of the market&apos;s 4.8%
          &mdash; a routine call when the model has real conviction on a bomb.
        </p>
        <p className="text-ink-2 text-sm">
          So the strategy is a longshot-machine not because we&apos;re hunting longshots &mdash;
          it&apos;s because the algebra of a 30/70 blend plus pari-mutuel takeout
          only leaves room for positive EV at long prices.
        </p>
      </Section>

      <Section title="The other gates before we fire">
        <ul className="list-disc pl-5 space-y-1 text-ink-1">
          <li><strong>Thoroughbred only.</strong> Harness and quarter-horse have different dynamics and TVG&apos;s model isn&apos;t calibrated for them in our sample.</li>
          <li><strong>&ge; 90 seconds to post.</strong> Avoids the chaos phase where odds swing wildly right before the gate closes.</li>
          <li><strong>&ge; 3 live runners</strong> (unscratched, odds &lt; 60/1). Fields smaller than that don&apos;t give the spread check anything meaningful to measure.</li>
        </ul>
      </Section>

      <Section title="Track record so far">
        <p>
          Paper trades only. At the time of this writing the strategy has around 180
          settled bets, an ~8% hit rate, and a ROI that lives almost entirely in the
          20/1+ price buckets:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-ink-1">
          <li>Sub-20/1 buckets are <span className="text-accent-warn">net negative</span> &mdash; those are dead-weight tickets the current EV threshold hasn&apos;t filtered out.</li>
          <li>The 20&ndash;40/1 bucket runs <span className="text-accent-overlay">+70%+ ROI</span>.</li>
          <li>The 40+/1 bucket runs <span className="text-accent-overlay">+150%+ ROI</span> but is dominated by 1&ndash;2 lucky hits.</li>
          <li>Closing-line value is <span className="text-accent-overlay">consistently +20%</span> &mdash; the market drifts our way before post, which is the real evidence there&apos;s signal here beyond variance.</li>
        </ul>
        <p className="text-ink-2 text-sm">
          At this sample size the confidence interval on ROI is still wide. The CLV
          consistency is what makes us willing to keep the strategy live; the realized P&amp;L
          is a lagging, high-variance readout of the same underlying signal.
        </p>
      </Section>

      <Section title="What&apos;s ours vs what&apos;s TVG&apos;s">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="panel p-4 space-y-2 text-sm">
            <div className="font-mono text-xs text-ink-2 uppercase tracking-wider">TVG contributes</div>
            <ul className="list-disc pl-5 space-y-1 text-ink-1">
              <li>Raw <Mono>winProbability</Mono> per runner</li>
              <li>Live tote odds &amp; pool sizes</li>
              <li>Wager minimums, race metadata</li>
            </ul>
          </div>
          <div className="panel p-4 space-y-2 text-sm">
            <div className="font-mono text-xs text-ink-2 uppercase tracking-wider">ToteFlow contributes</div>
            <ul className="list-disc pl-5 space-y-1 text-ink-1">
              <li>Model-quality tiering (sum-check + spread ratio)</li>
              <li>The 30/70 skepticism dial (calibrated against realized P&amp;L)</li>
              <li>Per-track takeout table, EV computation, positive-EV filter</li>
              <li>Thoroughbred / minutes-to-post / field-size gates</li>
              <li>Ticket persistence, results grading, CLV tracking</li>
              <li>All the other strategies (overlay-vs-ml, dr-z-place, bridge-jumper, etc.)</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Honest caveats">
        <ul className="list-disc pl-5 space-y-1 text-ink-1">
          <li>Everything is paper. No real money placed by ToteFlow itself.</li>
          <li>The strategy&apos;s edge, if real, has a capacity ceiling &mdash; big money into a small pari-mutuel pool moves the odds against itself.</li>
          <li>TVG could add auth or rate limits to their GraphQL at any time. The quality-tier + calibration layer is portable to a different upstream probability source, but we&apos;d have to build one.</li>
          <li>At an 8% hit rate the ROI number is dominated by variance in the short run. CLV is the leading indicator; realized P&amp;L is the verdict, and the verdict takes hundreds more bets to become statistically meaningful.</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg sm:text-xl font-display font-semibold border-b border-line pb-2">{title}</h2>
      <div className="space-y-3 text-ink-1 leading-relaxed">{children}</div>
    </section>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-accent-cyan text-[0.9em]">{children}</code>;
}
