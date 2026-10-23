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
  return {
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
