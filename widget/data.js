import AsyncStorage from '@react-native-async-storage/async-storage';
const BASE = 'https://api.koios.rest/api/v1';
export const POOL_ID = 'pool154xmvhp4jnz7phwcla09uvzqnn3ch54lh2yzrt2znxdgc4trp8x';
export const TICKER = 'LEAP';

async function get(path) {
  const r = await fetch(BASE + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('Koios ' + r.status);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Koios ' + r.status);
  return r.json();
}

const ada = (v) => Number(v || 0) / 1e6;
export function human(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'm';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toFixed(1);
}

export async function loadWidgetData(poolId = POOL_ID) {
  const tip = (await get('/tip'))[0];
  const [ep, pool, blocks] = await Promise.all([
    get('/epoch_info?_epoch_no=' + tip.epoch_no).then((r) => r[0]),
    post('/pool_info', { _pool_bech32_ids: [poolId] }).then((r) => r[0]),
    get('/pool_blocks?_pool_bech32=' + poolId + '&_epoch_no=' + tip.epoch_no).catch(() => []),
  ]);
  const end = ep.end_time || ep.start_time + 5 * 86400;
  const left = Math.max(0, end - Date.now() / 1000);
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const logoUrl = await getPoolLogoUrl(pool);
  return {
    logoUrl,
    ticker: (pool.meta_json && pool.meta_json.ticker) || TICKER,
    lifetimeBlocks: pool.block_count || 0,
    epoch: tip.epoch_no,
    endsIn: days + 'd ' + hours + 'h',
    networkBlocks: ep.blk_count,
    epochBlocks: blocks.length,
    delegators: pool.live_delegators || 0,
    saturation: Number(pool.live_saturation || 0),
    liveStake: human(ada(pool.live_stake)),
    activeStake: human(ada(pool.active_stake)),
    livePledge: human(ada(pool.live_pledge)),
    declPledge: human(ada(pool.pledge)),
    margin: (Number(pool.margin || 0) * 100).toFixed(2).replace(/\.?0+$/, '') + '%',
    fixedFee: ada(pool.fixed_cost).toFixed(0) + ' ADA',
  };
}

const fixUrl = (u) => (!u ? null : u.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + u.slice(7).replace(/^ipfs\//, '') : u.replace(/^http:/, 'https:'));
async function getJson(url, ms = 6000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}
// Pool logo from CIP-6 extended metadata; returns null when the pool has none.
export async function getPoolLogoUrl(pool) {
  try {
    let ext = pool.meta_json && pool.meta_json.extended;
    if (!ext && pool.meta_url) {
      const m = await getJson(fixUrl(pool.meta_url));
      ext = m && m.extended;
    }
    if (!ext) return null;
    const e = await getJson(fixUrl(ext));
    const info = (e && e.info) || e || {};
    return fixUrl(info.url_png_icon_64x64 || info.url_png_logo || null);
  } catch (err) {
    return null;
  }
}

const fmtNum = (n) => {
  if (n == null) return '–';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.1) return n.toFixed(3);
  return n.toFixed(4);
};

// Price + 24h change for one CoinGecko coin id. Falls back to the last good value if the request fails.
export async function loadPrice(id) {
  const key = 'price:' + id;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + id + '&price_change_percentage=24h');
    if (!r.ok) throw new Error('CoinGecko ' + r.status);
    const row = (await r.json())[0];
    if (!row) throw new Error('No data for ' + id);
    const d = {
      price: '$' + fmtNum(row.current_price),
      change: row.price_change_percentage_24h == null ? 0 : row.price_change_percentage_24h,
      rank: row.market_cap_rank,
      low: fmtNum(row.low_24h),
      high: fmtNum(row.high_24h),
      image: row.image,
    };
    try { await AsyncStorage.setItem(key, JSON.stringify(d)); } catch (e) {}
    return d;
  } catch (err) {
    try {
      const cached = JSON.parse(await AsyncStorage.getItem(key));
      if (cached) return { ...cached, stale: true };
    } catch (e) {}
    throw err;
  }
}
