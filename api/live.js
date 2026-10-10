
import { candles } from '../lib/data.js';
import { features, signal } from '../lib/engine.js';

export async function GET(req) {
  try {
    const p = new URL(req.url).searchParams;

    let strategy = null;

    try {
      strategy = JSON.parse(p.get('strategy') || 'null');
    } catch {}

    if (
      !strategy ||
      !['trend', 'breakout', 'sweep', 'rsi'].includes(strategy.kind)
    ) {
      return Response.json({
        ok: false,
        error: 'Supply a valid research strategy'
      }, {
        status: 400
      });
    }

    const b = await candles(150);
    const x = features(b).at(-1);

    const side = signal(x, strategy);

    const fresh = Date.now() / 1000 - (x.t + 300) < 900;

    return Response.json({
      ok: true,
      price: x.c,
      candleTime: new Date(x.t * 1000).toISOString(),
      fresh,

      signal: fresh
        ? (side === 1 ? 'BUY' : side === -1 ? 'SELL' : 'WAIT')
        : 'WAIT',

      reason: fresh
        ? 'Completed candle rule evaluation'
        : 'Stale candle data',

      stop: side
        ? +(x.c - side * x.atr * strategy.stop).toFixed(2)
        : null,

      target: side
        ? +(x.c + side * x.atr * strategy.stop * strategy.rr).toFixed(2)
        : null,

      atr: x.atr

    }, {
      headers: {
        'Cache-Control': 'no-store'
      }
    });

  } catch (e) {
    return Response.json({
      ok: false,
      error: String(e.message).slice(0, 160)
    }, {
      status: 502
    });
  }
}
