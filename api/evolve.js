
import { candles } from '../lib/data.js';
import { research } from '../lib/engine.js';

export async function GET(req) {
  try {
    const q = new URL(req.url).searchParams;

    const bars = Math.min(
      1600,
      Math.max(500, Number(q.get('bars')) || 1000)
    );

    const generations = Math.min(
      5,
      Math.max(1, Number(q.get('generations')) || 3)
    );

    const population = Math.min(
      24,
      Math.max(8, Number(q.get('population')) || 12)
    );

    const b = await candles(bars);

    if (b.length < 400) {
      throw Error('Insufficient Coinbase history');
    }

    return Response.json({
      ok: true,
      symbol: 'BTC-USD',
      source: 'Coinbase Exchange',
      bars: b.length,
      from: new Date(b[0].t * 1000).toISOString(),
      to: new Date(b.at(-1).t * 1000).toISOString(),
      ...research(b, generations, population)
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
