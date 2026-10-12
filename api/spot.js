
/*
 MKAYFX BLACKBOOK X2
 FILE: api/spot.js

 Optional Twelve Data XAU/USD quote.
 Keep your API key in Vercel environment variables.
*/

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

  const key = process.env.TWELVE_DATA_API_KEY;

  if (!key) {
    return res.status(200).json({
      ok: false,
      configured: false,
      error: "TWELVE_DATA_API_KEY not configured"
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 6500);

  try {
    const url = new URL(
      "https://api.twelvedata.com/price"
    );

    url.searchParams.set("symbol", "XAU/USD");
    url.searchParams.set("apikey", key);

    const response = await fetch(url, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        "Twelve Data HTTP " + response.status
      );
    }

    const data = await response.json();
    const price = Number(data.price);

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(
        data.message || "No valid XAU/USD price"
      );
    }

    return res.status(200).json({
      ok: true,
      symbol: "XAU/USD",
      source: "TWELVE_DATA",
      price,
      timestamp: Date.now()
    });

  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error.message
    });

  } finally {
    clearTimeout(timer);
  }
}
