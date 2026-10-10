
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

export function features(b) {
  const out = [];
  let eFast = b[0]?.c || 0;
  let eSlow = eFast;

  for (let i = 0; i < b.length; i++) {
    const x = b[i];

    eFast += 2 / 21 * (x.c - eFast);
    eSlow += 2 / 51 * (x.c - eSlow);

    const w = b.slice(Math.max(0, i - 14), i + 1);

    const tr = w.map((z, j) => {
      const prev = b[Math.max(0, i - w.length + 1 + j - 1)] || z;
      return Math.max(
        z.h - z.l,
        Math.abs(z.h - prev.c),
        Math.abs(z.l - prev.c)
      );
    });

    const atr = mean(tr);
    const prior = b.slice(Math.max(0, i - 20), i);
    const roof = prior.length ? Math.max(...prior.map(z => z.h)) : NaN;
    const floor = prior.length ? Math.min(...prior.map(z => z.l)) : NaN;

    let up = 0;
    let down = 0;

    for (let j = Math.max(1, i - 13); j <= i; j++) {
      const d = b[j].c - b[j - 1].c;
      up += Math.max(0, d);
      down += Math.max(0, -d);
    }

    const rsi = down === 0
      ? (up === 0 ? 50 : 100)
      : 100 - 100 / (1 + up / down);

    out.push({
      ...x,
      atr,
      fast: eFast,
      slow: eSlow,
      rsi,
      roof,
      floor
    });
  }

  return out;
}

export function signal(x, p) {
  if (!x || !x.atr || !Number.isFinite(x.roof)) return 0;

  const trend = x.fast > x.slow ? 1 : -1;
  const up = x.c > x.o ? 1 : -1;

  if (p.kind === 'trend') {
    return trend === up &&
      Math.abs(x.fast - x.slow) > x.atr * p.filter
      ? trend : 0;
  }

  if (p.kind === 'breakout') {
    return x.c > x.roof + x.atr * p.filter
      ? 1
      : x.c < x.floor - x.atr * p.filter
      ? -1 : 0;
  }

  if (p.kind === 'sweep') {
    return x.l < x.floor - x.atr * p.filter &&
      x.c > x.floor
      ? 1
      : x.h > x.roof + x.atr * p.filter &&
        x.c < x.roof
      ? -1 : 0;
  }

  if (p.kind === 'rsi') {
    return x.rsi < p.threshold && up > 0
      ? 1
      : x.rsi > 100 - p.threshold && up < 0
      ? -1 : 0;
  }

  return 0;
}

export function simulate(b, p, from = 60, to = b.length - 1) {
  const f = features(b);
  const trades = [];

  let equity = 1000;
  let peak = 1000;
  let maxDD = 0;

  const curve = [{ i: from, v: equity }];

  for (let i = Math.max(60, from); i < Math.min(to, b.length - 1); i++) {
    const x = f[i];
    const dir = signal(x, p);

    if (!dir) continue;

    const next = b[i + 1];
    const entry = next.o;
    const dist = x.atr * p.stop;

    if (
      !Number.isFinite(dist) ||
      dist <= 0 ||
      Math.abs(entry - x.c) > x.atr * 0.75
    ) continue;

    const sl = entry - dir * dist;
    const tp = entry + dir * dist * p.rr;

    let result = 0;
    let exit = i + 1;
    let reason = 'TIME';

    for (let j = i + 1; j <= Math.min(b.length - 1, i + p.hold); j++) {
      const z = b[j];

      const hitSL = dir === 1 ? z.l <= sl : z.h >= sl;
      const hitTP = dir === 1 ? z.h >= tp : z.l <= tp;

      exit = j;

      if (hitSL || hitTP) {
        result = hitSL ? -1 : p.rr;
        reason = hitSL ? 'SL' : 'TP';
        break;
      }

      result = dir * (z.c - entry) / dist;
    }

    const net = result - p.cost;

    equity *= Math.max(0.001, 1 + net * p.risk / 100);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak * 100);

    trades.push({
      time: new Date(next.t * 1000).toISOString(),
      side: dir === 1 ? 'BUY' : 'SELL',
      entry: +entry.toFixed(2),
      stop: +sl.toFixed(2),
      target: +tp.toFixed(2),
      netR: +net.toFixed(3),
      reason
    });

    curve.push({
      i: exit,
      v: +equity.toFixed(2)
    });

    i = exit;
  }

  const wins = trades.filter(t => t.netR > 0);
  const losses = trades.filter(t => t.netR < 0);

  const sum = trades.reduce((s, t) => s + t.netR, 0);
  const gain = wins.reduce((s, t) => s + t.netR, 0);
  const loss = -losses.reduce((s, t) => s + t.netR, 0);

  return {
    count: trades.length,
    winRate: trades.length ? 100 * wins.length / trades.length : 0,
    expectancy: trades.length ? sum / trades.length : 0,
    pf: loss ? gain / loss : null,
    totalR: sum,
    drawdown: maxDD,
    equity,
    curve,
    trades
  };
}

export function randomParam(r = Math.random) {
  const kinds = ['trend', 'breakout', 'sweep', 'rsi'];

  return {
    kind: kinds[Math.floor(r() * kinds.length)],
    filter: +(.03 + r() * .4).toFixed(3),
    threshold: Math.round(22 + r() * 18),
    stop: +(.8 + r() * 1.4).toFixed(2),
    rr: +(1 + r() * 2).toFixed(2),
    hold: Math.round(6 + r() * 24),
    cost: .12,
    risk: .5
  };
}

export function mutate(p, r = Math.random) {
  const q = { ...p };
  const keys = ['kind', 'filter', 'threshold', 'stop', 'rr', 'hold'];
  const k = keys[Math.floor(r() * keys.length)];

  const candidate = randomParam(r);
  q[k] = candidate[k];

  return q;
}

export function score(x) {
  if (x.count < 12) return -1000;

  return x.expectancy * 100 +
    Math.min(x.count, 80) * .15 -
    x.drawdown * 1.5;
}

function metrics(x) {
  const { curve, trades, ...rest } = x;

  return Object.fromEntries(
    Object.entries(rest).map(([k, v]) => [
      k,
      typeof v === 'number' ? +v.toFixed(3) : v
    ])
  );
}

export function research(b, generations = 3, population = 16) {
  const split1 = Math.floor(b.length * .6);
  const split2 = Math.floor(b.length * .8);

  let pool = Array.from({ length: population }, () => randomParam());
  const history = [];

  for (let g = 0; g < generations; g++) {
    const ranked = pool.map(p => ({
      p,
      dev: simulate(b.slice(0, split1), p)
    })).sort((a, z) => score(z.dev) - score(a.dev));

    history.push({
      generation: g + 1,
      best: ranked[0]?.dev.expectancy || 0
    });

    const elites = ranked
      .slice(0, Math.max(2, Math.ceil(population / 4)))
      .map(x => x.p);

    pool = [...elites];

    while (pool.length < population) {
      pool.push(mutate(elites[Math.floor(Math.random() * elites.length)]));
    }
  }

  const candidates = pool.map(p => ({
    p,
    dev: simulate(b.slice(0, split1), p)
  })).sort((a, z) => score(z.dev) - score(a.dev)).slice(0, 6);

  const ranked = candidates.map(x => ({
    ...x,
    val: simulate(b.slice(0, split2), x.p, split1, split2 - 1)
  })).sort((a, z) => score(z.val) - score(a.val));

  const best = ranked[0];

  const holdout = best
    ? simulate(b, best.p, split2, b.length - 1)
    : null;

  const passed = !!best &&
    best.val.count >= 8 &&
    best.val.expectancy > 0 &&
    holdout.count >= 8 &&
    holdout.expectancy > 0;

  return {
    history,

    candidates: ranked.map(x => ({
      params: x.p,
      development: metrics(x.dev),
      validation: metrics(x.val)
    })),

    champion: best ? {
      params: best.p,
      development: metrics(best.dev),
      validation: metrics(best.val),
      holdout: metrics(holdout),
      equityCurve: holdout.curve,
      trades: holdout.trades.slice(-15)
    } : null,

    verdict: passed
      ? 'PROMISING — NOT LIVE VALIDATED'
      : 'NO ROBUST EDGE CONFIRMED',

    split: {
      development: [0, split1],
      validation: [split1, split2],
      holdout: [split2, b.length]
    }
  };
}
