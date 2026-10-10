const CB = 'https://api.exchange.coinbase.com';
const TD = 'https://api.twelvedata.com/time_series';

const PERIOD = {
  '5m': 300,
  '15m': 900,
  '1h': 3600
};

const TD_PERIOD = {
  '5m': '5min',
  '15m': '15min',
  '1h': '1h'
};

export function publicError(err) {
  const msg = String(err?.message || err);

  return msg
    .replace(/apikey=[^&\s]+/gi, 'apikey=REDACTED')
    .slice(0, 220);
}

async function json(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MKAYFX-OMEGA/1.0'
    },
    signal: AbortSignal.timeout(11500),
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(
      `Market provider HTTP ${response.status}`
    );
  }

  return response.json();
}

function valid(b) {
  return [
    b.time,
    b.open,
    b.high,
    b.low,
    b.close
  ].every(Number.isFinite) &&
    b.low > 0 &&
    b.high >= b.low &&
    b.open > 0 &&
    b.close > 0;
}

function uniqueSorted(rows) {
  return [
    ...new Map(
      rows.filter(valid).map(b => [b.time, b])
    ).values()
  ].sort((a, b) => a.time - b.time);
}

// Only completed candles.
// Coinbase timestamps represent candle opening times.
export async function btcBars(tf, requested = 250) {
  const interval = PERIOD[tf];

  if (!interval) {
    throw new Error('Unsupported timeframe');
  }

  const now = Math.floor(Date.now() / 1000);

  const bucket =
    Math.floor(now / interval) * interval;

  const n = Math.min(
    2200,
    Math.max(100, requested)
  );

  const chunks = [];

  for (
    let offset = 0;
    offset < n;
    offset += 260
  ) {
    const count = Math.min(260, n - offset);

    const end = bucket - offset * interval;
    const start = end - count * interval;

    chunks.push({ start, end });
  }

  const rows = [];

  // Fetch sequentially to reduce rate-limit pressure.
  for (const { start, end } of chunks) {
    const qs = new URLSearchParams({
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
      granularity: String(interval)
    });

    const result = await json(
      `${CB}/products/BTC-USD/candles?${qs}`
    );

    if (!Array.isArray(result)) {
      throw new Error(
        'Unexpected Coinbase candles response'
      );
    }

    for (const v of result) {
      rows.push({
        time: Number(v[0]),
        low: Number(v[1]),
        high: Number(v[2]),
        open: Number(v[3]),
        close: Number(v[4]),
        volume: Number(v[5] || 0)
      });
    }
  }

  return uniqueSorted(rows)
    .filter(b => b.time + interval <= now)
    .slice(-n);
}

function tdKey(tf) {
  const preferred =
    tf === '5m'
      ? 'TWELVE_DATA_API_KEY_3'
      : tf === '15m'
      ? 'TWELVE_DATA_API_KEY_2'
      : 'TWELVE_DATA_API_KEY_4';

  return (
    process.env[preferred] ||
    process.env.TWELVE_DATA_API_KEY ||
    process.env.TWELVE_DATA_API_KEY_2 ||
    process.env.TWELVE_DATA_API_KEY_3 ||
    process.env.TWELVE_DATA_API_KEY_4
  );
}

export async function goldBars(
  tf,
  requested = 250
) {
  const key = tdKey(tf);

  if (!key) {
    throw new Error(
      'Gold requires TWELVE_DATA_API_KEY in Vercel Environment Variables'
    );
  }

  const n = Math.max(
    100,
    Math.min(2200, requested)
  );

  const qs = new URLSearchParams({
    symbol: 'XAU/USD',
    interval: TD_PERIOD[tf],
    timezone: 'UTC',
    outputsize: String(n),
    apikey: key
  });

  const data = await json(`${TD}?${qs}`);

  if (
    data.status === 'error' ||
    !Array.isArray(data.values)
  ) {
    throw new Error(
      data.message ||
      'No Twelve Data candles returned (check plan and symbol)'
    );
  }

  const now = Math.floor(Date.now() / 1000);

  const bars = data.values.map(v => ({
    time: Math.floor(
      Date.parse(
        String(v.datetime).replace(' ', 'T') + 'Z'
      ) / 1000
    ),
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close),
    volume: Number(v.volume || 0)
  }));

  return uniqueSorted(bars)
    .filter(b => b.time + PERIOD[tf] <= now)
    .slice(-n);
}

export const candles = (asset, tf, n) =>
  asset === 'XAU'
    ? goldBars(tf, n)
    : btcBars(tf, n);

// Coinbase public order-book snapshot.
// Display only: not historical or guaranteed liquidity.
export async function btcMicrostructure() {
  const [tick, book] = await Promise.allSettled([
    json(`${CB}/products/BTC-USD/ticker`),
    json(`${CB}/products/BTC-USD/book?level=2`)
  ]);

  const price =
    tick.status === 'fulfilled'
      ? Number(tick.value.price)
      : null;

  let orderflow = null;

  if (book.status === 'fulfilled') {
    const b = book.value;

    const notional = levels =>
      (levels || [])
        .slice(0, 30)
        .reduce(
          (s, x) =>
            s + Number(x[0]) * Number(x[1]),
          0
        );

    const bids = notional(b.bids);
    const asks = notional(b.asks);

    if (bids + asks > 0) {
      orderflow = {
        bidNotional: bids,
        askNotional: asks,
        imbalance:
          (bids - asks) / (bids + asks),
        spread:
          b.bids?.[0] && b.asks?.[0]
            ? Number(b.asks[0][0]) -
              Number(b.bids[0][0])
            : null
      };
    }
  }

  return {
    price:
      Number.isFinite(price) && price > 0
        ? price
        : null,

    orderflow,

    priceTime:
      tick.status === 'fulfilled'
        ? tick.value.time || null
        : null
  };
}