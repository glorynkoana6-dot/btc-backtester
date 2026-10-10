
const BASE = 'https://api.exchange.coinbase.com/products/BTC-USD/candles';

export async function candles(n = 1200) {
  const interval = 300;
  const end = Math.floor(Date.now() / 1000 / interval) * interval;
  const all = [];

  for (let offset = 0; offset < n; offset += 250) {
    const length = Math.min(250, n - offset);
    const stop = end - offset * interval;
    const start = stop - length * interval;

    const url = new URL(BASE);
    url.searchParams.set('granularity', '300');
    url.searchParams.set('start', new Date(start * 1000).toISOString());
    url.searchParams.set('end', new Date(stop * 1000).toISOString());

    const r = await fetch(url, {
      headers: {
        'User-Agent': 'MKAYFX-GODMODE/1.0',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!r.ok) throw Error(`Coinbase HTTP ${r.status}`);

    const values = await r.json();
    if (!Array.isArray(values)) throw Error('Invalid Coinbase response');

    for (const v of values) {
      all.push({
        t: +v[0],
        l: +v[1],
        h: +v[2],
        o: +v[3],
        c: +v[4],
        v: +v[5]
      });
    }
  }

  return [
    ...new Map(
      all.filter(
        b =>
          b.t + 300 <= Math.floor(Date.now() / 1000) &&
          [b.t, b.l, b.h, b.o, b.c].every(Number.isFinite)
      ).map(b => [b.t, b])
    ).values()
  ].sort((a, b) => a.t - b.t).slice(-n);
}
