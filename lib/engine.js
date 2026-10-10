
const clamp = (n, a, b) =>
  Math.max(a, Math.min(b, n));

const avg = a =>
  a.length
    ? a.reduce((s, x) => s + x, 0) / a.length
    : 0;

const round = (n, d = 3) =>
  Number(n.toFixed(d));

const TYPES = [
  "TREND",
  "BREAKOUT",
  "SWEEP",
  "RSI"
];

export function indicators(bars) {
  let ema20 = bars[0]?.c || 0;
  let ema50 = ema20;

  return bars.map((x, i) => {
    ema20 += (x.c - ema20) * 2 / 21;
    ema50 += (x.c - ema50) * 2 / 51;

    const recent = bars.slice(
      Math.max(0, i - 13),
      i + 1
    );

    const trueRanges = recent.map((b, j) => {
      const previous =
        bars[Math.max(0, i - recent.length + j)] || b;

      return Math.max(
        b.h - b.l,
        Math.abs(b.h - previous.c),
        Math.abs(b.l - previous.c)
      );
    });

    const atr = avg(trueRanges);

    let gains = 0;
    let losses = 0;

    for (
      let j = Math.max(1, i - 13);
      j <= i;
      j++
    ) {
      const delta = bars[j].c - bars[j - 1].c;

      gains += Math.max(0, delta);
      losses += Math.max(0, -delta);
    }

    const rsi =
      losses === 0
        ? gains === 0 ? 50 : 100
        : 100 - 100 / (1 + gains / losses);

    const prior = bars.slice(
      Math.max(0, i - 20),
      i
    );

    const resistance = prior.length
      ? Math.max(...prior.map(v => v.h))
      : null;

    const support = prior.length
      ? Math.min(...prior.map(v => v.l))
      : null;

    return {
      ...x,
      ema20,
      ema50,
      atr,
      rsi,
      resistance,
      support
    };
  });
}

export function getSignal(x, p) {
  if (
    !x ||
    !x.atr ||
    x.support === null ||
    x.resistance === null
  ) return 0;

  const bullish = x.c > x.o;
  const bearish = x.c < x.o;

  switch (p.type) {
    case "TREND":
      if (
        x.ema20 > x.ema50 &&
        bullish &&
        x.c > x.ema20 &&
        x.ema20 - x.ema50 > x.atr * p.filter
      ) return 1;

      if (
        x.ema20 < x.ema50 &&
        bearish &&
        x.c < x.ema20 &&
        x.ema50 - x.ema20 > x.atr * p.filter
      ) return -1;

      return 0;

    case "BREAKOUT":
      if (
        x.c >
        x.resistance + x.atr * p.filter
      ) return 1;

      if (
        x.c <
        x.support - x.atr * p.filter
      ) return -1;

      return 0;

    case "SWEEP":
      if (
        x.l <
        x.support - x.atr * p.filter &&
        x.c > x.support &&
        bullish
      ) return 1;

      if (
        x.h >
        x.resistance + x.atr * p.filter &&
        x.c < x.resistance &&
        bearish
      ) return -1;

      return 0;

    case "RSI":
      if (
        x.rsi < p.threshold &&
        bullish
      ) return 1;

      if (
        x.rsi > 100 - p.threshold &&
        bearish
      ) return -1;

      return 0;

    default:
      return 0;
  }
}

export function randomStrategy(r = Math.random) {
  return {
    type: TYPES[Math.floor(r() * TYPES.length)],
    filter: round(0.02 + r() * 0.35),
    threshold: Math.round(20 + r() * 20),
    stopATR: round(0.8 + r() * 1.7, 2),
    rr: round(1 + r() * 2.5, 2),
    hold: Math.round(5 + r() * 35),
    riskPct: 0.5,
    costR: 0.12
  };
}

export function mutate(p, r = Math.random) {
  const next = { ...p };
  const fields = [
    "type",
    "filter",
    "threshold",
    "stopATR",
    "rr",
    "hold"
  ];

  const field = fields[
    Math.floor(r() * fields.length)
  ];

  next[field] = randomStrategy(r)[field];

  return next;
}

export function backtest(
  bars,
  p,
  from = 80,
  to = bars.length - 1
) {
  const f = indicators(bars);

  const trades = [];
  const curve = [{ n: 0, equity: 1000 }];

  let equity = 1000;
  let peak = equity;
  let maxDD = 0;

  const start = Math.max(80, from);
  const end = Math.min(to, bars.length - 1);

  for (let i = start; i < end; i++) {
    const x = f[i];
    const direction = getSignal(x, p);

    if (!direction) continue;

    const entry = bars[i + 1].o;
    const distance = x.atr * p.stopATR;

    if (
      !Number.isFinite(distance) ||
      distance <= 0 ||
      Math.abs(entry - x.c) > x.atr * 0.6
    ) continue;

    const stop = entry - direction * distance;
    const target = entry + direction * distance * p.rr;

    let exit = entry;
    let exitIndex = i + 1;
    let resultR = 0;
    let reason = "TIME";

    for (
      let j = i + 1;
      j <= Math.min(end, i + p.hold);
      j++
    ) {
      const b = bars[j];

      const hitSL =
        direction === 1
          ? b.l <= stop
          : b.h >= stop;

      const hitTP =
        direction === 1
          ? b.h >= target
          : b.l <= target;

      exitIndex = j;

      if (hitSL || hitTP) {
        // Conservative assumption:
        // SL occurs first if both are hit.
        exit = hitSL ? stop : target;
        resultR = hitSL ? -1 : p.rr;
        reason = hitSL ? "SL" : "TP";
        break;
      }

      exit = b.c;
      resultR =
        direction * (exit - entry) / distance;
    }

    const netR = resultR - p.costR;

    equity *= Math.max(
      0.001,
      1 + netR * p.riskPct / 100
    );

    peak = Math.max(peak, equity);

    maxDD = Math.max(
      maxDD,
      (peak - equity) / peak * 100
    );

    trades.push({
      time: new Date(
        bars[i + 1].t * 1000
      ).toISOString(),
      side: direction === 1 ? "BUY" : "SELL",
      entry: round(entry, 2),
      stop: round(stop, 2),
      target: round(target, 2),
      exit: round(exit, 2),
      resultR: round(netR),
      reason
    });

    curve.push({
      n: trades.length,
      equity: round(equity, 2)
    });

    i = exitIndex;
  }

  const wins = trades.filter(
    t => t.resultR > 0
  );

  const losses = trades.filter(
    t => t.resultR < 0
  );

  const grossWin = wins.reduce(
    (s, t) => s + t.resultR,
    0
  );

  const grossLoss = Math.abs(
    losses.reduce(
      (s, t) => s + t.resultR,
      0
    )
  );

  const totalR = trades.reduce(
    (s, t) => s + t.resultR,
    0
  );

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,

    winRate: trades.length
      ? round(wins.length / trades.length * 100, 1)
      : null,

    expectancy: trades.length
      ? round(totalR / trades.length)
      : null,

    profitFactor: grossLoss
      ? round(grossWin / grossLoss, 2)
      : null,

    totalR: round(totalR),
    drawdown: round(maxDD, 2),
    equity: round(equity, 2),
    curve,
    trades
  };
}

function fitness(result) {
  if (
    result.count < 10 ||
    result.expectancy === null
  ) return -10000;

  return (
    result.expectancy * 100 +
    Math.min(result.count, 80) * 0.12 -
    result.drawdown * 1.8
  );
}

function summary(result) {
  const { curve, trades, ...rest } = result;
  return rest;
}

export function evolve(
  bars,
  generations = 4,
  population = 16
) {
  const devEnd = Math.floor(bars.length * 0.6);
  const valEnd = Math.floor(bars.length * 0.8);

  let pool = Array.from(
    { length: population },
    () => randomStrategy()
  );

  const evolution = [];

  for (let generation = 0;
    generation < generations;
    generation++
  ) {
    const ranked = pool.map(params => ({
      params,
      development: backtest(
        bars.slice(0, devEnd),
        params
      )
    })).sort(
      (a, b) =>
        fitness(b.development) -
        fitness(a.development)
    );

    evolution.push({
      generation: generation + 1,
      bestFitness: round(
        fitness(ranked[0].development),
        2
      ),
      bestExpectancy:
        ranked[0].development.expectancy
    });

    const elites = ranked
      .slice(
        0,
        Math.max(2, Math.ceil(population / 4))
      )
      .map(x => x.params);

    pool = [...elites];

    while (pool.length < population) {
      const parent = elites[
        Math.floor(Math.random() * elites.length)
      ];

      pool.push(mutate(parent));
    }
  }

  // Rank on development first.
  const finalists = pool.map(params => ({
    params,
    development: backtest(
      bars.slice(0, devEnd),
      params
    )
  })).sort(
    (a, b) =>
      fitness(b.development) -
      fitness(a.development)
  ).slice(0, 8);

  // Validation is used to choose the champion.
  const candidates = finalists.map(x => ({
    ...x,
    validation: backtest(
      bars,
      x.params,
      devEnd,
      valEnd - 1
    )
  })).sort(
    (a, b) =>
      fitness(b.validation) -
      fitness(a.validation)
  );

  const winner = candidates[0];

  // The holdout is evaluated only after selection.
  const holdout = winner
    ? backtest(
        bars,
        winner.params,
        valEnd,
        bars.length - 1
      )
    : null;

  const passed =
    !!winner &&
    winner.validation.count >= 10 &&
    winner.validation.expectancy > 0 &&
    holdout.count >= 10 &&
    holdout.expectancy > 0 &&
    holdout.profitFactor > 1;

  return {
    verdict: passed
      ? "PROMISING — REQUIRES FORWARD TESTING"
      : "NO ROBUST EDGE CONFIRMED",

    generations,
    population,
    evaluated: generations * population,

    evolution,

    splits: {
      development: devEnd,
      validation: valEnd - devEnd,
      holdout: bars.length - valEnd
    },

    candidates: candidates.map(x => ({
      params: x.params,
      development: summary(x.development),
      validation: summary(x.validation)
    })),

    champion: winner
      ? {
          params: winner.params,
          development: summary(winner.development),
          validation: summary(winner.validation),
          holdout: summary(holdout),
          curve: holdout.curve,
          trades: holdout.trades.slice(-25).reverse()
        }
      : null
  };
}
