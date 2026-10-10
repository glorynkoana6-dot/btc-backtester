import {
  candles,
  publicError
} from '../lib/market.js';

import {
  evaluate,
  summarize,
  round
} from '../lib/engine.js';

const numeric = (
  s,
  fallback,
  low,
  high
) => {
  if (s === null || s === '') {
    return fallback;
  }

  const n = Number(s);

  return Number.isFinite(n)
    ? Math.max(low, Math.min(high, n))
    : fallback;
};

const reply = (
  data,
  status = 200
) => Response.json(data, {
  status,
  headers: {
    'Cache-Control': 'no-store'
  }
});

export async function GET(request) {
  const p = new URL(
    request.url
  ).searchParams;

  const asset =
    p.get('asset') === 'XAU'
      ? 'XAU'
      : 'BTC';

  const count = numeric(
    p.get('bars'),
    1200,
    500,
    2000
  );

  const minScore = numeric(
    p.get('minScore'),
    53,
    40,
    85
  );

  const costR = numeric(
    p.get('costR'),
    0.12,
    0,
    1
  );

  const equity = numeric(
    p.get('equity'),
    1000,
    20,
    10000000
  );

  const riskPct = numeric(
    p.get('riskPct'),
    0.5,
    0.1,
    2
  );

  const rr = numeric(
    p.get('rr'),
    1.5,
    1,
    4
  );

  const hold = numeric(
    p.get('hold'),
    18,
    4,
    60
  );

  try {
    const [
      base,
      mid,
      high
    ] = await Promise.all([
      candles(
        asset,
        '5m',
        count
      ),

      candles(
        asset,
        '15m',
        Math.min(
          1700,
          Math.ceil(count / 3) + 110
        )
      ),

      candles(
        asset,
        '1h',
        Math.min(
          950,
          Math.ceil(count / 12) + 110
        )
      )
    ]);

    if (base.length < 300) {
      throw new Error(
        'Not enough historical M5 candles for backtest'
      );
    }

    const trades = [];

    let tradeUntil = -1;

    let checks = 0;
    let setups = 0;

    const start = Math.max(
      100,
      base.length - count
    );

    for (
      let i = start;
      i < base.length - 2;
      i++
    ) {
      // One simulated open position at a time.
      if (i <= tradeUntil) continue;

      const closedAt =
        base[i].time + 300;

      const m = mid.filter(
        b => b.time + 900 <= closedAt
      );

      const h = high.filter(
        b => b.time + 3600 <= closedAt
      );

      if (
        m.length < 60 ||
        h.length < 60
      ) {
        continue;
      }

      checks++;

      const signal = evaluate({
        base: base.slice(0, i + 1),
        mid: m,
        high: h,

        minScore,
        riskPct,
        equity,

        now: closedAt,

        allowStale: true
      });

      if (
        !signal.plan ||
        signal.status === 'WAIT'
      ) {
        continue;
      }

      setups++;

      const direction =
        signal.status === 'BUY'
          ? 1
          : -1;

      const entry =
        base[i + 1].open;

      const distance =
        signal.plan.riskDistance;

      // Reject large opening gaps.
      if (
        Math.abs(
          entry - base[i].close
        ) > signal.atr * 0.5
      ) {
        continue;
      }

      const stop =
        entry - direction * distance;

      const target =
        entry +
        direction * distance * rr;

      let exit = null;

      let exitIndex = i + 1;

      let rawR = 0;

      let reason = 'TIME';

      for (
        let k = i + 1;
        k <= Math.min(
          base.length - 1,
          i + hold
        );
        k++
      ) {
        const b = base[k];

        const hitStop =
          direction > 0
            ? b.low <= stop
            : b.high >= stop;

        const hitTarget =
          direction > 0
            ? b.high >= target
            : b.low <= target;

        if (
          hitStop ||
          hitTarget
        ) {
          // Conservative same-candle collision:
          // assume stop loss was hit first.
          rawR = hitStop
            ? -1
            : rr;

          exit = hitStop
            ? stop
            : target;

          reason = hitStop
            ? 'SL'
            : 'TP';

          exitIndex = k;

          break;
        }

        exit = b.close;
        exitIndex = k;
      }

      if (reason === 'TIME') {
        rawR =
          direction *
          (exit - entry) /
          distance;
      }

      const netR = round(
        rawR - costR,
        3
      );

      trades.push({
        time: new Date(
          base[i + 1].time * 1000
        ).toISOString(),

        entry: round(entry),
        stop: round(stop),
        target: round(target),
        exit: round(exit),

        side: signal.status,
        quality: signal.score,
        trigger: signal.trigger,
        reason,
        netR,
        riskPct,
        index: i
      });

      tradeUntil = exitIndex;
    }

    const split = Math.floor(
      base.length * 0.7
    );

    const dev = trades.filter(
      t => t.index < split
    );

    const val = trades.filter(
      t => t.index >= split
    );

    const full = summarize(
      trades,
      equity
    );

    const development = summarize(
      dev,
      equity
    );

    const validation = summarize(
      val,
      equity
    );

    const validated =
      val.length >= 20 &&
      validation.expectancyR > 0 &&
      validation.profitFactor > 1 &&
      validation.maxDrawdownPct < 12;

    return reply({
      ok: true,

      asset,

      generatedAt:
        new Date().toISOString(),

      params: {
        bars: base.length,
        minScore,
        riskPct,
        equity,
        costR,
        rr,
        hold,

        logic:
          'Completed M5 signals → next M5 open → SL-first on same-bar collisions',

        orderflow:
          'Excluded from entry logic to retain historical/live parity',

        costs:
          'Fixed round-trip cost expressed as fraction of stop distance (R)'
      },

      span: {
        from: new Date(
          base[0].time * 1000
        ).toISOString(),

        to: new Date(
          base.at(-1).time * 1000
        ).toISOString(),

        validationFrom: new Date(
          base[split].time * 1000
        ).toISOString()
      },

      checkedCandles: checks,
      setups,

      full,
      development,
      validation,

      verdict:
        val.length < 20
          ? 'INSUFFICIENT VALIDATION TRADES'
          : validated
          ? 'PASSED LIMITED VALIDATION'
          : 'NO VALIDATED EDGE',

      caveat:
        'Single historical window; no bid/ask execution model; fixed simulated costs; no guarantee of forward profitability.',

      recentTrades:
        trades.slice(-25).reverse()
    });

  } catch (err) {
    return reply({
      ok: false,
      error: publicError(err)
    }, 502);
  }
}