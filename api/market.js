
/* Public Binance REST backup. Never fabricate data. */

const HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com"
];

const SYMBOL = "PAXGUSDT";

async function get(path) {
  let last;

  for (const host of HOSTS) {
    try {
      const r = await fetch(host + path, {
        signal: AbortSignal.timeout(4500),
        cache: "no-store"
      });

      const data = await r.json();

      if (!r.ok || data?.code < 0) {
        throw Error(
          data?.msg || `HTTP ${r.status}`
        );
      }

      return data;
    } catch (e) {
      last = e;
    }
  }

  throw Error(
    last?.message || "Provider unavailable"
  );
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "GET only"
    });
  }

  const routes = {
    depth:
      `/api/v3/depth?symbol=${SYMBOL}&limit=20`,

    trades:
      `/api/v3/trades?symbol=${SYMBOL}&limit=200`,

    candles:
      `/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=130`,

    ticker:
      `/api/v3/ticker/24hr?symbol=${SYMBOL}`
  };

  const entries = await Promise.allSettled(
    Object.entries(routes).map(
      async ([name, path]) => [
        name,
        await get(path)
      ]
    )
  );

  const output = {
    ok: false,
    symbol: SYMBOL,
    receivedAt: Date.now(),
    depth: null,
    trades: null,
    candles: null,
    ticker: null,
    errors: []
  };

  for (const result of entries) {
    if (result.status === "rejected") {
      output.errors.push(
        result.reason?.message || "Request failed"
      );
      continue;
    }

    const [name, data] = result.value;

    output[name] =
      name === "candles"
        ? data.map(k => ({
            t: +k[0],
            o: +k[1],
            h: +k[2],
            l: +k[3],
            c: +k[4],
            v: +k[5],
            closed: Date.now() >= +k[6] + 1
          }))
        : data;
  }

  output.ok = !!(
    output.depth ||
    output.trades ||
    output.candles ||
    output.ticker
  );

  return res.status(
    output.ok ? 200 : 503
  ).json(output);
}
