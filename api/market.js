
/* MKAYFX BLACKBOOK X3: public Binance PAXG/USDT fallback.
   ?history=1 bootstraps 720 1m candles; normal polling fetches 120.
   This is NOT futures/OTC XAU/USD order flow. */
const BASES = ["https://data-api.binance.vision", "https://api.binance.com"];
const SYMBOL = "PAXGUSDT";
async function read(path) {
  let last = "Provider unavailable";
  for (const base of BASES) {
    try {
      const r = await fetch(base + path, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4500),
        cache: "no-store"
      });
      const data = await r.json();
      if (!r.ok || (data && !Array.isArray(data) && typeof data.code === "number" && data.code < 0)) {
        throw new Error(data?.msg || `HTTP ${r.status}`);
      }
      return data;
    } catch (e) { last = e.message || last; }
  }
  throw new Error(last);
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "GET only" });
  const url = new URL(req.url || "/", "https://example.invalid");
  const history = url.searchParams.get("history") === "1";
  const paths = {
    depth: `/api/v3/depth?symbol=${SYMBOL}&limit=20`,
    trades: `/api/v3/trades?symbol=${SYMBOL}&limit=150`,
    candles: `/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=${history ? 720 : 120}`,
    ticker: `/api/v3/ticker/24hr?symbol=${SYMBOL}`
  };
  const results = await Promise.allSettled(Object.values(paths).map(read));
  const names = Object.keys(paths);
  const out = { ok: false, symbol: SYMBOL, receivedAt: Date.now(), depth: null,
    trades: null, candles: null, ticker: null, errors: {} };
  for (let i = 0; i < results.length; i++) {
    const r = results[i]; const name = names[i];
    if (r.status !== "fulfilled") { out.errors[name] = r.reason?.message || "Unavailable"; continue; }
    if (name === "candles") {
      out.candles = r.value.map(k => ({ t: +k[0], o: +k[1], h: +k[2],
        l: +k[3], c: +k[4], v: +k[5], closed: Date.now() > +k[6] }));
    } else out[name] = r.value;
  }
  out.ok = names.some(name => out[name] !== null);
  return res.status(out.ok ? 200 : 503).json(out);
}
