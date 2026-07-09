import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How It Works — ToteFlow",
  description: "A high-level overview of the ToteFlow approach to pari-mutuel value hunting.",
};

export default function HowItWorksPage() {
  return (
    <div className="py-6 sm:py-8 space-y-8 max-w-4xl">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold">How ToteFlow Works</h1>
        <p className="text-ink-2">
          A high-level view of what ToteFlow does, why the edge exists, and how we
          evaluate it. Specifics of the strategy logic are intentionally omitted.
        </p>
      </header>

      <Section title="The one-liner">
        <p>
          ToteFlow combines a public probability signal with the live tote market to
          find horses the crowd is under-pricing &mdash; then filters aggressively so
          we only fire when there&apos;s real value.
        </p>
      </Section>

      <Section title="Why an edge is even possible here">
        <p>
          US horse racing runs on <strong>pari-mutuel</strong> pools: bettors wager
          against each other, and the platform takes a cut of the total pool (the
          &ldquo;takeout,&rdquo; typically 15&ndash;20%). Unlike a sportsbook, the
          platform is <em>not</em> the counterparty on your bet &mdash; so they have
          no incentive to hide sharp signal from their customers.
        </p>
        <p>
          That structural quirk means useful probability signal exists in the open, and
          the market that has to absorb it is famously noisy: recreational money, late
          swings, favorite-longshot bias, thin pools on smaller cards. If you can
          identify the right signal, calibrate it against the crowd&apos;s view, and
          be strict about when to actually pull the trigger, positive expected value
          shows up in specific pockets of the market.
        </p>
      </Section>

      <Section title="What ToteFlow actually does">
        <p>
          At a high level, for every race on the board we:
        </p>
        <ol className="list-decimal pl-5 space-y-1 text-ink-1">
          <li>Ingest live tote odds, pools, and a probability signal.</li>
          <li>Decide whether that race is even worth having an opinion on.</li>
          <li>Reconcile the signal with what the market is saying.</li>
          <li>Ask whether any horse offers positive expected value after takeout.</li>
          <li>If &mdash; and only if &mdash; one does, fire a paper ticket.</li>
        </ol>
        <p className="text-ink-2 text-sm">
          The interesting work is in steps 2&ndash;4. The exact filters, weights, and
          thresholds are proprietary to ToteFlow and not documented publicly.
        </p>
      </Section>

      <Section title="Where the value lives">
        <p>
          The math of blending any conservative-ish probability signal with a
          takeout-taxed market means positive EV almost never appears at the top of
          the board. Favorites are priced roughly correctly and the house cut eats
          any small edge. The pockets of value that survive filtering sit further
          down the price ladder &mdash; and that&apos;s where our realized P&amp;L
          is concentrated.
        </p>
        <p className="text-ink-2 text-sm">
          A consequence: hit rate is low by design. Most tickets lose. The strategy
          only works if the winners pay enough to cover long losing streaks, which is
          why disciplined filtering matters more than volume.
        </p>
      </Section>

      <Section title="Track record so far">
        <p>
          Paper trades only. All results are simulated tickets recorded at the odds
          available at bet time; nothing is placed with real money by ToteFlow itself.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-ink-1">
          <li>Low single-digit hit rate, as expected given where the value lives.</li>
          <li>Realized ROI is concentrated in the longer-price buckets.</li>
        </ul>
        <p className="text-ink-2 text-sm">
          At the current sample size the confidence interval on ROI is still wide.
          Realized P&amp;L is the verdict, and the verdict takes hundreds more bets
          to become statistically meaningful. See the strategies page for live numbers.
        </p>
      </Section>

      <Section title="Honest caveats">
        <ul className="list-disc pl-5 space-y-1 text-ink-1">
          <li>Everything is paper. No real money placed by ToteFlow itself.</li>
          <li>Any edge here has a capacity ceiling &mdash; big money into a small pari-mutuel pool moves the odds against itself.</li>
          <li>Upstream data sources can change or disappear at any time.</li>
          <li>Short-run P&amp;L is dominated by variance. The verdict takes time.</li>
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
