// MKAYFX BLACKBOOK X1
// Optional XAU/USD spot gold quote.
// The API key remains on Vercel's server.

const TD_URL =
  'https://api.twelvedata.com/time_series';

export default async function handler(req, res) {
  res.setHeader(
    'Cache-Control',
    'no-store, max-age=0'
  );

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  const key =
    process.env.TWELVE_DATA_API_KEY;

  if (!key) {
    return res.status(503).json({
      ok: false,
      error:
        'XAU/USD optional feed not configured. ' +
        'Add TWELVE_DATA_API_KEY on Vercel.'
    });
  }

  try {
    const url = new URL(TD_URL);

    url.searchParams.set(
      'symbol',
      'XAU/USD'
    );

    url.searchParams.set(
      'interval',
      '1min'
    );

    url.searchParams.set(
      'outputsize',
      '2'
    );

    url.searchParams.set(
      'apikey',
      key
    );

    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store'
    });

    const data =
      await response.json();

    if (
      !response.ok ||
      data.status === 'error' ||
      !Array.isArray(data.values) ||
      !data.values[0]
    ) {
      return res.status(502).json({
        ok: false,
        error:
          data.message ||
          'Twelve Data returned no usable XAU/USD candles.'
      });
    }

    const latest = data.values[0];

    const price =
      Number(latest.close);

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return res.status(502).json({
        ok: false,
        error: 'XAU/USD quote is invalid.'
      });
    }

    return res.status(200).json({
      ok: true,
      symbol: 'XAU/USD',
      provider: 'Twelve Data',
      price,
      candleTime: latest.datetime,
      providerTimezone:
        data.meta?.exchange_timezone ||
        'Provider time',
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    return res.status(502).json({
      ok: false,
      error:
        'Spot feed request failed or timed out.'
    });
  }
}