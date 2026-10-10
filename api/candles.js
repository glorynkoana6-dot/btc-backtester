 'use strict';

const INTERVAL_MS = Object.freeze({
  '1min': 60_000,
  '5min': 300_000,
  '15min': 900_000,
  '30min': 1_800_000,
  '1h': 3_600_000
});

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );
  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return send(res, 405, {
      error: 'GET only.'
    });
  }

  const key = process.env.TWELVE_DATA_API_KEY;

  if (!key) {
    return send(res, 500, {
      error:
        'Set TWELVE_DATA_API_KEY in Vercel environment variables.'
    });
  }

  const interval = String(
    req.query?.interval || '15min'
  );

  const count = Number(
    req.query?.count || 5000
  );

  if (
    !Object.hasOwn(INTERVAL_MS, interval) ||
    !Number.isInteger(count) ||
    count < 600 ||
    count > 5000
  ) {
    return send(res, 400, {
      error:
        'Allowed intervals: 1min, 5min, 15min, 30min, 1h. Candles: 600–5000.'
    });
  }

  const params = new URLSearchParams({
    symbol: 'XAU/USD',
    interval,
    outputsize: String(count),
    timezone: 'UTC',
    order: 'asc',
    apikey: key
  });

  const abort = new AbortController();

  const timer = setTimeout(
    () => abort.abort(),
    18_000
  );

  try {
    const upstream = await fetch(
      `https://api.twelvedata.com/time_series?${params}`,
      {
        signal: abort.signal,
        headers: {
          Accept: 'application/json'
        }
      }
    );

    const data = await upstream.json();

    if (
      !upstream.ok ||
      data.status === 'error' ||
      !Array.isArray(data.values)
    ) {
      const message =
        typeof data.message === 'string'
          ? data.message
          : 'Twelve Data did not return candles.';

      return send(
        res,
        upstream.status === 429 ||
        data.code === 429
          ? 429
          : 502,
        {
          error: message,
          providerCode:
            data.code || upstream.status
        }
      );
    }

    const clean = [];
    let rejected = 0;

    const now = Date.now();
    const ms = INTERVAL_MS[interval];

    for (const x of data.values) {
      const raw = String(
        x.datetime || ''
      )
        .trim()
        .replace(' ', 'T');

      const time = Date.parse(
        /(?:Z|[+-]\d\d:\d\d)$/.test(raw)
          ? raw
          : `${raw}Z`
      );

      const open = Number(x.open);
      const high = Number(x.high);
      const low = Number(x.low);
      const close = Number(x.close);

      if (
        ![
          time,
          open,
          high,
          low,
          close
        ].every(Number.isFinite) ||
        low <= 0 ||
        low > Math.min(open, close) ||
        high < Math.max(open, close) ||
        high < low ||
        time + ms > now
      ) {
        rejected++;
        continue;
      }

      clean.push({
        time,
        open,
        high,
        low,
        close
      });
    }

    clean.sort(
      (a, b) => a.time - b.time
    );

    const bars = clean.filter(
      (x, i) =>
        i === 0 ||
        x.time !== clean[i - 1].time
    );

    if (bars.length < 300) {
      return send(res, 422, {
        error:
          `Only ${bars.length} completed valid candles received. ` +
          'Try CSV import or a different timeframe.',
        rejected
      });
    }

    return send(res, 200, {
      symbol: 'XAU/USD',
      interval,
      source: 'Twelve Data',
      requested: count,
      received: bars.length,
      rejected,
      serverTime:
        new Date(now).toISOString(),
      latestCandleTime:
        new Date(
          bars[bars.length - 1].time
        ).toISOString(),
      bars
    });

  } catch (error) {
    return send(res, 502, {
      error:
        error.name === 'AbortError'
          ? 'Twelve Data request timed out.'
          : 'Failed to retrieve Twelve Data candles.'
    });

  } finally {
    clearTimeout(timer);
  }
};