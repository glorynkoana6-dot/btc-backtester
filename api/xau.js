
/*
 Separate indicative XAU/USD candle-close
 reference, not exchange order flow.
*/

const NAMES = [
  "TWELVE_DATA_API_KEY",
  "TWELVE_DATA_API_KEY_2",
  "TWELVE_DATA_API_KEY_3",
  "TWELVE_DATA_API_KEY_4"
];

let cache = null;
let expiry = 0;

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "GET only"
    });
  }

  if (cache && Date.now() < expiry) {
    return res.status(200).json(cache);
  }

  const keys = [
    ...new Set(
      NAMES
        .map(n => process.env[n])
        .filter(Boolean)
    )
  ];

  if (!keys.length) {
    return res.status(200).json({
      ok: false,
      error: "Configure TWELVE_DATA_API_KEY"
    });
  }

  let error = "XAU/USD feed unavailable";

  for (const key of keys) {
    try {
      const url = new URL(
        "https://api.twelvedata.com/time_series"
      );

      url.search = new URLSearchParams({
        symbol: "XAU/USD",
        interval: "1min",
        outputsize: "2",
        timezone: "UTC",
        apikey: key
      }).toString();

      const r = await fetch(url, {
        signal: AbortSignal.timeout(5500),
        cache: "no-store"
      });

      const d = await r.json();
      const candle = d?.values?.[0];
      const price = Number(candle?.close);

      if (
        !r.ok ||
        d.status === "error" ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        throw Error(
          d.message || `HTTP ${r.status}`
        );
      }

      cache = {
        ok: true,
        price,
        symbol: "XAU/USD",
        source: "Twelve Data 1min close",
        candleUTC: candle.datetime,
        fetchedAt: Date.now()
      };

      expiry = Date.now() + 75000;

      return res.status(200).json(cache);

    } catch (e) {
      error = e.message;
    }
  }

  return res.status(200).json({
    ok: false,
    error
  });
}
