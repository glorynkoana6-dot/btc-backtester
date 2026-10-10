'use strict';

/*
 MKAYFX AUTONOMOUS STRATEGY SCIENTIST

 TRAINING:
 Genetic search and fitness optimization.

 VALIDATION:
 Select champion from training finalists.

 HOLDOUT:
 Evaluate selected champion once.

 Important:
 Repeatedly optimizing against the same holdout
 would make it unsuitable as an independent test.
*/

const TYPES = [
  'SWEEP',
  'BREAKOUT',
  'TREND',
  'MEAN_REVERSION'
];

const LOOKBACKS = [
  8, 12, 16, 20, 24, 32
];

const WARMUP = 65;

function rng(seed) {
  let n = seed >>> 0;

  return () => {
    n += 0x6D2B79F5;

    let x = n;

    x = Math.imul(
      x ^ (x >>> 15),
      x | 1
    );

    x ^= x + Math.imul(
      x ^ (x >>> 7),
      x | 61
    );

    return (
      (x ^ (x >>> 14)) >>> 0
    ) / 4294967296;
  };
}

const clamp = (v, lo, hi) =>
  Math.max(lo, Math.min(hi, v));

const round = (v, places = 2) =>
  Number(v.toFixed(places));

function randomGene(rand) {
  const pick = a =>
    a[Math.floor(rand() * a.length)];

  return {
    type: pick(TYPES),
    lookback: pick(LOOKBACKS),
    filter: round(
      0.45 + rand() * 0.35
    ),
    threshold: round(
      0.02 + rand() * 0.32
    ),
    stopATR: round(
      0.65 + rand() * 1.05
    ),
    rr: round(
      1.1 + rand() * 1.9
    ),
    hold: Math.round(
      8 + rand() * 64
    ),
    trendGate: rand() < 0.5
  };
}

function mutate(g, rand) {
  const child = { ...g };

  if (rand() < 0.12) {
    child.type = TYPES[
      Math.floor(rand() * TYPES.length)
    ];
  }

  if (rand() < 0.3) {
    child.lookback = LOOKBACKS[
      Math.floor(rand() * LOOKBACKS.length)
    ];
  }

  if (rand() < 0.5) {
    child.filter = round(
      clamp(
        child.filter +
          (rand() - 0.5) * 0.22,
        0.4,
        0.9
      )
    );
  }

  if (rand() < 0.5) {
    child.threshold = round(
      clamp(
        child.threshold +
          (rand() - 0.5) * 0.15,
        0.01,
        0.55
      )
    );
  }

  if (rand() < 0.5) {
    child.stopATR = round(
      clamp(
        child.stopATR +
          (rand() - 0.5) * 0.5,
        0.5,
        2.2
      )
    );
  }

  if (rand() < 0.5) {
    child.rr = round(
      clamp(
        child.rr +
          (rand() - 0.5) * 0.75,
        0.8,
        4
      )
    );
  }

  if (rand() < 0.4) {
    child.hold = Math.round(
      clamp(
        child.hold +
          (rand() - 0.5) * 22,
        4,
        96
      )
    );
  }

  if (rand() < 0.15) {
    child.trendGate =
      !child.trendGate;
  }

  return child;
}

function crossover(a, b, rand) {
  const child = {};

  for (const key of Object.keys(a)) {
    child[key] =
      rand() < 0.5
        ? a[key]
        : b[key];
  }

  return mutate(child, rand);
}

function normalizeBars(raw) {
  if (!Array.isArray(raw)) {
    throw new Error(
      'Candle data is not an array.'
    );
  }

  const output = [];
  let bad = 0;

  for (const item of raw) {
    const b = {
      time: Number(item.time),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close)
    };

    if (
      !Object.values(b).every(
        Number.isFinite
      ) ||
      b.time < 946684800000 ||
      b.open <= 0 ||
      b.low <= 0 ||
      b.close <= 0 ||
      b.high < Math.max(
        b.open,
        b.close
      ) ||
      b.low > Math.min(
        b.open,
        b.close
      )
    ) {
      bad++;
      continue;
    }

    output.push(b);
  }

  output.sort(
    (a, b) => a.time - b.time
  );

  const unique = output.filter(
    (b, i) =>
      i === 0 ||
      b.time !== output[i - 1].time
  );

  const saturday = unique.filter(
    b =>
      new Date(b.time).getUTCDay() === 6
  ).length;

  const tradable = unique.filter(
    b =>
      new Date(b.time).getUTCDay() !== 6
  );

  if (tradable.length < 600) {
    throw new Error(
      `Need 600+ valid non-Saturday candles; found ${tradable.length}.`
    );
  }

  return {
    bars: tradable,
    bad:
      bad +
      output.length -
      unique.length,
    saturday
  };
}

function indicators(bars) {
  const n = bars.length;

  const e20 = Array(n).fill(NaN);
  const e50 = Array(n).fill(NaN);
  const atr = Array(n).fill(NaN);
  const rsi = Array(n).fill(NaN);
  const upper = Array(n).fill(NaN);
  const lower = Array(n).fill(NaN);

  const prevHigh = {};
  const prevLow = {};

  for (const lb of LOOKBACKS) {
    prevHigh[lb] = Array(n).fill(NaN);
    prevLow[lb] = Array(n).fill(NaN);
  }

  let up = 0;
  let down = 0;
  let a = 0;

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const previous = bars[i - 1];

    e20[i] =
      i === 0
        ? b.close
        : e20[i - 1] +
          (2 / 21) *
            (b.close - e20[i - 1]);

    e50[i] =
      i === 0
        ? b.close
        : e50[i - 1] +
          (2 / 51) *
            (b.close - e50[i - 1]);

    if (i > 0) {
      const trueRange = Math.max(
        b.high - b.low,
        Math.abs(
          b.high - previous.close
        ),
        Math.abs(
          b.low - previous.close
        )
      );

      const gain = Math.max(
        0,
        b.close - previous.close
      );

      const loss = Math.max(
        0,
        previous.close - b.close
      );

      if (i <= 14) {
        a += trueRange;
        up += gain;
        down += loss;

        if (i === 14) {
          a /= 14;
          up /= 14;
          down /= 14;

          atr[i] = a;

          rsi[i] =
            down === 0
              ? up === 0
                ? 50
                : 100
              : 100 -
                100 / (1 + up / down);
        }
      } else {
        a =
          (a * 13 + trueRange) / 14;

        up =
          (up * 13 + gain) / 14;

        down =
          (down * 13 + loss) / 14;

        atr[i] = a;

        rsi[i] =
          down === 0
            ? up === 0
              ? 50
              : 100
            : 100 -
              100 / (1 + up / down);
      }
    }

    if (i >= 19) {
      let total = 0;

      for (
        let j = i - 19;
        j <= i;
        j++
      ) {
        total += bars[j].close;
      }

      const mean = total / 20;
      let variance = 0;

      for (
        let j = i - 19;
        j <= i;
        j++
      ) {
        variance +=
          (bars[j].close - mean) ** 2;
      }

      const deviation =
        2 * Math.sqrt(
          variance / 20
        );

      upper[i] =
        mean + deviation;

      lower[i] =
        mean - deviation;
    }

    for (const lb of LOOKBACKS) {
      if (i < lb) continue;

      let high = -Infinity;
      let low = Infinity;

      for (
        let j = i - lb;
        j < i;
        j++
      ) {
        high = Math.max(
          high,
          bars[j].high
        );

        low = Math.min(
          low,
          bars[j].low
        );
      }

      prevHigh[lb][i] = high;
      prevLow[lb][i] = low;
    }
  }

  return {
    e20,
    e50,
    atr,
    rsi,
    upper,
    lower,
    prevHigh,
    prevLow
  };
}

function signal(bars, f, i, g) {
  const b = bars[i];
  const prev = bars[i - 1];

  const A = f.atr[i];
  const range = b.high - b.low;

  if (
    !Number.isFinite(A) ||
    A <= 0 ||
    range <= 0 ||
    !prev
  ) {
    return 0;
  }

  const bullBody = Math.max(
    0,
    b.close - b.open
  ) / range;

  const bearBody = Math.max(
    0,
    b.open - b.close
  ) / range;

  const hi =
    f.prevHigh[g.lookback][i];

  const lo =
    f.prevLow[g.lookback][i];

  const upTrend =
    f.e20[i] > f.e50[i];

  const downTrend =
    f.e20[i] < f.e50[i];

  if (g.type === 'SWEEP') {
    if (
      b.low <
        lo - g.threshold * A &&
      b.close > lo &&
      (b.close - b.low) / range >=
        g.filter &&
      bullBody > 0.05 &&
      (
        !g.trendGate ||
        upTrend
      )
    ) {
      return 1;
    }

    if (
      b.high >
        hi + g.threshold * A &&
      b.close < hi &&
      (b.high - b.close) / range >=
        g.filter &&
      bearBody > 0.05 &&
      (
        !g.trendGate ||
        downTrend
      )
    ) {
      return -1;
    }
  }

  else if (g.type === 'BREAKOUT') {
    if (
      b.close >
        hi + g.threshold * A &&
      bullBody >= g.filter &&
      (
        !g.trendGate ||
        upTrend
      )
    ) {
      return 1;
    }

    if (
      b.close <
        lo - g.threshold * A &&
      bearBody >= g.filter &&
      (
        !g.trendGate ||
        downTrend
      )
    ) {
      return -1;
    }
  }

  else if (g.type === 'TREND') {
    if (
      upTrend &&
      b.close > f.e20[i] &&
      prev.close <= f.e20[i - 1] &&
      bullBody >= g.filter &&
      (
        f.e20[i] - f.e50[i]
      ) / A >= g.threshold
    ) {
      return 1;
    }

    if (
      downTrend &&
      b.close < f.e20[i] &&
      prev.close >= f.e20[i - 1] &&
      bearBody >= g.filter &&
      (
        f.e50[i] - f.e20[i]
      ) / A >= g.threshold
    ) {
      return -1;
    }
  }

  else if (
    g.type === 'MEAN_REVERSION'
  ) {
    if (
      prev.close <
        f.lower[i - 1] -
          g.threshold *
            f.atr[i - 1] &&
      b.close > f.lower[i] &&
      bullBody >= g.filter &&
      f.rsi[i] < 58 &&
      (
        !g.trendGate ||
        upTrend
      )
    ) {
      return 1;
    }

    if (
      prev.close >
        f.upper[i - 1] +
          g.threshold *
            f.atr[i - 1] &&
      b.close < f.upper[i] &&
      bearBody >= g.filter &&
      f.rsi[i] > 42 &&
      (
        !g.trendGate ||
        downTrend
      )
    ) {
      return -1;
    }
  }

  return 0;
}

function evaluate(
  bars,
  f,
  g,
  start,
  end,
  settings,
  keep = false
) {
  let equity = 1000;
  let peak = 1000;
  let maxDD = 0;

  let totalR = 0;
  let wins = 0;
  let losses = 0;

  let grossWins = 0;
  let grossLoss = 0;

  const trades = [];

  const curve = [
    {
      index: start,
      equity: 1000
    }
  ];

  const riskFactor =
    settings.riskPct / 100;

  for (
    let i = Math.max(
      start,
      WARMUP
    );
    i < end - 1;
  ) {
    const side = signal(
      bars,
      f,
      i,
      g
    );

    if (!side) {
      i++;
      continue;
    }

    const entryIndex = i + 1;
    const entry =
      bars[entryIndex].open;

    const distance =
      f.atr[i] * g.stopATR;

    if (
      !Number.isFinite(distance) ||
      distance <
        entry * 0.000005
    ) {
      i++;
      continue;
    }

    const stop =
      entry - side * distance;

    const target =
      entry +
      side *
        distance *
        g.rr;

    if (
      stop <= 0 ||
      target <= 0
    ) {
      i++;
      continue;
    }

    const lastBar = Math.min(
      end - 1,
      entryIndex + g.hold - 1
    );

    let exit =
      bars[lastBar].close;

    let exitIndex = lastBar;
    let reason = 'TIME';

    for (
      let j = entryIndex;
      j <= lastBar;
      j++
    ) {
      const b = bars[j];

      if (
        (
          side === 1 &&
          b.open <= stop
        ) ||
        (
          side === -1 &&
          b.open >= stop
        )
      ) {
        exit = b.open;
        exitIndex = j;
        reason = 'STOP_GAP';
        break;
      }

      // Conservative execution:
      // stop is checked before target.
      if (
        (
          side === 1 &&
          b.low <= stop
        ) ||
        (
          side === -1 &&
          b.high >= stop
        )
      ) {
        exit = stop;
        exitIndex = j;
        reason = 'STOP';
        break;
      }

      if (
        (
          side === 1 &&
          b.high >= target
        ) ||
        (
          side === -1 &&
          b.low <= target
        )
      ) {
        exit = target;
        exitIndex = j;
        reason = 'TARGET';
        break;
      }
    }

    const netR =
      side *
        (exit - entry) /
        distance -
      settings.costR;

    totalR += netR;

    if (netR > 0) {
      wins++;
      grossWins += netR;
    }

    else if (netR < 0) {
      losses++;
      grossLoss += -netR;
    }

    equity = Math.max(
      0,
      equity *
        (
          1 +
          netR *
            riskFactor
        )
    );

    peak = Math.max(
      peak,
      equity
    );

    maxDD = Math.max(
      maxDD,
      peak > 0
        ? 100 *
          (
            peak - equity
          ) /
          peak
        : 100
    );

    if (keep) {
      trades.push({
        side:
          side === 1
            ? 'BUY'
            : 'SELL',

        entered:
          bars[entryIndex].time,

        exited:
          bars[exitIndex].time,

        entry:
          round(entry, 2),

        exit:
          round(exit, 2),

        reason,

        netR:
          round(netR, 3)
      });

      curve.push({
        index: exitIndex,
        equity: round(
          equity,
          2
        )
      });
    }

    // No overlapping trades.
    i = exitIndex + 1;
  }

  const count =
    wins + losses;

  return {
    trades: count,
    wins,
    losses,

    winRate:
      count
        ? 100 * wins / count
        : 0,

    profitFactor:
      grossLoss
        ? grossWins / grossLoss
        : grossWins
          ? 99
          : 0,

    expectancy:
      count
        ? totalR / count
        : 0,

    totalR,
    maxDD,

    returnPct:
      100 *
      (
        equity / 1000 - 1
      ),

    finalEquity: equity,

    ...(
      keep
        ? {
            curve,
            tradeLog: trades
          }
        : {}
    )
  };
}

function fitness(m) {
  if (m.trades < 8) {
    return (
      -1000 + m.trades
    );
  }

  const reliability =
    Math.min(
      1,
      Math.sqrt(
        m.trades / 40
      )
    );

  return (
    clamp(
      m.expectancy,
      -2,
      2
    ) *
      85 *
      reliability +

    Math.log(
      clamp(
        m.profitFactor,
        0.05,
        5
      )
    ) *
      18 *
      reliability -

    m.maxDD * 0.3 -

    (
      m.trades < 20
        ? (20 - m.trades) * 1.7
        : 0
    )
  );
}

function choose(pop, rand) {
  let best = null;

  for (
    let i = 0;
    i < 4;
    i++
  ) {
    const candidate = pop[
      Math.floor(
        rand() * pop.length
      )
    ];

    if (
      !best ||
      candidate.score >
        best.score
    ) {
      best = candidate;
    }
  }

  return best.gene;
}

function run(payload) {
  const normalized =
    normalizeBars(
      payload.bars
    );

  const bars =
    normalized.bars;

  const settings = {
    riskPct: clamp(
      Number(
        payload.settings.riskPct
      ) || 0.5,
      0.1,
      2
    ),

    costR: clamp(
      Number(
        payload.settings.costR
      ) || 0,
      0,
      1
    ),

    generations: Math.round(
      clamp(
        Number(
          payload.settings.generations
        ) || 8,
        1,
        30
      )
    ),

    population: Math.round(
      clamp(
        Number(
          payload.settings.population
        ) || 32,
        8,
        100
      )
    ),

    seed:
      Number(
        payload.settings.seed
      ) || 20261010
  };

  const rand =
    rng(settings.seed);

  const f =
    indicators(bars);

  const trainEnd =
    Math.floor(
      bars.length * 0.6
    );

  const valEnd =
    Math.floor(
      bars.length * 0.8
    );

  const segments = {
    train: [
      WARMUP,
      trainEnd
    ],

    validation: [
      trainEnd,
      valEnd
    ],

    holdout: [
      valEnd,
      bars.length
    ]
  };

  let population =
    Array.from(
      {
        length:
          settings.population
      },
      () => randomGene(rand)
    );

  const archive =
    new Map();

  const progress = [];

  for (
    let generation = 1;
    generation <=
      settings.generations;
    generation++
  ) {
    const results =
      population.map(
        gene => {
          const metrics =
            evaluate(
              bars,
              f,
              gene,
              ...segments.train,
              settings
            );

          return {
            gene,
            metrics,
            score:
              fitness(metrics)
          };
        }
      ).sort(
        (a, b) =>
          b.score - a.score
      );

    for (
      const result of
        results.slice(0, 6)
    ) {
      const id =
        JSON.stringify(
          result.gene
        );

      if (
        !archive.has(id) ||
        result.score >
          archive.get(id).score
      ) {
        archive.set(
          id,
          result
        );
      }
    }

    const best =
      results[0];

    progress.push({
      generation,
      score:
        round(best.score),

      type:
        best.gene.type,

      trainingR:
        round(
          best.metrics.expectancy,
          3
        ),

      trades:
        best.metrics.trades
    });

    self.postMessage({
      type: 'PROGRESS',
      generation,
      generations:
        settings.generations,

      best:
        progress[
          progress.length - 1
        ]
    });

    if (
      generation !==
        settings.generations
    ) {
      const next =
        results
          .slice(0, 3)
          .map(
            x => ({
              ...x.gene
            })
          );

      while (
        next.length <
          settings.population
      ) {
        if (
          rand() < 0.12
        ) {
          next.push(
            randomGene(rand)
          );
        }

        else {
          next.push(
            crossover(
              choose(
                results,
                rand
              ),
              choose(
                results,
                rand
              ),
              rand
            )
          );
        }
      }

      population = next;
    }
  }

  // Finalist selection uses validation,
  // but never the holdout.

  const finalists = [
    ...archive.values()
  ]
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 16);

  const ranked =
    finalists.map(
      item => {
        const validation =
          evaluate(
            bars,
            f,
            item.gene,
            ...segments.validation,
            settings
          );

        const valScore =
          fitness(validation);

        const passes =
          item.metrics.trades >= 20 &&
          validation.trades >= 10 &&
          item.metrics.expectancy > 0 &&
          validation.expectancy > 0 &&
          validation.profitFactor > 1.1;

        return {
          ...item,
          validation,
          valScore,
          passes
        };
      }
    ).sort(
      (a, b) =>
        Number(
          b.passes
        ) -
        Number(
          a.passes
        ) ||
        b.valScore -
          a.valScore
    );

  const chosen =
    ranked[0];

  const champion =
    chosen.gene;

  // Holdout is evaluated only after
  // the champion has been selected.

  const train =
    evaluate(
      bars,
      f,
      champion,
      ...segments.train,
      settings,
      true
    );

  const validation =
    evaluate(
      bars,
      f,
      champion,
      ...segments.validation,
      settings,
      true
    );

  const holdout =
    evaluate(
      bars,
      f,
      champion,
      ...segments.holdout,
      settings,
      true
    );

  const warnings = [];

  if (
    normalized.bad
  ) {
    warnings.push(
      `${normalized.bad} invalid/duplicate candles removed.`
    );
  }

  if (
    normalized.saturday
  ) {
    warnings.push(
      `${normalized.saturday} Saturday UTC candles removed. Confirm feed timezone and market hours.`
    );
  }

  if (
    holdout.trades < 30
  ) {
    warnings.push(
      `Only ${holdout.trades} holdout trades; 30 minimum for this preliminary quality gate.`
    );
  }

  if (
    holdout.trades < 100
  ) {
    warnings.push(
      'A longer, independently collected test with 100+ trades is recommended.'
    );
  }

  if (
    settings.costR === 0
  ) {
    warnings.push(
      'Trading costs are zero; results may be unrealistically optimistic.'
    );
  }

  warnings.push(
    'Fixed costR is an approximation, not a broker spread/slippage simulation.'
  );

  warnings.push(
    'Repeated searches on the same holdout invalidate its independence.'
  );

  let status =
    'NO ROBUST EDGE';

  if (
    chosen.passes &&
    holdout.trades >= 30 &&
    holdout.expectancy > 0 &&
    holdout.profitFactor >= 1.1 &&
    holdout.maxDD <= 15
  ) {
    status =
      'PROMISING — FORWARD TEST REQUIRED';
  }

  else if (
    chosen.passes &&
    holdout.trades < 30
  ) {
    status =
      'INSUFFICIENT HOLDOUT SAMPLE';
  }

  return {
    status,
    champion,
    train,
    validation,
    holdout,
    progress,

    data: {
      count:
        bars.length,

      start:
        bars[0].time,

      end:
        bars[
          bars.length - 1
        ].time,

      splits: {
        training:
          trainEnd - WARMUP,

        validation:
          valEnd - trainEnd,

        holdout:
          bars.length - valEnd
      },

      invalid:
        normalized.bad,

      saturday:
        normalized.saturday
    },

    settings,
    warnings,

    selections:
      ranked
        .slice(0, 5)
        .map(
          x => ({
            gene: x.gene,

            trainScore:
              round(
                x.score
              ),

            validationScore:
              round(
                x.valScore
              ),

            validationTrades:
              x.validation.trades
          })
        )
  };
}

self.onmessage = ({ data }) => {
  if (
    data?.type !== 'RUN'
  ) {
    return;
  }

  try {
    self.postMessage({
      type: 'STATUS',
      message:
        'Preparing indicators and chronological splits…'
    });

    const result =
      run(data);

    self.postMessage({
      type: 'DONE',
      result
    });

  } catch (error) {
    self.postMessage({
      type: 'ERROR',

      error:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
};