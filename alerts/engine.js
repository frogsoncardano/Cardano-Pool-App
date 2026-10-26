import AsyncStorage from '@react-native-async-storage/async-storage';

// Alert engine: compares what Koios / CoinGecko say now with what we saw last time, and calls notify()
// for anything new. It runs when the app is open (every minute), in the background (Android decides,
// roughly every 15+ minutes) and whenever a home-screen widget refreshes.

const KOIOS = 'https://api.koios.rest/api/v1';
const SETTINGS_KEY = 'alerts:settings';
const STATE_KEY = 'alerts:state';

export const DEFAULT_SETTINGS = { proposals: true, blocks: true, poolHealth: true, rewards: true, priceMoves: false };

const COINS = [
  { id: 'cardano', sym: 'ADA' },
  { id: 'bitcoin', sym: 'BTC' },
  { id: 'midnight-3', sym: 'NIGHT' },
];
const PRICE_MOVE_PCT = 10;
const SATURATION_PCT = 95;

// How often each check may hit the network (ms). "blocks" is cheap and time-sensitive, the rest is not.
const EVERY = { proposals: 10 * 60e3, blocks: 0, poolHealth: 10 * 60e3, rewards: 30 * 60e3, priceMoves: 30 * 60e3 };

let running = false;

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
const writeJson = (key, value) => AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});

async function withTimeout(promise, ms = 15000) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out')), ms))]);
}
async function jget(url) {
  const r = await withTimeout(fetch(url, { headers: { accept: 'application/json' } }));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function jpost(path, body) {
  const r = await withTimeout(fetch(KOIOS + path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(await readJson(SETTINGS_KEY, {})) };
}
export const saveSettings = (s) => writeJson(SETTINGS_KEY, s);
export const resetAlertState = () => AsyncStorage.removeItem(STATE_KEY).catch(() => {});

const ada = (v) => Number(v || 0) / 1e6;
const fmtAda = (v) => Math.round(ada(v)).toLocaleString('en-US') + ' \u20B3';
const short = (s, n = 6) => (s && s.length > n * 2 + 3 ? s.slice(0, n) + '\u2026' + s.slice(-n) : s || '');
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---- governance helpers (same rules as the Governance tab) ----
const proposalId = (p) => p.proposal_id || `${p.proposal_tx_hash}#${p.proposal_index}`;
const isActive = (p) => p.enacted_epoch == null && p.ratified_epoch == null && p.dropped_epoch == null && p.expired_epoch == null;
const TYPE = { ParameterChange: 'Parameter change', HardForkInitiation: 'Hard fork', TreasuryWithdrawals: 'Treasury withdrawal', NoConfidence: 'No confidence', NewCommittee: 'Update committee', NewConstitution: 'New constitution', InfoAction: 'Info action' };
function proposalTitle(p) {
  const m = (p && p.meta_json) || {};
  const b = m.body || m;
  return (b && typeof b.title === 'string' && b.title.trim()) || null;
}
function requested(p) {
  const w = p && p.withdrawal;
  const list = !w ? [] : Array.isArray(w) ? w : [w];
  return list.reduce((s, x) => s + Number(x.amount || 0), 0);
}

async function checkProposals(state, fire) {
  const rows = await jget(KOIOS + '/proposal_list?order=proposed_epoch.desc&limit=40');
  const prev = state.proposals || { init: false, seen: [] };
  const seen = new Set(prev.seen);
  if (prev.init) {
    const fresh = rows.filter((p) => !seen.has(proposalId(p)) && isActive(p));
    if (fresh.length > 3) {
      await fire('governance', `${fresh.length} new governance proposals`, 'Open the Governance tab to see what they ask for.');
    } else {
      for (const p of fresh) {
        const req = requested(p);
        const kind = TYPE[p.proposal_type] || p.proposal_type || 'Governance action';
        await fire('governance', 'New governance proposal', `${proposalTitle(p) || kind}${req > 0 ? ' \u2014 asks ' + fmtAda(req) : ''}`);
      }
    }
  }
  state.proposals = { init: true, seen: [...new Set([...rows.map(proposalId), ...prev.seen])].slice(0, 300) };
}

async function checkBlocks(state, fire, pools) {
  state.blocks = state.blocks || {};
  for (const pool of pools) {
    const rows = await jget(`${KOIOS}/pool_blocks?_pool_bech32=${pool.id}`);
    const prev = state.blocks[pool.id];
    const seen = new Set(prev ? prev.seen : []);
    if (prev) {
      const fresh = rows.filter((b) => !seen.has(b.block_hash)).sort((a, b) => a.block_height - b.block_height);
      if (fresh.length > 3) {
        await fire('blocks', `${pool.ticker || 'Your pool'} minted ${fresh.length} blocks`, `Latest: block #${fresh[fresh.length - 1].block_height}`);
      } else {
        for (const b of fresh) await fire('blocks', `${pool.ticker || 'Your pool'} minted a block`, `Block #${b.block_height} \u00B7 epoch ${b.epoch_no}`);
      }
    }
    state.blocks[pool.id] = { seen: [...new Set([...rows.map((b) => b.block_hash), ...(prev ? prev.seen : [])])].slice(0, 80) };
  }
}

async function checkPoolHealth(state, fire, pools) {
  if (!pools.length) return;
  state.pools = state.pools || {};
  const infos = await jpost('/pool_info', { _pool_bech32_ids: pools.map((p) => p.id) });
  for (const info of infos || []) {
    const id = info.pool_id_bech32;
    const name = (info.meta_json && info.meta_json.ticker) || (pools.find((p) => p.id === id) || {}).ticker || short(id);
    const prev = state.pools[id];
    const sat = Number(info.live_saturation || 0);
    const snap = {
      margin: Number(info.margin || 0).toFixed(6),
      fixed: String(info.fixed_cost || 0),
      retiring: info.retiring_epoch == null ? null : info.retiring_epoch,
      satHigh: prev ? prev.satHigh : sat >= SATURATION_PCT,
    };
    if (prev) {
      if (snap.margin !== prev.margin) await fire('pools', `${name} changed its margin`, `${(Number(prev.margin) * 100).toFixed(2)}% \u2192 ${(Number(snap.margin) * 100).toFixed(2)}%`);
      if (snap.fixed !== prev.fixed) await fire('pools', `${name} changed its fixed fee`, `${fmtAda(prev.fixed)} \u2192 ${fmtAda(snap.fixed)} per epoch`);
      if (snap.retiring != null && prev.retiring == null) await fire('pools', `${name} is retiring`, `The pool retires after epoch ${snap.retiring}. Delegators should pick a new pool.`);
      if (sat >= SATURATION_PCT && !prev.satHigh) await fire('pools', `${name} is nearly saturated`, `Saturation is ${sat.toFixed(1)}%. Rewards shrink above 100%.`);
    }
    snap.satHigh = sat >= SATURATION_PCT ? true : sat < SATURATION_PCT - 5 ? false : snap.satHigh;
    state.pools[id] = snap;
  }
}

async function checkRewards(state, fire) {
  const stake = await AsyncStorage.getItem('wallet:stake').catch(() => null);
  if (!stake) return;
  const res = await jpost('/account_rewards', { _stake_addresses: [stake] });
  const rows = (res && res[0] && res[0].rewards) || [];
  if (!rows.length) { state.rewards = { stake, lastEpoch: state.rewards && state.rewards.stake === stake ? state.rewards.lastEpoch : 0 }; return; }
  const latest = Math.max(...rows.map((r) => Number(r.earned_epoch)));
  const prev = state.rewards;
  if (prev && prev.stake === stake && latest > prev.lastEpoch) {
    const fresh = rows.filter((r) => Number(r.earned_epoch) > prev.lastEpoch);
    const total = fresh.reduce((s, r) => s + Number(r.amount || 0), 0);
    const text = ada(total).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' \u20B3';
    await fire('rewards', 'Staking rewards received', fresh.length > 1 ? `+${text} for epochs ${prev.lastEpoch + 1}\u2013${latest}` : `+${text} for epoch ${latest}`);
  }
  state.rewards = { stake, lastEpoch: latest };
}

async function checkPriceMoves(state, fire, now) {
  const rows = await jget(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${COINS.map((c) => c.id).join(',')}&price_change_percentage=24h`);
  state.prices = state.prices || {};
  for (const c of COINS) {
    const row = rows.find((x) => x.id === c.id);
    const ch = row && row.price_change_percentage_24h;
    if (ch != null && Math.abs(ch) >= PRICE_MOVE_PCT && state.prices[c.id] !== dayOf(now)) {
      state.prices[c.id] = dayOf(now);
      await fire('prices', `${c.sym} ${ch >= 0 ? 'up' : 'down'} ${Math.abs(ch).toFixed(1)}% in 24h`, `Now $${row.current_price}`);
    }
  }
}

// Runs every enabled check. Returns { fired, skipped }.
// minGapMs: skip entirely if we ran more recently than this (stops widgets / background / foreground from piling up).
// force: ignore both the gap and the per-check schedule ("Check now" button).
export async function runAlertChecks({ notify, minGapMs = 4 * 60e3, force = false, now = Date.now() } = {}) {
  if (running) return { fired: [], skipped: 'busy' };
  const state = await readJson(STATE_KEY, {});
  if (!force && state.lastRun && now - state.lastRun < minGapMs) return { fired: [], skipped: 'recent' };
  running = true;
  const fired = [];
  const fire = async (channel, title, body) => {
    fired.push({ channel, title, body });
    try { await notify(title, body, channel); } catch (e) {}
  };
  try {
    const settings = await loadSettings();
    const favs = await readJson('fav:pools', []);
    const pools = favs.filter((f) => f && f.id);
    state.next = state.next || {};
    const due = (key) => force || !state.next[key] || now >= state.next[key];
    const run = async (key, enabled, fn) => {
      if (!enabled || !due(key)) return;
      try {
        await fn();
        state.next[key] = now + EVERY[key];
      } catch (e) { /* try again next time */ }
    };
    await run('proposals', settings.proposals, () => checkProposals(state, fire));
    await run('blocks', settings.blocks && pools.length > 0, () => checkBlocks(state, fire, pools));
    await run('poolHealth', settings.poolHealth && pools.length > 0, () => checkPoolHealth(state, fire, pools));
    await run('rewards', settings.rewards, () => checkRewards(state, fire));
    await run('priceMoves', settings.priceMoves, () => checkPriceMoves(state, fire, now));
  } finally {
    state.lastRun = now;
    await writeJson(STATE_KEY, state);
    running = false;
  }
  return { fired, skipped: null };
}
