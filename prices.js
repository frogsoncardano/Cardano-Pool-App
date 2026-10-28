import AsyncStorage from '@react-native-async-storage/async-storage';

// One shared place that fetches prices for the Epoch screen, the price widgets and the price alerts.
// Goals: never show an error when we have an older price, send as few requests as possible, and keep working
// when CoinGecko says "429 too many requests" (very common on phone networks that share one IP address).
//
// Order of sources: CoinGecko (also gives rank and logo) -> Binance -> CryptoCompare.
// Anything fetched is cached, and the cache is reused by every screen/widget for 90 seconds.

export const COINS = [
  { id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', binance: 'BTCUSDT' },
  { id: 'cardano', sym: 'ADA', name: 'Cardano', binance: 'ADAUSDT' },
  { id: 'midnight-3', sym: 'NIGHT', name: 'Midnight', binance: 'NIGHTUSDT' },
];

const CACHE_KEY = 'prices:cache:v2';
const BLOCK_KEY = 'prices:coingecko-blocked-until';
const FRESH_MS = 90e3;
const DEFAULT_BACKOFF_S = 120;

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

async function timedFetch(url, ms = 10000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    return await fetch(url, ctl ? { signal: ctl.signal } : undefined);
  } finally {
    clearTimeout(t);
  }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
// keep only keys that have a real value, so a missing field never overwrites a good cached one
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

async function fromCoinGecko() {
  const ids = COINS.map((c) => c.id).join(',');
  const r = await timedFetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`);
  if (r.status === 429) {
    const err = new Error('CoinGecko rate limit');
    err.retryAfter = Number(r.headers && r.headers.get && r.headers.get('retry-after')) || DEFAULT_BACKOFF_S;
    err.rateLimited = true;
    throw err;
  }
  if (!r.ok) throw new Error('CoinGecko ' + r.status);
  const rows = await r.json();
  return rows.map((x) => clean({
    id: x.id,
    current_price: num(x.current_price),
    price_change_percentage_24h: num(x.price_change_percentage_24h),
    low_24h: num(x.low_24h),
    high_24h: num(x.high_24h),
    market_cap_rank: num(x.market_cap_rank),
    image: x.image,
  }));
}

async function fromBinance(coins) {
  const out = [];
  await Promise.all(coins.map(async (c) => {
    try {
      const r = await timedFetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${c.binance}`);
      if (!r.ok) return;
      const x = await r.json();
      out.push(clean({ id: c.id, current_price: num(x.lastPrice), price_change_percentage_24h: num(x.priceChangePercent), low_24h: num(x.lowPrice), high_24h: num(x.highPrice) }));
    } catch (e) {}
  }));
  return out;
}

async function fromCryptoCompare(coins) {
  const r = await timedFetch(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${coins.map((c) => c.sym).join(',')}&tsyms=USD`);
  if (!r.ok) throw new Error('CryptoCompare ' + r.status);
  const raw = (await r.json()).RAW || {};
  return coins.map((c) => {
    const x = raw[c.sym] && raw[c.sym].USD;
    return x ? clean({ id: c.id, current_price: num(x.PRICE), price_change_percentage_24h: num(x.CHANGEPCT24HOUR), low_24h: num(x.LOW24HOUR), high_24h: num(x.HIGH24HOUR) }) : null;
  }).filter(Boolean);
}

export const readCachedPrices = async () => {
  const c = await readJson(CACHE_KEY, null);
  return c && Array.isArray(c.rows) ? c : null;
};

let inflight = null;

// Returns { rows, at, stale }. Throws only if there is no price at all (first launch, offline).
export async function getPrices({ maxAgeMs = FRESH_MS, force = false, now = Date.now() } = {}) {
  const cache = await readCachedPrices();
  if (!force && cache && now - cache.at < maxAgeMs) return { rows: cache.rows, at: cache.at, stale: false };
  if (inflight) return inflight;
  inflight = refresh(cache, now).finally(() => { inflight = null; });
  return inflight;
}

async function refresh(cache, now) {
  const got = {};
  const take = (rows) => {
    for (const r of rows || []) if (r && r.current_price !== undefined) got[r.id] = { ...(got[r.id] || {}), ...r };
  };
  const missing = () => COINS.filter((c) => !got[c.id]);

  const blockedUntil = Number(await AsyncStorage.getItem(BLOCK_KEY).catch(() => 0)) || 0;
  if (now >= blockedUntil) {
    try {
      take(await fromCoinGecko());
    } catch (e) {
      if (e && e.rateLimited) await AsyncStorage.setItem(BLOCK_KEY, String(now + e.retryAfter * 1000)).catch(() => {});
    }
  }
  if (missing().length) { try { take(await fromBinance(missing())); } catch (e) {} }
  if (missing().length) { try { take(await fromCryptoCompare(missing())); } catch (e) {} }

  if (Object.keys(got).length === 0) {
    if (cache) return { rows: cache.rows, at: cache.at, stale: true };
    throw new Error('Prices are unavailable right now');
  }
  const old = (cache && cache.rows) || [];
  const rows = COINS.map((c) => ({ ...c, ...(old.find((r) => r.id === c.id) || {}), ...(got[c.id] || {}) }));
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, rows })).catch(() => {});
  return { rows, at: now, stale: false };
}
