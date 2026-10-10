
import { candles } from "../lib/data.js";
import {
  indicators,
  getSignal
} from "../lib/engine.js";

export async function GET(request) {
  try {
    const q = new URL(request.url).searchParams;

    const tf = q.get("tf") === "15m"
      ? "15m"
      : "5m";

    const raw = q.get("strategy");

    if (!raw || raw.length > 3000) {
      throw new Error("Valid strategy required");
    }

    const p = JSON.parse(raw);

    if (
      !["TREND", "BREAKOUT", "SWEEP", "RSI"]
        .includes(p.type) ||
      !Number.isFinite(p.stopATR) ||
      !Number.isFinite(p.rr) ||
      p.stopATR < 0.1 ||
      p.stopATR > 5 ||
      p.rr < 0.5 ||
      p.rr > 6 ||
      !Number.isFinite(p.filter) ||
      !Number.isFinite(p.threshold)
    ) {
      throw new Error("Invalid strategy parameters");
    }

    const history = await candles(tf, 180);

    if (history.length < 80) {
      throw new Error("Insufficient recent gold data");
    }

    const x = indicators(history).at(-1);

    const direction = getSignal(x, p);

    const seconds = tf === "5m" ? 300 : 900;

    const age =
      Date.now() / 1000 -
      (x.t + seconds);

    const fresh = age >= 0 && age <= seconds * 2;

    const side = !fresh
      ? "WAIT"
      : direction === 1
      ? "BUY"
      : direction === -1
      ? "SELL"
      : "WAIT";

    const distance = x.atr * p.stopATR;

    return Response.json({
      ok: true,
      symbol: "XAU/USD",
      timeframe: tf,
      source: "Twelve Data",
      candleTime: new Date(
        x.t * 1000
      ).toISOString(),
      price: x.c,
      atr: x.atr,
      rsi: x.rsi,
      ema20: x.ema20,
      ema50: x.ema50,
      support: x.support,
      resistance: x.resistance,
      fresh,
      signal: side,

      stop: side === "WAIT"
        ? null
        : Number(
            (x.c - direction * distance).toFixed(2)
          ),

      target: side === "WAIT"
        ? null
        : Number(
            (x.c + direction * distance * p.rr)
              .toFixed(2)
          ),

      note:
        side === "WAIT"
          ? "No fresh confirmed signal"
          : "Research signal based on the latest completed candle; not a broker execution quote"

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
      status: 400
    });
  }
}
