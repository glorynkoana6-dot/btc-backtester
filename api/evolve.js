
import { candles } from "../lib/data.js";
import { evolve } from "../lib/engine.js";

function safeNumber(value, fallback, min, max) {
  const n = Number(value);

  return Number.isFinite(n)
    ? Math.max(min, Math.min(max, Math.floor(n)))
    : fallback;
}

export async function GET(request) {
  try {
    const q = new URL(request.url).searchParams;

    const tf = q.get("tf") === "15m"
      ? "15m"
      : "5m";

    const count = safeNumber(
      q.get("bars"),
      1500,
      500,
      5000
    );

    const generations = safeNumber(
      q.get("generations"),
      4,
      1,
      8
    );

    const population = safeNumber(
      q.get("population"),
      16,
      8,
      32
    );

    const history = await candles(tf, count);

    if (history.length < 400) {
      throw new Error(
        "Not enough XAU/USD historical candles"
      );
    }

    const results = evolve(
      history,
      generations,
      population
    );

    return Response.json({
      ok: true,
      symbol: "XAU/USD",
      source: "Twelve Data",
      timeframe: tf,
      bars: history.length,
      from: new Date(
        history[0].t * 1000
      ).toISOString(),
      to: new Date(
        history.at(-1).t * 1000
      ).toISOString(),
      ...results
    }, {
      headers: {
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    return Response.json({
      ok: false,
      error: String(error.message).slice(0, 200)
    }, {
      status: 502
    });
  }
}
