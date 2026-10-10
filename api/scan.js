import {
  candles,
  btcMicrostructure,
  publicError
} from '../lib/market.js';

import {
  evaluate
} from '../lib/engine.js';

const number = (
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

const respond = (
  data,
  code = 200
) => Response.json(data, {
  status: code,
  headers: {
    'Cache-Control': 'no-store, max-age=0'
  }
});

export async function GET(request) {
  const params = new URL(
    request.url
  ).searchParams;

  const asset =
    params.get('asset') === 'XAU'
      ? 'XAU'
      : 'BTC';

  const minScore = number(
    params.get('minScore'),
    53,
    40,
    85
  );

  const equity = number(
    params.get('equity'),
    1000,
    20,
    10000000
  );

  const riskPct = number(
    params.get('riskPct'),
    0.5,
    0.1,
    2
  );

  try {
    const [
      base,
      mid,
      high,
      micro
    ] = await Promise.all([
      candles(asset, '5m', 245),
      candles(asset, '15m', 240),
      candles(asset, '1h', 160),

      asset === 'BTC'
        ? btcMicrostructure()
            .catch(() => ({}))
        : Promise.resolve({})
    ]);

    const scan = evaluate({
      base,
      mid,
      high,

      spot: micro.price,

      book: micro.orderflow,

      equity,
      riskPct,
      minScore
    });

    const age = micro.priceTime
      ? (
          Date.now() -
          Date.parse(micro.priceTime)
        ) / 1000
      : Infinity;

    if (
      asset === 'BTC' &&
      (
        !Number.isFinite(age) ||
        age > 150 ||
        age < -60 ||
        !micro.price
      )
    ) {
      scan.status = 'WAIT';
      scan.plan = null;

      scan.reason +=
        '; Coinbase ticker is unavailable or stale';
    }

    return respond({
      ok: true,

      asset,

      symbol:
        asset === 'XAU'
          ? 'XAU/USD'
          : 'BTC-USD',

      source:
        asset === 'XAU'
          ? 'Twelve Data'
          : 'Coinbase Exchange',

      generatedAt:
        new Date().toISOString(),

      feed: {
        bars5m: base.length,
        bars15m: mid.length,
        bars1h: high.length,
        tickerTime:
          micro.priceTime || null
      },

      ...scan,

      candles: base.slice(-135)
    });

  } catch (err) {
    return respond({
      ok: false,
      asset,
      error: publicError(err)
    }, 502);
  }
}