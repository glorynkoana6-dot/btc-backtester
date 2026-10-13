
/* Separate Twelve Data XAU/USD one-minute reference. Not order flow. */
const ENV = ["TWELVE_DATA_API_KEY", "TWELVE_DATA_API_KEY_2", "TWELVE_DATA_API_KEY_3", "TWELVE_DATA_API_KEY_4"];
let memo, until = 0;
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "GET only" });
  if (memo && Date.now() < until) return res.status(200).json(memo);
  const keys = [...new Set(ENV.map(k => process.env[k]).filter(Boolean))];
  if (!keys.length) return res.status(200).json({ ok: false, error: "Set TWELVE_DATA_API_KEY in Vercel" });
  let error = "XAU reference unavailable";
  for (const key of keys) {
    try {
      const u = new URL("https://api.twelvedata.com/time_series");
      u.search = new URLSearchParams({ symbol: "XAU/USD", interval: "1min",
        outputsize: "2", timezone: "UTC", apikey: key }).toString();
      const response = await fetch(u, { signal: AbortSignal.timeout(5500), cache: "no-store" });
      const data = await response.json();
      const bar = data?.values?.[0]; const price = +bar?.close;
      if (!response.ok || data?.status === "error" || !(price > 0) || !Number.isFinite(price)) {
        throw new Error(data?.message || `HTTP ${response.status}`);
      }
      memo = { ok: true, price, candleUTC: bar.datetime, source: "Twelve Data 1m close", receivedAt: Date.now() };
      until = Date.now() + 80000;
      return res.status(200).json(memo);
    } catch (e) { error = e.message || error; }
  }
  return res.status(200).json({ ok: false, error });
}
