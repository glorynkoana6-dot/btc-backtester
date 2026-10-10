const clamp = (n, a, b) =>
  Math.max(a, Math.min(b, n));

const avg = a =>
  a.length
    ? a.reduce((s, x) => s + x, 0) / a.length
    : 0;

const hi = a =>
  Math.max(...a.map(x => x.high));

const lo = a =>
  Math.min(...a.map(x => x.low));

export const round = (x, d = 2) =>
  Number(Number(x).toFixed(d));

function ema(bars, period) {
  if (bars.length < period) return null;

  const xs = bars.map(b => b.close);

  let v = avg(xs.slice(0, period));

  const k = 2 / (period + 1);

  for (let i = period; i < xs.length; i++) {
    v = xs[i] * k + v * (1 - k);
  }

  return v;
}

function atr(bars, period = 14) {
  if (bars.length <= period) return null;

  const r = [];

  for (
    let i = bars.length - period;
    i < bars.length;
    i++
  ) {
    const x = bars[i];
    const prev = bars[i - 1];

    r.push(
      Math.max(
        x.high - x.low,
        Math.abs(x.high - prev.close),
        Math.abs(x.low - prev.close)
      )
    );
  }

  return avg(r);
}

function rsi(bars, period = 14) {
  if (bars.length <= period) return null;

  let up = 0;
  let down = 0;

  for (
    let i = bars.length - period;
    i < bars.length;
    i++
  ) {
    const change =
      bars[i].close - bars[i - 1].close;

    up += Math.max(change, 0);
    down += Math.max(-change, 0);
  }

  return down === 0
    ? up === 0
      ? 50
      : 100
    : 100 - 100 / (1 + up / down);
}

function sessionLevels(bars) {
  if (!bars.length) return {};

  const last = bars[bars.length - 1];

  const date = new Date(
    last.time * 1000
  ).toISOString().slice(0, 10);

  const day = bars.filter(x =>
    new Date(x.time * 1000)
      .toISOString()
      .startsWith(date)
  );

  const s = {
    asia: [0, 8],
    london: [8, 13],
    newYork: [13, 21]
  };

  const result = {};

  for (
    const [name, [from, to]]
    of Object.entries(s)
  ) {
    const list = day.filter(x => {
      const h = new Date(
        x.time * 1000
      ).getUTCHours();

      return h >= from && h < to;
    });

    result[name] = list.length
      ? {
          high: round(hi(list)),
          low: round(lo(list)),
          bars: list.length
        }
      : null;
  }

  return result;
}

function dailyLevels(highBars) {
  if (!highBars.length) {
    return {
      pdh: null,
      pdl: null
    };
  }

  const lastDay = new Date(
    highBars[highBars.length - 1].time * 1000
  ).toISOString().slice(0, 10);

  const dates = [
    ...new Set(
      highBars.map(x =>
        new Date(x.time * 1000)
          .toISOString()
          .slice(0, 10)
      )
    )
  ];

  const previous = dates
    .filter(x => x < lastDay)
    .at(-1);

  const prior = highBars.filter(x =>
    new Date(x.time * 1000)
      .toISOString()
      .startsWith(previous || 'NONE')
  );

  return {
    pdh: prior.length
      ? round(hi(prior))
      : null,

    pdl: prior.length
      ? round(lo(prior))
      : null
  };
}

/*
  Deterministic rule engine.

  No future candle access.

  No invented success probabilities.

  Order-book data does not change signals,
  preserving consistency with the backtester.
*/

export function evaluate({
  base,
  mid,
  high,
  spot = null,
  book = null,
  minScore = 53,
  riskPct = 0.5,
  equity = 1000,
  now = Date.now() / 1000,
  allowStale = false
}) {
  if (
    base.length < 85 ||
    mid.length < 60 ||
    high.length < 60
  ) {
    return {
      status: 'WAIT',
      reason:
        'Insufficient completed candle history',
      score: 0
    };
  }

  const last = base.at(-1);
  const midLast = mid.at(-1);

  const current = last.close;

  const a = atr(base);
  const v = rsi(base);

  if (!a || a <= 0) {
    return {
      status: 'WAIT',
      reason: 'Invalid ATR',
      score: 0
    };
  }

  const base20 = ema(base, 20);
  const base50 = ema(base, 50);

  const mid20 = ema(mid, 20);
  const mid50 = ema(mid, 50);

  const high20 = ema(high, 20);
  const high50 = ema(high, 50);

  const trendVotes = [
    base20 > base50 ? 1 : -1,
    mid20 > mid50 ? 1 : -1,
    high20 > high50 ? 1 : -1
  ];

  const trend = (
    trendVotes[0] * 0.25 +
    trendVotes[1] * 0.30 +
    trendVotes[2] * 0.45
  ) * 95;

  // Reference structure excludes the newest two candles.
  const prior = base.slice(-22, -2);

  const roof = hi(prior);
  const floor = lo(prior);

  const previous2 = base.slice(-2);

  const sweptLow = previous2.some(
    b =>
      b.low < floor - a * 0.05 &&
      b.close > floor &&
      b.close > b.open
  );

  const sweptHigh = previous2.some(
    b =>
      b.high > roof + a * 0.05 &&
      b.close < roof &&
      b.close < b.open
  );

  const breakoutUp =
    last.close >
    hi(base.slice(-21, -1)) + a * 0.05;

  const breakoutDown =
    last.close <
    lo(base.slice(-21, -1)) - a * 0.05;

  const trigger = sweptLow
    ? 'SELL-SIDE SWEEP'
    : sweptHigh
    ? 'BUY-SIDE SWEEP'
    : breakoutUp
    ? 'BREAKOUT UP'
    : breakoutDown
    ? 'BREAKOUT DOWN'
    : 'NO CONFIRMED TRIGGER';

  let liquidity = sweptLow
    ? 95
    : sweptHigh
    ? -95
    : breakoutUp
    ? 78
    : breakoutDown
    ? -78
    : 0;

  if (sweptLow && sweptHigh) {
    liquidity = 0;
  }

  const midPrev = mid.slice(-21, -1);

  const structure = (
    last.close > roof
      ? 80
      : last.close < floor
      ? -80
      : last.close > base20
      ? 28
      : -28
  ) * 0.60 + (
    midLast.close > hi(midPrev)
      ? 95
      : midLast.close < lo(midPrev)
      ? -95
      : midLast.close > mid20
      ? 35
      : -35
  ) * 0.40;

  const momentum = clamp(
    (v - 50) * 2.6,
    -90,
    90
  );

  const recentVolume = base
    .slice(-21, -1)
    .map(x => x.volume)
    .filter(x => x > 0);

  const volAvailable =
    recentVolume.length >= 15 &&
    last.volume > 0;

  const volRatio = volAvailable
    ? last.volume / avg(recentVolume)
    : null;

  const participation = volAvailable
    ? clamp(
        (volRatio - 0.65) * 60,
        0,
        85
      ) * Math.sign(last.close - last.open)
    : null;

  const agents = [
    {
      name: 'MTF TREND',
      value: round(trend),
      weight: 26,
      detail:
        `${
          trendVotes.filter(x => x > 0).length
        }/3 bullish timeframes`
    },
    {
      name: 'LIQUIDITY',
      value: round(liquidity),
      weight: 29,
      detail: trigger
    },
    {
      name: 'STRUCTURE',
      value: round(structure),
      weight: 24,
      detail:
        `Range ${round(floor)} – ${round(roof)}`
    },
    {
      name: 'MOMENTUM',
      value: round(momentum),
      weight: 15,
      detail: `RSI ${round(v, 1)}`
    },
    {
      name: 'PARTICIPATION',
      value:
        participation === null
          ? null
          : round(participation),
      weight: 6,
      detail:
        volRatio === null
          ? 'Volume unavailable'
          : `Volume ${round(volRatio, 2)}× average`
    }
  ];

  const active = agents.filter(
    x => x.value !== null
  );

  const weight = active.reduce(
    (s, x) => s + x.weight,
    0
  );

  const buyScore = round(
    active.reduce(
      (s, x) =>
        s +
        Math.max(0, x.value) * x.weight,
      0
    ) / weight
  );

  const sellScore = round(
    active.reduce(
      (s, x) =>
        s +
        Math.max(0, -x.value) * x.weight,
      0
    ) / weight
  );

  const side =
    buyScore >= sellScore
      ? 'BUY'
      : 'SELL';

  const score = Math.max(
    buyScore,
    sellScore
  );

  const live =
    Number.isFinite(spot) && spot > 0
      ? spot
      : current;

  const ageSec = Math.max(
    0,
    now - (last.time + 300)
  );

  const fresh = ageSec <= 11 * 60;

  const chase = Math.abs(
    live - current
  ) / a;

  const reasons = [];

  if (liquidity === 0) {
    reasons.push(
      'Waiting for a confirmed sweep or breakout'
    );
  }

  if (
    (side === 'BUY' && liquidity < 0) ||
    (side === 'SELL' && liquidity > 0)
  ) {
    reasons.push(
      'Liquidity trigger conflicts with consensus'
    );
  }

  if (score < minScore) {
    reasons.push(
      `Quality ${score} below threshold ${minScore}`
    );
  }

  if (
    (side === 'BUY' && trend < -35) ||
    (side === 'SELL' && trend > 35)
  ) {
    reasons.push(
      'Higher timeframe trend opposes trade'
    );
  }

  if (chase > 0.75) {
    reasons.push(
      `Price moved ${round(chase, 2)} ATR from signal candle`
    );
  }

  if (!allowStale && !fresh) {
    reasons.push(
      'Feed stale or market closed'
    );
  }

  const status = reasons.length
    ? 'WAIT'
    : side;

  let plan = null;

  if (status !== 'WAIT') {
    const rawDist =
      side === 'BUY'
        ? live - lo(base.slice(-9)) + a * 0.15
        : hi(base.slice(-9)) - live + a * 0.15;

    const distance = clamp(
      rawDist,
      a * 0.95,
      a * 2.20
    );

    const stop =
      side === 'BUY'
        ? live - distance
        : live + distance;

    const sign =
      side === 'BUY'
        ? 1
        : -1;

    const amountRisked =
      Math.max(0, equity) *
      clamp(riskPct, 0.1, 2) / 100;

    plan = {
      entry: round(live),

      stop: round(stop),

      tp1: round(
        live + sign * 1.5 * distance
      ),

      tp2: round(
        live + sign * 2.5 * distance
      ),

      riskDistance: round(distance),

      riskMoney: round(amountRisked),

      units: round(
        amountRisked / distance,
        6
      ),

      riskPct: clamp(
        riskPct,
        0.1,
        2
      ),

      chaseAtr: round(chase, 2),

      setupId:
        `${last.time}-${side}-${trigger.replaceAll(' ', '-')}`
    };
  }

  const bookImbalance =
    Number.isFinite(book?.imbalance)
      ? book.imbalance
      : null;

  const microstructure =
    bookImbalance === null
      ? null
      : {
          imbalancePct: round(
            bookImbalance * 100,
            1
          ),
          bidNotional: round(
            book.bidNotional
          ),
          askNotional: round(
            book.askNotional
          ),
          spread:
            Number.isFinite(book.spread)
              ? round(book.spread)
              : null
        };

  return {
    status,

    reason:
      reasons.join('; ') ||
      `${trigger}: rule gates passed`,

    side,
    score,
    buyScore,
    sellScore,
    minScore,
    trigger,
    agents,

    latestClosedTime:
      new Date(
        (last.time + 300) * 1000
      ).toISOString(),

    lastCandle: { ...last },

    ageSeconds: Math.round(ageSec),

    fresh,

    spot: round(live),

    atr: round(a),

    rsi: round(v, 1),

    regime:
      Math.abs(trend) < 30
        ? 'MIXED'
        : trend > 0
        ? 'BULLISH'
        : 'BEARISH',

    plan,
    microstructure,

    levels: {
      resistance: round(roof),
      support: round(floor),
      ...dailyLevels(high),
      sessions: sessionLevels(base),
      ema20: round(base20),
      ema50: round(base50)
    }
  };
}

export function summarize(
  trades,
  initialEquity
) {
  let balance = initialEquity;
  let peak = balance;
  let maxDD = 0;

  const curve = [
    {
      x: 0,
      equity: round(balance)
    }
  ];

  let wins = 0;
  let losses = 0;
  let flats = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let totalR = 0;

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];

    totalR += t.netR;

    if (t.netR > 0.001) {
      wins++;
      grossWin += t.netR;
    } else if (t.netR < -0.001) {
      losses++;
      grossLoss += Math.abs(t.netR);
    } else {
      flats++;
    }

    balance +=
      balance *
      (t.riskPct / 100) *
      t.netR;

    peak = Math.max(
      peak,
      balance
    );

    maxDD = Math.max(
      maxDD,
      (peak - balance) / peak * 100
    );

    curve.push({
      x: i + 1,
      equity: round(balance)
    });
  }

  return {
    trades: trades.length,
    wins,
    losses,
    flats,

    winRate:
      trades.length
        ? round(
            wins / trades.length * 100,
            1
          )
        : null,

    profitFactor:
      grossLoss
        ? round(
            grossWin / grossLoss,
            2
          )
        : null,

    expectancyR:
      trades.length
        ? round(
            totalR / trades.length,
            3
          )
        : null,

    totalR: round(totalR),

    maxDrawdownPct: round(maxDD),

    returnPct: round(
      (balance / initialEquity - 1) * 100
    ),

    balance: round(balance),

    curve
  };
}