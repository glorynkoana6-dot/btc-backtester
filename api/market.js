
/*
 MKAYFX BLACKBOOK X2
 FILE: api/market.js

 Real Binance public market data.
 No API key required.

 This endpoint supplies REST snapshots.
 It is not a persistent WebSocket connection.
*/

const BASE = "https://data-api.binance.vision/api/v3";
const SYMBOL = "PAXGUSDT";

async function request(path) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, 6500);

  try {
    const response = await fetch(BASE + path, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        "Binance HTTP " + response.status
      );
    }

    const data = await response.json();

    if (data && typeof data === "object" &&
        typeof data.code === "number" &&
        data.code < 0) {
      throw new Error(
        data.msg || "Binance API error"
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const paths = {
    ticker:
      "/ticker/price?symbol=" + SYMBOL,

    depth:
      "/depth?symbol=" + SYMBOL + "&limit=20",

    trades:
      "/trades?symbol=" + SYMBOL + "&limit=100",

    candles:
      "/klines?symbol=" + SYMBOL +
      "&interval=1m&limit=100"
  };

  const keys = Object.keys(paths);

  const results = await Promise.allSettled(
    keys.map(key => request(paths[key]))
  );

  const data = {};
  const errors = {};

  results.forEach((result, index) => {
    const key = keys[index];

    if (result.status === "fulfilled") {
      data[key] = result.value;
    } else {
      errors[key] =
        result.reason?.message || "Fetch failed";
    }
  });

  const ok = Object.keys(data).length > 0;

  return res.status(ok ? 200 : 502).json({
    ok,
    symbol: SYMBOL,
    source: "BINANCE_PUBLIC_REST",
    mode: "SNAPSHOT",
    timestamp: Date.now(),

    price: data.ticker
      ? Number(data.ticker.price)
      : null,

    book: data.depth || null,

    trades: data.trades || [],

    candles: data.candles || [],

    errors
  });
}
