// PAXG/USDT on Binance is a DIFFERENT instrument from XAU/USD.

const ROOT = "https://api.binance.com";

async function load(path) {
  const r = await fetch(ROOT + path, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" }
  });

  if (!r.ok) {
    throw new Error("Binance HTTP " + r.status);
  }

  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const paths = [
    "/api/v3/depth?symbol=PAXGUSDT&limit=20",
    "/api/v3/trades?symbol=PAXGUSDT&limit=70",
    "/api/v3/klines?symbol=PAXGUSDT&interval=1m&limit=80"
  ];

  const r = await Promise.allSettled(paths.map(load));

  const ok = r.map(x => x.status === "fulfilled");

  if (!ok.some(Boolean)) {
    return res.status(503).json({
      error: "Binance market snapshots unavailable from this region",
      source: "PAXGUSDT"
    });
  }

  const depth = ok[0] ? r[0].value : null;
  const trades = ok[1] ? r[1].value : null;
  const klines = ok[2] ? r[2].value : null;

  return res.status(200).json({
    instrument: "PAXG/USDT",
    source: "Binance spot (not COMEX or spot XAU/USD)",
    at: new Date().toISOString(),

    depth: depth ? {
      lastUpdateId: depth.lastUpdateId,
      bids: depth.bids,
      asks: depth.asks
    } : null,

    trades: trades ? trades.map(x => ({
      id: x.id,
      p: Number(x.price),
      q: Number(x.qty),
      t: x.time,
      side: x.isBuyerMaker ? "SELL" : "BUY"
    })) : null,

    candles: klines ? klines.map(x => ({
      t: new Date(x[0]).toISOString(),
      o: Number(x[1]),
      h: Number(x[2]),
      l: Number(x[3]),
      c: Number(x[4]),
      v: Number(x[5])
    })) : null
  });
}