import { liveProviders } from "@/lib/adapters";
import { autobook } from "@/lib/autobook";
import { grader } from "@/lib/grader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function snapshot() {
  void autobook.tickIfDue();
  void grader.tickIfDue();
  const liveResults = await Promise.all(liveProviders().map(p => p.listRaces()));
  const races = liveResults.flat();
  races.sort((a, b) => a.postTime - b.postTime);
  const sources = [...new Set(races.map(r => r.source))];
  return { races, sources, alerts: [] };
}

export async function GET(request: Request) {
  let closed = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let keep: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { close(); }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (poll) clearTimeout(poll);
        if (keep) clearInterval(keep);
        try { controller.close(); } catch {}
      };

      request.signal.addEventListener("abort", close);
      if (request.signal.aborted) { close(); return; }

      send("hello", { ok: true, ts: Date.now() });
      const initial = await snapshot();
      send("tick", { ...initial, ts: Date.now() });

      // Adaptive cadence: bump to 1.5s when any race is in chaos (T-60s) so the
      // BetWindow indicator can flip WAIT → BET_NOW → LOCKED without lag, 3s in
      // action phase, 5s otherwise. We re-arm the interval after each tick.
      let lastRaces = initial.races;
      const cadenceFor = (races: typeof lastRaces): number => {
        const now = Date.now();
        let min = Infinity;
        for (const r of races) {
          const ms = r.postTime - now;
          if (ms > 0 && ms < min) min = ms;
        }
        if (min <= 60_000) return 1500;
        if (min <= 5 * 60_000) return 3000;
        return 5000;
      };
      const scheduleNext = () => {
        if (closed) return;
        const ms = cadenceFor(lastRaces);
        poll = setTimeout(async () => {
          if (closed) return;
          const snap = await snapshot();
          lastRaces = snap.races;
          send("tick", { ...snap, ts: Date.now() });
          scheduleNext();
        }, ms);
      };
      scheduleNext();
      keep = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`: keep-alive\n\n`)); } catch { close(); }
      }, 15000);
    },
    cancel() {
      closed = true;
      if (poll) clearTimeout(poll);
      if (keep) clearInterval(keep);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
