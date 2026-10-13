import { analyze } from "../lib/engine.js";

const TD = "https://api.twelvedata.com/time_series";

const CONFIG = [
  {
    id: "M1",
    interval: "1min",
    size: 180,
    ttl: 60000,
    primary: 0
  },
  {
    id: "M5",
    interval: "5min",
    size: 800,
    ttl: 150000,
    primary: 1
  },
  {
    id: "M15",
    interval: "15min",
    size: 280,
    ttl: 330000,
    primary: 2
  },
  {
    id: "H1",
    interval: "1h",
    size: 240,
    ttl: 900000,
    primary: 3
  },
  {
    id: "H4",
    interval: "4h",
    size: 130,
    ttl: 3600000,
    primary: 3
  }
];

const cache =
  globalThis.__bbx4_cache ||
  (globalThis.__bbx4_cache = new Map());

const inflight =
  globalThis.__bbx4_pending ||
  (globalThis.__bbx4_pending = new Map());

function parseTime(s) {
  const value = Date.parse(s.replace(" ", "T") + "Z");

  return Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

function normalize(values) {
  return values
    .map(x => ({
      t: parseTime(x.datetime),
      o: Number(x.open),
      h: Number(x.high),
      l: Number(x.low),
      c: Number(x.close),
      v: Number(x.volume) || 0
    }))
    .filter(x =>
      x.t &&
      [x.o, x.h, x.l, x.c].every(Number.isFinite) &&
      x.l <= x.h
    )
    .sort((a, b) => a.t.localeCompare(b.t))
    .filter((x, i, a) =>
      i === 0 || x.t !== a[i - 1].t
    );
}

async function getFeed(f, keys) {
  const found = cache.get(f.id);
  const now = Date.now();

  if (found && now - found.fetched < f.ttl) {
    return {
      ...found,
      status: "CACHED"
    };
  }

  if (inflight.has(f.id)) {
    return inflight.get(f.id);
  }

  const task = (async () => {
    const attempts = [
      keys[f.primary],
      ...keys.filter((k, i) => i !== f.primary)
    ].filter(Boolean);

    let error = "No API keys configured";

    for (const key of [...new Set(attempts)]) {
      try {
        const u = new URL(TD);

        u.searchParams.set("symbol", "XAU/USD");
        u.searchParams.set("interval", f.interval);
        u.searchParams.set("outputsize", String(f.size));
        u.searchParams.set("timezone", "UTC");
        u.searchParams.set("apikey", key);

        const response = await fetch(u, {
          signal: AbortSignal.timeout(11500),
          headers: {
            Accept: "application/json"
          }
        });

        const json = await response.json();

        if (
          !response.ok ||
          json.status === "error" ||
          !Array.isArray(json.values)
        ) {
          throw new Error(
            json.message ||
            `Provider HTTP ${response.status}`
          );
        }

        const data = normalize(json.values);

        if (data.length < 2) {
          throw new Error("Provider returned too few candles");
        }

        const item = {
          data,
          fetched: Date.now(),
          status: "LIVE",
          source: "Twelve Data"
        };

        cache.set(f.id, item);

        return item;

      } catch (e) {
        error = String(e.message || e).slice(0, 160);
      }
    }

    if (
      found &&
      now - found.fetched < Math.max(f.ttl * 5, 7200000)
    ) {
      return {
        ...found,
        status: "STALE",
        error
      };
    }

    return {
      data: [],
      fetched: null,
      status: "ERROR",
      error
    };
  })();

  inflight.set(f.id, task);

  try {
    return await task;
  } finally {
    inflight.delete(f.id);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const keys = [
    "TWELVE_DATA_API_KEY",
    "TWELVE_DATA_API_KEY_2",
    "TWELVE_DATA_API_KEY_3",
    "TWELVE_DATA_API_KEY_4"
  ].map(k => process.env[k]);

  if (!keys.some(Boolean)) {
    return res.status(503).json({
      error:
        "Add TWELVE_DATA_API_KEY and optional keys 2–4 in Vercel environment variables."
    });
  }

  try {
    const results = await Promise.all(
      CONFIG.map(f => getFeed(f, keys))
    );

    const feeds = Object.fromEntries(
      CONFIG.map((f, i) => [
        f.id,
        results[i].data
      ])
    );

    const health = CONFIG.map((f, i) => ({
      timeframe: f.id,
      status: results[i].status,

      lastRequest: results[i].fetched
        ? new Date(results[i].fetched).toISOString()
        : null,

      lastBar:
        results[i].data.at(-1)?.t || null,

      error: results[i].error || null
    }));

    if (feeds.M5.length < 95) {
      return res.status(503).json({
        error: "Not enough M5 data to analyze.",
        health
      });
    }

    const q = req.query || {};

    const report = analyze(feeds, {
      threshold: q.threshold,
      rr: q.rr,
      cost: q.cost
    });

    // Do not issue signals from failed critical feeds.

    if (
      ["STALE", "ERROR"].includes(results[0].status) ||
      ["STALE", "ERROR"].includes(results[1].status)
    ) {
      report.signal = null;
      report.decision = "WAIT";
      report.reason =
        "Critical Twelve Data feed failed; no new signals allowed";
      report.fresh = false;
    }

    return res.status(200).json({
      ...report,
      health
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message || "XAU engine error"
    });
  }
}