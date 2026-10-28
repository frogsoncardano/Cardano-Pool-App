import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, runAlertChecks, resetAlertState } from "./alerts/engine";
import { notify, notificationsAllowed, askNotificationPermission } from "./alerts/notify";
import * as Clipboard from "expo-clipboard";
import { DAPP_URL } from "./config";
import { getPrices, readCachedPrices } from "./prices";
const POOL_ID = "pool154xmvhp4jnz7phwcla09uvzqnn3ch54lh2yzrt2znxdgc4trp8x";
const KOIOS_BASE = "https://api.koios.rest/api/v1";
const KOIOS_TOKEN = "";
const EPOCH_SECONDS = 5 * 24 * 3600;
const colors = {
  bg: "#0B1410",
  card: "#14221B",
  border: "#1F3328",
  green: "#4ADE80",
  lime: "#A3E635",
  text: "#ECFDF5",
  muted: "#86A595",
  warn: "#FBBF24",
  danger: "#F87171"
};
const headers = { accept: "application/json", "content-type": "application/json" };
if (KOIOS_TOKEN) headers.authorization = `Bearer ${KOIOS_TOKEN}`;
async function get(path) {
  const r = await fetch(KOIOS_BASE + path, { headers });
  if (!r.ok) throw new Error(`Koios ${r.status}`);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(KOIOS_BASE + path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Koios ${r.status}`);
  return r.json();
}
const ada = (v) => Number(v ?? 0) / 1e6;
const fmtAda = (v, d = 0) => ada(v).toLocaleString("en-US", { maximumFractionDigits: d }) + " \u20B3";
const short = (s2, n = 8) => s2 && s2.length > n * 2 + 3 ? `${s2.slice(0, n)}\u2026${s2.slice(-n)}` : s2;
const getTip = () => get("/tip").then((r) => r[0]);
const getEpoch = (n) => get(`/epoch_info?_epoch_no=${n}`).then((r) => r[0]);
const getPoolInfo = (id) => post("/pool_info", { _pool_bech32_ids: [id] }).then((r) => r[0]);
const getPoolHistory = (id) => get(`/pool_history?_pool_bech32=${id}`);
// pool_blocks with no filters returns the pool's OLDEST blocks (Koios caps it at 1000 rows), so always ask for what we need.
const getPoolBlocksRecent = (id, n = 15) => get(`/pool_blocks?_pool_bech32=${id}&order=block_height.desc&limit=${n}`);
const getPoolBlocksEpoch = (id, epoch) => get(`/pool_blocks?_pool_bech32=${id}&_epoch_no=${epoch}`);
const getDelegators = (id) => get(`/pool_delegators?_pool_bech32=${id}`);
const getRetiringPools = () => get("/pool_list?pool_status=eq.retiring&order=retiring_epoch.asc&limit=50");
const searchPools = (q) => get(`/pool_list?ticker=ilike.*${encodeURIComponent(q)}*&limit=30`);
async function resolveStake(input) {
  const v = input.trim();
  if (v.startsWith("stake1")) return v;
  if (v.startsWith("addr1")) {
    const r = await post("/address_info", { _addresses: [v] });
    if (r?.[0]?.stake_address) return r[0].stake_address;
  }
  throw new Error("Enter a valid stake1\u2026 or addr1\u2026 address");
}
const getAccount = (stake) => post("/account_info", { _stake_addresses: [stake] }).then((r) => r[0]);
const getAccountRewards = (stake) => post("/account_rewards", { _stake_addresses: [stake] }).then((r) => r[0]?.rewards ?? []);
// Koios >= 1.1 returns one row per asset; older versions nested them in asset_list. Handle both.
const getAccountAssets = async (stake) => {
  const r = await post("/account_assets", { _stake_addresses: [stake] });
  const rows = [];
  for (const row of r || []) {
    if (Array.isArray(row.asset_list)) rows.push(...row.asset_list);
    else if (row.policy_id) rows.push(row);
  }
  return rows;
};
const CIP68_PREFIXES = ["000de140", "000643b0", "0014df10", "001bc280"];
function assetLabel(a) {
  if (a.asset_name_ascii) return a.asset_name_ascii;
  let hex = a.asset_name || "";
  if (CIP68_PREFIXES.some((p) => hex.startsWith(p))) hex = hex.slice(8);
  if (!hex) return short(a.fingerprint || a.policy_id || "?", 6);
  let txt = "";
  for (let i = 0; i + 1 < hex.length; i += 2) txt += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return /^[\x20-\x7e]+$/.test(txt) ? txt : short(a.fingerprint || hex, 6);
}
function fmtQty(q, decimals) {
  const d = Number(decimals) || 0;
  const n = Number(q) / Math.pow(10, d);
  return isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: Math.min(d, 6) }) : String(q);
}

// Groups a wallet's NFTs by policy and names each collection from its asset names ("Frog #12", "Frog #13" -> "Frog").
const nftBase = (n) => n.replace(/[\s#_\-.]*\d+\s*$/, "").replace(/[\s#_\-.]+$/, "").trim();
const commonPrefix = (names) => {
  let p = names[0] || "";
  for (const n of names) while (p && !n.startsWith(p)) p = p.slice(0, -1);
  return p.replace(/[\s#_\-.]+$/, "").trim();
};
const nftLabel = (a) => a.policy_id === HANDLE_POLICY ? "$" + assetLabel(a) : assetLabel(a);
function groupNfts(nfts) {
  const byPolicy = {};
  for (const a of nfts) (byPolicy[a.policy_id] = byPolicy[a.policy_id] || []).push(a);
  const groups = Object.entries(byPolicy).map(([policy, list]) => {
    const items = [...list].sort((x, y) => nftLabel(x).localeCompare(nftLabel(y), "en", { numeric: true }));
    let name;
    if (policy === HANDLE_POLICY) name = "ADA Handles";
    else if (items.length === 1) name = nftLabel(items[0]);
    else {
      const bases = items.map((a) => nftBase(assetLabel(a))).filter(Boolean);
      const counts = {};
      for (const b of bases) counts[b] = (counts[b] || 0) + 1;
      const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
      if (top && top[1] >= items.length / 2) name = top[0];
      else { const lcp = commonPrefix(bases); name = lcp.length >= 3 ? lcp : "Collection " + short(policy, 5); }
    }
    return { policy, name, items };
  });
  return groups.sort((x, y) => y.items.length - x.items.length || x.name.localeCompare(y.name));
}
const isNftAsset = (a) => String(a.quantity) === "1" && !(Number(a.decimals) > 0);

const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function b32Polymod(v) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let c = 1;
  for (const x of v) {
    const b = c >> 25;
    c = (c & 0x1ffffff) << 5 ^ x;
    for (let i = 0; i < 5; i++) if (b >> i & 1) c ^= G[i];
  }
  return c;
}
function hexToPoolBech32(hex) {
  const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
  let acc = 0, bits = 0;
  const d = [];
  for (const v of bytes) {
    acc = acc << 8 | v;
    bits += 8;
    while (bits >= 5) { bits -= 5; d.push(acc >> bits & 31); }
  }
  if (bits > 0) d.push(acc << 5 - bits & 31);
  const hrp = "pool";
  const exp = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  const pm = b32Polymod(exp.concat(d, [0, 0, 0, 0, 0, 0])) ^ 1;
  const cs = [];
  for (let i = 0; i < 6; i++) cs.push(pm >> 5 * (5 - i) & 31);
  return hrp + "1" + d.concat(cs).map((x) => B32[x]).join("");
}
// accepts pool1... (bech32) or a 56-char hex pool id; returns bech32 or null
const normalizePoolId = (q) => {
  const v = q.trim();
  if (/^pool1[0-9a-z]{50,60}$/i.test(v)) return v.toLowerCase();
  if (/^[0-9a-f]{56}$/i.test(v)) return hexToPoolBech32(v.toLowerCase());
  return null;
};
const human = (lovelace) => {
  const n = ada(lovelace);
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "m \u20B3";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k \u20B3";
  return n.toFixed(0) + " \u20B3";
};
const getPoolInfos = (ids) => ids.length ? post("/pool_info", { _pool_bech32_ids: ids }) : Promise.resolve([]);
// SPO search: ticker (partial) or pool id (pool1... / hex). Returns enriched pool_info rows, biggest stake first.
async function searchSpos(q) {
  const id = normalizePoolId(q);
  let ids;
  if (id) ids = [id];
  else {
    const list = await get(`/pool_list?ticker=ilike.*${encodeURIComponent(q.trim())}*&pool_status=eq.registered&limit=25`);
    ids = list.map((p) => p.pool_id_bech32);
  }
  const infos = await getPoolInfos(ids);
  return infos.sort((a, b) => Number(b.live_stake || 0) - Number(a.live_stake || 0));
}
const getLatestBlocks = (n = 15) => get(`/blocks?order=block_height.desc&limit=${n}`);

// ---------- prices (CoinGecko, no key needed) ----------
const fmtNum = (n) => {
  if (n == null) return "\u2014";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.1) return n.toFixed(3);
  return n.toFixed(4);
};
const fmtUsd = (n) => n == null ? "\u2014" : "$" + fmtNum(n);
// ---------- pool logos (CIP-6 extended metadata) ----------
const logoCache = {};
const fixUrl = (u) => !u ? null : u.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + u.slice(7).replace(/^ipfs\//, "") : u.replace(/^http:/, "https:");
async function fetchJsonTimeout(url, ms = 6e3) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function getPoolLogoUrl(p) {
  const id = p && p.pool_id_bech32;
  if (!id) return null;
  if (id in logoCache) return logoCache[id];
  let url = null;
  try {
    let ext = p.meta_json && p.meta_json.extended;
    if (!ext && p.meta_url) { const m = await fetchJsonTimeout(fixUrl(p.meta_url)); ext = m && m.extended; }
    if (ext) {
      const e = await fetchJsonTimeout(fixUrl(ext));
      const info = e && e.info || e || {};
      url = fixUrl(info.url_png_icon_64x64 || info.url_png_logo || null);
    }
  } catch (e) {}
  logoCache[id] = url;
  return url;
}
function PoolLogo({ pool, size = 36 }) {
  const [uri, setUri] = useState(null);
  useEffect(() => {
    let alive = true;
    getPoolLogoUrl(pool).then((u) => { if (alive) setUri(u); });
    return () => { alive = false; };
  }, [pool && pool.pool_id_bech32]);
  const t = pool && pool.meta_json && pool.meta_json.ticker || "?";
  if (uri) return <Image source={{ uri }} onError={() => setUri(null)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.border }} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.green, fontWeight: "800", fontSize: size * 0.36 }}>{String(t).slice(0, 2)}</Text>
    </View>;
}

// ---------- ADA Handle ($name) support ----------
const HANDLE_POLICY = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
const isHandle = (v) => /^\$?[a-z0-9_.-]{1,15}$/i.test(v.trim());
const asciiHex = (str) => [...str].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
// Finds the address currently holding the handle NFT. Tries the classic asset name, then the CIP-68 one (prefix 000de140).
async function handleHolderAddress(name) {
  const hex = asciiHex(name);
  for (const assetName of [hex, "000de140" + hex]) {
    try {
      const r = await get(`/asset_nft_address?_asset_policy=${HANDLE_POLICY}&_asset_name=${assetName}`);
      const a = r && r[0] && r[0].payment_address;
      if (a) return a;
    } catch (e) {}
    try {
      const r = await get(`/asset_addresses?_asset_policy=${HANDLE_POLICY}&_asset_name=${assetName}`);
      const row = (r || []).find((x) => Number(x.quantity ?? 1) > 0);
      if (row && row.payment_address) return row.payment_address;
    } catch (e) {}
  }
  // last resort: the public Handle API
  try {
    const r = await fetchJsonTimeout(`https://api.handle.me/handles/${name}`, 8e3);
    const a = r && (r.holder || r.resolved_addresses && r.resolved_addresses.ada);
    if (a) return a;
  } catch (e) {}
  return null;
}
// $handle, addr1... or stake1... -> { stake, handle }
async function resolveWallet(input) {
  const v = input.trim();
  if (v.startsWith("stake1")) return { stake: v, handle: null };
  if (v.startsWith("addr1")) return { stake: await resolveStake(v), handle: null };
  if (isHandle(v)) {
    const name = v.replace(/^\$/, "").toLowerCase();
    const addr = await handleHolderAddress(name);
    if (!addr) throw new Error(`Handle $${name} was not found`);
    if (addr.startsWith("stake1")) return { stake: addr, handle: "$" + name };
    try {
      return { stake: await resolveStake(addr), handle: "$" + name };
    } catch (e) {
      throw new Error(`$${name} is held by an address without a stake key, so its balance can't be tracked`);
    }
  }
  throw new Error("Enter a $handle, stake1\u2026 or addr1\u2026 address");
}
const HANDLE_KEY = "wallet:handle";

// ---------- governance (Conway era governance actions) ----------
const GOV_TYPES = {
  ParameterChange: "Parameter change",
  HardForkInitiation: "Hard fork",
  TreasuryWithdrawals: "Treasury withdrawal",
  NoConfidence: "No confidence",
  NewCommittee: "Update committee",
  NewConstitution: "New constitution",
  InfoAction: "Info action",
};
const govTypeLabel = (t) => GOV_TYPES[t] || t || "Unknown";
const govBody = (p) => { const m = p && p.meta_json || {}; return m.body || m; };
const govTitle = (p) => {
  const b = govBody(p);
  return b && typeof b.title === "string" && b.title.trim() || null;
};
const govText = (p, key) => { const b = govBody(p); return b && typeof b[key] === "string" ? b[key].trim() : ""; };
const govWithdrawals = (p) => { const w = p && p.withdrawal; return !w ? [] : Array.isArray(w) ? w : [w]; };
const govRequested = (p) => govWithdrawals(p).reduce((sum, x) => sum + Number(x.amount || 0), 0); // lovelace
const govStatus = (p) => p.enacted_epoch != null ? "Enacted" : p.ratified_epoch != null ? "Ratified" : p.dropped_epoch != null ? "Dropped" : p.expired_epoch != null ? "Expired" : "Active";
const govKey = (p) => p.proposal_id || `${p.proposal_tx_hash}#${p.proposal_index}`;
const getProposals = () => get("/proposal_list?order=proposed_epoch.desc&limit=100");
async function getVotingSummary(p) {
  const ids = [p.proposal_id, p.proposal_tx_hash != null ? `${p.proposal_tx_hash}#${p.proposal_index}` : null].filter(Boolean);
  let last = null;
  for (const id of ids) {
    try {
      const r = await get(`/proposal_voting_summary?_proposal_id=${encodeURIComponent(id)}`);
      if (r && r[0]) return r[0];
    } catch (e) { last = e; }
  }
  if (last) throw last;
  return null;
}

// ---------- rewards calculator + pool comparison ----------
// Average per-epoch reward rate for delegators, from pool_history. Epochs where Koios has no reward data
// (blocks minted but 0 rewards listed) are skipped; epochs with no blocks count as a real 0.
function poolRate(hist, curEpoch) {
  const rows = [...hist || []].filter((e) => curEpoch == null || e.epoch_no <= curEpoch - 2).sort((a, b) => b.epoch_no - a.epoch_no).slice(0, 12);
  let sum = 0, n = 0, gaps = 0;
  for (const e of rows) {
    const rew = rewardOf(e);
    const stake = Number(e.active_stake || 0);
    if (!(stake > 0)) continue;
    if (rew === 0 && (e.block_cnt || 0) > 0) { gaps++; continue; }
    sum += rew / stake;
    n++;
  }
  return { rate: n ? sum / n : null, epochs: n, gaps };
}
const aprOf = (rate) => rate == null ? null : rate * 73 * 100;
const apyOf = (rate) => rate == null ? null : (Math.pow(1 + rate, 73) - 1) * 100;
const pct2 = (n) => n == null ? "n/a" : n.toFixed(2) + "%";

// ---------- wallet actions (signed in the user's own wallet through the Frog Labs web app) ----------
function openWalletAction(params) {
  if (DAPP_URL.includes("YOUR-GITHUB-USERNAME")) {
    Alert.alert("Not set up yet", "Wallet actions need the Frog Labs web app. Set DAPP_URL in config.js after deploying it.");
    return;
  }
  const query = Object.keys(params).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
  const url = `${DAPP_URL}?${query}`;
  Alert.alert(
    "Continue in your wallet",
    "Cardano wallets sign transactions in their own browser. Copy this link and open it in your wallet's built-in browser (Eternl, Vespr, Begin and others have one). Frog Labs never sees your keys.",
    [
      { text: "Copy link", onPress: () => { Clipboard.setStringAsync(url).catch(() => {}); } },
      { text: "Open here", onPress: () => Linking.openURL(url).catch(() => {}) },
      { text: "Cancel", style: "cancel" },
    ]
  );
}
const FAV_KEY = "fav:pools";
const WIDGET_KEY = "widget:pool";
async function loadFavs() {
  try { return JSON.parse(await AsyncStorage.getItem(FAV_KEY)) || []; } catch (e) { return []; }
}

function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setError(e.message ?? "Error");
    }
    setLoading(false);
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { data, error, loading, reload: run };
}
function Screen({ children, onRefresh, refreshing }) {
  return <ScrollView
    style={{ flex: 1, backgroundColor: colors.bg }}
    contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
    refreshControl={onRefresh && <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
  >
      {children}
    </ScrollView>;
}
const Title = ({ children }) => <Text style={s.title}>{children}</Text>;
const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>;
const Row = ({ label, value, color }) => <View style={s.row}>
    <Text style={s.label}>{label}</Text>
    <Text style={[s.value, color ? { color } : null]}>{value}</Text>
  </View>;
const Stat = ({ label, value }) => <View style={s.stat}>
    <Text style={s.statValue}>{value}</Text>
    <Text style={s.label}>{label}</Text>
  </View>;
const Bar = ({ pct }) => <View style={s.barBg}>
    <View style={[s.barFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: pct > 95 ? colors.danger : pct > 80 ? colors.warn : colors.green }]} />
  </View>;
const Loading = () => <ActivityIndicator color={colors.green} style={{ marginTop: 40 }} />;
const ErrorText = ({ msg }) => <Text style={{ color: colors.danger, marginTop: 20 }}>{msg}</Text>;
const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 8, marginBottom: 8 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  label: { color: colors.muted, fontSize: 13 },
  value: { color: colors.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  stat: { flex: 1, alignItems: "center", paddingVertical: 6 },
  statValue: { color: colors.green, fontSize: 22, fontWeight: "800" },
  barBg: { height: 10, borderRadius: 6, backgroundColor: colors.border, overflow: "hidden", marginVertical: 8 },
  barFill: { height: 10, borderRadius: 6 }
});
const rewardOf = (e) => {
  const d = Number(e && e.deleg_rewards || 0);
  if (d > 0) return d;
  const m = Number(e && e.member_rewards || 0);
  return m > 0 ? m : 0;
};
function PoolDetail({ poolId }) {
  const info = useAsync(() => getPoolInfo(poolId), [poolId]);
  const hist = useAsync(() => getPoolHistory(poolId), [poolId]);
  const blocks = useAsync(() => getPoolBlocksRecent(poolId, 15), [poolId]);
  const dels = useAsync(() => getDelegators(poolId), [poolId]);
  const tip = useAsync(() => getTip(), []);
  const epochBlocksData = useAsync(() => tip.data ? getPoolBlocksEpoch(poolId, tip.data.epoch_no) : Promise.resolve(null), [poolId, tip.data]);
  // Koios' pool_history is a cache and some epochs can come back with 0 rewards. Re-ask for those epochs one by one.
  const repair = useAsync(async () => {
    const rows = hist.data || [];
    const cur = tip.data && tip.data.epoch_no;
    if (cur == null) return {};
    const missing = rows.filter((e) => (e.block_cnt || 0) > 0 && rewardOf(e) === 0 && e.epoch_no <= cur - 2).sort((a, b) => b.epoch_no - a.epoch_no).slice(0, 10);
    const out = {};
    for (const e of missing) {
      for (let attempt = 0; attempt < 2 && !out[e.epoch_no]; attempt++) {
        try {
          const r = await get(`/pool_history?_pool_bech32=${poolId}&_epoch_no=${e.epoch_no}`);
          if (r && r[0] && rewardOf(r[0]) > 0) out[e.epoch_no] = r[0];
        } catch (err) {}
      }
    }
    return out;
  }, [hist.data, tip.data, poolId]);
  const reload = () => {
    tip.reload();
    info.reload();
    hist.reload();
    blocks.reload();
    epochBlocksData.reload();
    dels.reload();
  };
  if (info.loading && !info.data) return <Loading />;
  if (info.error) return <ErrorText msg={info.error} />;
  const p = info.data;
  if (!p) return <ErrorText msg="Pool not found" />;
  const h = [...hist.data ?? []].sort((a, b) => b.epoch_no - a.epoch_no);
  const lastEpochs = h.slice(0, 10);
  const recentBlocks = [...blocks.data ?? []].sort((a, b) => b.block_height - a.block_height);
  const topDelegators = [...dels.data ?? []].sort((a, b) => Number(b.amount) - Number(a.amount));
  const sat = Number(p.live_saturation ?? 0);
  const curEpoch = tip.data ? tip.data.epoch_no : null;
  const epochBlocks = epochBlocksData.data ? epochBlocksData.data.length : null;
  const lastBlock = recentBlocks[0];
  const meta = p.meta_json ?? {};
  return <Screen onRefresh={reload} refreshing={info.loading}>
      <Card style={{ alignItems: "center", paddingVertical: 22 }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Blocks produced by {(p.meta_json && p.meta_json.ticker) || "pool"}</Text>
        <Text style={{ color: colors.green, fontSize: 64, fontWeight: "800" }}>{String(p.block_count ?? 0)}</Text>
        <Text style={{ color: colors.text, fontSize: 15 }}>
          {epochBlocks == null ? "…" : epochBlocks} this epoch{curEpoch != null ? ` (epoch ${curEpoch})` : ""}
        </Text>
        {lastBlock ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
            Last block #{lastBlock.block_height} · {new Date(lastBlock.block_time * 1000).toLocaleString()}
          </Text>
        ) : null}
      </Card>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <PoolLogo pool={p} size={52} />
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800", marginLeft: 12, flexShrink: 1 }}>
            [{meta.ticker ?? "\u2014"}] {meta.name ?? ""}
          </Text>
        </View>
        <Text style={{ color: colors.muted, marginTop: 8 }}>{meta.description ?? ""}</Text>
        <Row label="Status" value={p.pool_status ?? "\u2014"} color={p.pool_status === "registered" ? colors.green : colors.warn} />
        {p.retiring_epoch ? <Row label="Retiring epoch" value={String(p.retiring_epoch)} color={colors.danger} /> : null}
      </Card>

      <Card>
        <View style={{ flexDirection: "row" }}>
          <Stat label="Lifetime blocks" value={String(p.block_count ?? 0)} />
          <Stat label="Delegators" value={String(p.live_delegators ?? 0)} />
        </View>
        <Row label="Live stake" value={fmtAda(p.live_stake)} />
        <Row label="Active stake" value={fmtAda(p.active_stake)} />
        <Row label={`Saturation ${sat.toFixed(1)}%`} value="" />
        <Bar pct={sat} />
        <Row label="Pledge" value={fmtAda(p.pledge)} />
        <Row label="Live pledge" value={fmtAda(p.live_pledge)} />
        <Row label="Margin" value={`${(Number(p.margin) * 100).toFixed(2)}%`} />
        <Row label="Fixed cost" value={fmtAda(p.fixed_cost)} />
        {meta.homepage ? <Row label="Website" value={meta.homepage} /> : null}
      </Card>

      <Pressable onPress={() => openWalletAction({ action: "pool", pool: poolId })} style={{ backgroundColor: colors.green, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <Text style={{ textAlign: "center", fontWeight: "800", color: "#04210F" }}>Stake with your wallet</Text>
      </Pressable>
      <Title>Epoch history</Title>
      <Card>
        {hist.loading ? <Loading /> : lastEpochs.map((e) => {
    const fix = (repair.data || {})[e.epoch_no];
    const src = fix || e;
    const rew = rewardOf(src);
    const stake = Number(src.active_stake || e.active_stake || 0);
    const nBlocks = e.block_cnt ?? 0;
    const cur = curEpoch;
    const pending = cur != null && e.epoch_no > cur - 2 && rew === 0;
    const gap = !pending && nBlocks > 0 && rew === 0;
    // ROS = delegator rewards / active stake, annualised (73 epochs a year)
    const ros = rew > 0 && stake > 0 ? rew / stake * 73 * 100 : 0;
    let fees = Number(src.pool_fees || 0);
    if (!(fees > 0) && nBlocks > 0 && rew > 0 && Number(e.margin || 0) === 0) fees = Number(e.fixed_cost || 0);
    const rewardText = pending ? "pending" : gap ? (repair.loading ? "checking\u2026" : "n/a (Koios gap)") : fmtAda(rew, 1);
    const rewardColor = pending ? colors.muted : gap ? colors.warn : undefined;
    return <View key={e.epoch_no} style={{ paddingVertical: 6, borderBottomColor: colors.border, borderBottomWidth: 1 }}>
            <Row label={`Epoch ${e.epoch_no}`} value={`${nBlocks} ${nBlocks === 1 ? "block" : "blocks"} \xB7 ${e.delegator_cnt ?? 0} delegators`} />
            <Row label="Stake / ROS" value={`${fmtAda(e.active_stake)} \xB7 ${pending || gap ? "\u2014" : ros.toFixed(2) + "%"}`} />
            <Row label="Delegator rewards" value={rewardText} color={rewardColor} />
            <Row label="Epoch pool fees" value={pending ? "pending" : fees > 0 ? fmtAda(fees, 1) : nBlocks > 0 ? "n/a" : "0 \u20B3"} color={pending ? colors.muted : undefined} />
          </View>;
  })}
      </Card>

      <Title>Recent blocks</Title>
      <Card>
        {blocks.loading ? <Loading /> : recentBlocks.slice(0, 15).map((b) => <Row key={b.block_hash} label={`#${b.block_height} \xB7 epoch ${b.epoch_no}`} value={new Date(b.block_time * 1e3).toLocaleString()} />)}
        {!blocks.loading && recentBlocks.length === 0 && <Text style={{ color: colors.muted }}>No blocks yet</Text>}
      </Card>

      <Title>Top delegators ({p.live_delegators ?? topDelegators.length})</Title>
      <Card>
        {dels.loading ? <Loading /> : topDelegators.slice(0, 25).map((d) => <Row key={d.stake_address} label={short(d.stake_address, 8)} value={`${ada(d.amount).toLocaleString("en-US", { maximumFractionDigits: 0 })} \u20B3`} />)}
      </Card>
    </Screen>;
}
function EpochScreen() {
  const { data, error, loading, reload } = useAsync(async () => {
    const tip2 = await getTip();
    const ep2 = tip2 ? await getEpoch(tip2.epoch_no) : null;
    if (!tip2 || !ep2) throw new Error("Epoch data is unavailable right now");
    return { tip: tip2, ep: ep2 };
  });
  const [now, setNow] = useState(Date.now() / 1e3);
  const [priceTick, setPriceTick] = useState(0);
  const refreshAll = () => { reload(); setPriceTick((t) => t + 1); };
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1e3), 1e3);
    return () => clearInterval(t);
  }, []);
  if (loading && !data) return <Loading />;
  if (error || !data) return <Screen onRefresh={refreshAll} refreshing={loading}><ErrorText msg={error ?? "No data"} /><PriceCards refreshKey={priceTick} /></Screen>;
  const { tip, ep } = data;
  const left = Math.max(0, ep.end_time - now);
  const pct = (EPOCH_SECONDS - left) / EPOCH_SECONDS * 100;
  const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), sec = Math.floor(left % 60);
  return <Screen onRefresh={refreshAll} refreshing={loading}>
      <Card>
        <Text style={{ color: colors.muted }}>Epoch</Text>
        <Text style={{ color: colors.green, fontSize: 44, fontWeight: "800" }}>{tip.epoch_no}</Text>
        <Bar pct={pct} />
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{d}d {h}h {m}m {sec}s left</Text>
        <Text style={{ color: colors.muted }}>{pct.toFixed(1)}% complete</Text>
      </Card>
      <Card>
        <Row label="Block height" value={String(tip.block_no)} />
        <Row label="Epoch slot" value={String(tip.epoch_slot)} />
        <Row label="Blocks this epoch" value={String(ep.blk_count)} />
        <Row label="Transactions" value={String(ep.tx_count)} />
        <Row label="Fees" value={fmtAda(ep.fees)} />
        <Row label="Volume" value={fmtAda(ep.out_sum)} />
        <Row label="Ends" value={new Date(ep.end_time * 1e3).toLocaleString()} />
      </Card>
      <PriceCards refreshKey={priceTick} />
    </Screen>;
}
const KEY = "wallet:stake";
function WalletScreen() {
  const [input, setInput] = useState("");
  const [stake, setStake] = useState(null);
  const [handle, setHandle] = useState(null);
  const [open, setOpen] = useState({});
  const [acc, setAcc] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [assets, setAssets] = useState([]);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  async function load(s2) {
    setLoading(true);
    setErr(null);
    try {
      const [a, r, as] = await Promise.all([getAccount(s2), getAccountRewards(s2), getAccountAssets(s2)]);
      setAcc(a);
      setRewards([...r].sort((x, y) => y.earned_epoch - x.earned_epoch));
      setAssets(as);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }
  async function connect() {
    try {
      setErr(null);
      setLoading(true);
      const w = await resolveWallet(input);
      await AsyncStorage.setItem(KEY, w.stake);
      if (w.handle) await AsyncStorage.setItem(HANDLE_KEY, w.handle); else await AsyncStorage.removeItem(HANDLE_KEY);
      setHandle(w.handle);
      setStake(w.stake);
      load(w.stake);
    } catch (e) {
      setErr(e.message);
      setLoading(false);
    }
  }
  async function disconnect() {
    await AsyncStorage.removeItem(KEY);
    await AsyncStorage.removeItem(HANDLE_KEY);
    setHandle(null);
    setStake(null);
    setAcc(null);
    setInput("");
  }
  useEffect(() => {
    AsyncStorage.getItem(HANDLE_KEY).then((h) => { if (h) setHandle(h); });
    AsyncStorage.getItem(KEY).then((s2) => {
      if (s2) {
        setStake(s2);
        load(s2);
      }
    });
  }, []);
  if (!stake)
    return <Screen>
        <Title>Connect wallet (read-only)</Title>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>Type your ADA Handle or paste a stake / payment address.</Text>
        <Card>
          <TextInput
      value={input}
      onChangeText={setInput}
      placeholder="$handle, stake1… or addr1…"
      placeholderTextColor={colors.muted}
      autoCapitalize="none"
      autoCorrect={false}
      style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }}
    />
          <Pressable onPress={connect} style={{ backgroundColor: colors.green, borderRadius: 10, padding: 12, marginTop: 12 }}>
            <Text style={{ textAlign: "center", fontWeight: "800", color: "#04210F" }}>{loading ? "Looking up\u2026" : "Connect"}</Text>
          </Pressable>
          {err && <ErrorText msg={err} />}
        </Card>
      </Screen>;
  const byName = (x, y) => assetLabel(x).localeCompare(assetLabel(y));
  const nfts = assets.filter(isNftAsset);
  const groups = groupNfts(nfts);
  const tokens = assets.filter((a) => !isNftAsset(a)).sort(byName);
  const lastEpochs = [...new Set(rewards.map((r) => r.earned_epoch))].slice(0, 6);
  const recentRewards = rewards.filter((r) => lastEpochs.includes(r.earned_epoch));
  return <Screen onRefresh={() => load(stake)} refreshing={loading}>
      {loading && !acc ? <Loading /> : <>
          <Card>
            <Text style={{ color: colors.muted }}>Total balance</Text>
            <Text style={{ color: colors.green, fontSize: 32, fontWeight: "800" }}>{fmtAda(acc?.total_balance, 2)}</Text>
            {handle ? <Row label="Handle" value={handle} color={colors.lime} /> : null}
            <Row label="Stake address" value={short(stake, 10)} />
            <Row label="Delegated pool" value={acc?.delegated_pool ? short(acc.delegated_pool, 10) : "Not delegated"} />
            <Row label="Rewards available" value={fmtAda(acc?.rewards_available, 2)} />
            <Row label="Withdrawn" value={fmtAda(acc?.withdrawals_sum, 2)} />
          </Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Chip text="Withdraw rewards" active onPress={() => openWalletAction({ action: "withdraw" })} />
            <Chip text="Voting power" active onPress={() => openWalletAction({ action: "drep" })} />
          </View>
          <Title>Rewards (last 6 epochs)</Title>
          <Card>
            {recentRewards.map((r, i) => <Row key={i} label={`Epoch ${r.earned_epoch} (${r.type})`} value={`+${ada(r.amount).toFixed(2)} \u20B3`} />)}
            {rewards.length === 0 && <Text style={{ color: colors.muted }}>No rewards yet</Text>}
          </Card>
          <Title>Tokens ({tokens.length})</Title>
          <Card>
            {tokens.slice(0, 40).map((a, i) => <Row key={`${a.policy_id}${a.asset_name}${i}`} label={assetLabel(a)} value={fmtQty(a.quantity, a.decimals)} />)}
            {tokens.length > 40 ? <Text style={{ color: colors.muted, marginTop: 6 }}>+{tokens.length - 40} more</Text> : null}
            {tokens.length === 0 ? <Text style={{ color: colors.muted }}>No tokens in this wallet</Text> : null}
          </Card>
          <Title>NFTs ({nfts.length} in {groups.length} {groups.length === 1 ? "collection" : "collections"})</Title>
          <Card>
            {groups.map((g) => {
    const single = g.items.length === 1;
    const isOpen = !!open[g.policy];
    return <View key={g.policy}>
                  <Pressable onPress={() => { if (!single) setOpen({ ...open, [g.policy]: !isOpen }); }} style={{ paddingVertical: 9, flexDirection: "row", justifyContent: "space-between", borderBottomColor: colors.border, borderBottomWidth: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700", flexShrink: 1 }}>{g.name}{single ? "" : ` (${g.items.length})`}</Text>
                    <Text style={{ color: colors.muted }}>{single ? short(g.policy, 5) : isOpen ? "\u25BE" : "\u25B8"}</Text>
                  </Pressable>
                  {isOpen ? g.items.slice(0, 60).map((a, i) => <Text key={`${a.asset_name}${i}`} style={{ color: colors.muted, paddingLeft: 14, paddingVertical: 3 }}>{nftLabel(a)}</Text>) : null}
                  {isOpen && g.items.length > 60 ? <Text style={{ color: colors.muted, paddingLeft: 14 }}>+{g.items.length - 60} more</Text> : null}
                </View>;
  })}
            {groups.length === 0 ? <Text style={{ color: colors.muted }}>No NFTs in this wallet</Text> : null}
          </Card>
          <Pressable onPress={disconnect}><Text style={{ color: colors.danger, textAlign: "center", marginTop: 8 }}>Disconnect</Text></Pressable>
        </>}
      {err && <ErrorText msg={err} />}
    </Screen>;
}
function PoolRow({ p, onPress, fav, onFav }) {
  const meta = p.meta_json || {};
  const sat = Number(p.live_saturation || 0);
  return <Pressable onPress={onPress} style={{ paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row" }}>
      <PoolLogo pool={p} size={44} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: colors.text, fontWeight: "700", flexShrink: 1 }}>[{meta.ticker ?? "\u2014"}] {meta.name ?? ""}</Text>
          {onFav ? <Pressable onPress={onFav} hitSlop={12}><Text style={{ color: colors.lime, fontSize: 22 }}>{fav ? "\u2605" : "\u2606"}</Text></Pressable> : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
          {human(p.live_stake)} · {p.live_delegators ?? 0} delegators · {p.block_count ?? 0} blocks · sat {sat.toFixed(1)}% · margin {(Number(p.margin || 0) * 100).toFixed(1)}%
        </Text>
        <Bar pct={sat} />
      </View>
    </Pressable>;
}
function SimpleRow({ p, onPress }) {
  return <Pressable onPress={onPress} style={{ paddingVertical: 8 }}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>[{p.ticker ?? "\u2014"}]</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{short(p.pool_id_bech32 || p.id, 12)}{p.retiring_epoch ? ` \xB7 retiring @ ${p.retiring_epoch}` : ""}</Text>
    </Pressable>;
}
function ExploreScreen() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [selected, setSelected] = useState(null);
  const [favs, setFavs] = useState([]);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState("search");
  const retiring = useAsync(getRetiringPools);
  const results = useAsync(() => dq.trim().length >= 2 ? searchSpos(dq) : Promise.resolve([]), [dq]);
  useEffect(() => { const t = setTimeout(() => setDq(q), 500); return () => clearTimeout(t); }, [q]);
  useEffect(() => { loadFavs().then(setFavs); }, []);
  const isFav = (id) => favs.some((f) => f.id === id);
  async function toggleFav(id, ticker) {
    const next = isFav(id) ? favs.filter((f) => f.id !== id) : [...favs, { id, ticker }];
    setFavs(next);
    await AsyncStorage.setItem(FAV_KEY, JSON.stringify(next));
  }
  async function setWidgetPool(id, ticker) {
    await AsyncStorage.setItem(WIDGET_KEY, JSON.stringify({ id, ticker }));
    setNote(`Widget will show ${ticker || "this pool"} after its next refresh (tap \u27F3 on the widget).`);
  }
  if (selected)
    return <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 16 }}>
          <Pressable onPress={() => { setSelected(null); setNote(""); }}><Text style={{ color: colors.green }}>← Back</Text></Pressable>
          <Pressable onPress={() => toggleFav(selected.id, selected.ticker)}><Text style={{ color: colors.lime }}>{isFav(selected.id) ? "\u2605 Saved" : "\u2606 Save"}</Text></Pressable>
          <Pressable onPress={() => setWidgetPool(selected.id, selected.ticker)}><Text style={{ color: colors.green }}>Use for widget</Text></Pressable>
        </View>
        {note ? <Text style={{ color: colors.muted, paddingHorizontal: 16, paddingBottom: 6, fontSize: 12 }}>{note}</Text> : null}
        <PoolDetail poolId={selected.id} />
      </View>;
  const rows = results.data ?? [];
  const modeChips = <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6 }}>
      <Chip text="Search" active={mode === "search"} onPress={() => setMode("search")} />
      <Chip text="Rewards calculator" active={mode === "calc"} onPress={() => setMode("calc")} />
      <Chip text="Compare pools" active={mode === "compare"} onPress={() => setMode("compare")} />
    </View>;
  if (mode === "calc") return <Screen>{modeChips}<RewardsCalc /></Screen>;
  if (mode === "compare") return <Screen>{modeChips}<ComparePools /></Screen>;
  return <Screen>
      {modeChips}
      <TextInput
    value={q}
    onChangeText={setQ}
    placeholder="Search SPO: ticker or pool ID (pool1… / hex)"
    placeholderTextColor={colors.muted}
    autoCapitalize="none"
    autoCorrect={false}
    style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }}
  />
      {dq.trim().length >= 2 && <Card style={{ marginTop: 12 }}>
          {results.loading ? <Loading /> : results.error ? <ErrorText msg={results.error} /> : rows.length === 0 ? <Text style={{ color: colors.muted }}>No pools found</Text> : rows.map((p) => {
    const t = p.meta_json ? p.meta_json.ticker : null;
    return <PoolRow key={p.pool_id_bech32} p={p} fav={isFav(p.pool_id_bech32)} onFav={() => toggleFav(p.pool_id_bech32, t)} onPress={() => setSelected({ id: p.pool_id_bech32, ticker: t })} />;
  })}
        </Card>}
      {favs.length > 0 && <>
          <Title>Saved pools</Title>
          <Card>{favs.map((f) => <SimpleRow key={f.id} p={f} onPress={() => setSelected({ id: f.id, ticker: f.ticker })} />)}</Card>
        </>}
      <Title>Retiring pools</Title>
      <Card>
        {retiring.loading ? <Loading /> : retiring.error ? <ErrorText msg={retiring.error} /> : (retiring.data ?? []).map((p) => <SimpleRow key={p.pool_id_bech32} p={p} onPress={() => setSelected({ id: p.pool_id_bech32, ticker: p.ticker })} />)}
      </Card>
    </Screen>;
}
function PriceCards({ refreshKey }) {
  const [state, setState] = useState({ rows: null, at: null, stale: false, failed: false });
  const load = useCallback(async (force) => {
    try {
      const r = await getPrices({ force });
      setState({ rows: r.rows, at: r.at, stale: r.stale, failed: false });
    } catch (e) {
      setState((s) => ({ ...s, failed: !s.rows }));
    }
  }, []);
  // show whatever we already know right away, then refresh in the background
  useEffect(() => { readCachedPrices().then((c) => { if (c) setState((s) => s.rows ? s : { rows: c.rows, at: c.at, stale: true, failed: false }); }); }, []);
  useEffect(() => { load(refreshKey > 0); }, [refreshKey, load]);
  useEffect(() => { const t = setInterval(() => load(false), 18e4); return () => clearInterval(t); }, [load]);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 3e4); return () => clearInterval(t); }, []);
  const ageMin = state.at ? Math.floor((Date.now() - state.at) / 6e4) : 0;
  return <>
      <Title>Prices</Title>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>USD · 24h change{state.rows && ageMin >= 5 ? ` · last updated ${ageMin} min ago` : ""}</Text>
      {!state.rows && !state.failed ? <Loading /> : null}
      {!state.rows && state.failed ? <Card><Text style={{ color: colors.muted }}>Prices couldn't be loaded yet. Pull down to try again.</Text></Card> : null}
      {(state.rows || []).map((c) => {
    const ch = c.price_change_percentage_24h;
    const up = (ch ?? 0) >= 0;
    return <Card key={c.id}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {c.image ? <Image source={{ uri: c.image }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff" }} /> : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.green, fontWeight: "800", fontSize: 12 }}>{c.sym}</Text></View>}
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{c.sym}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{c.name}{c.market_cap_rank ? ` · #${c.market_cap_rank}` : ""}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 }}>{fmtUsd(c.current_price)}</Text>
              <Text style={{ color: up ? colors.green : colors.danger, fontWeight: "700" }}>{ch == null ? "\u2014" : `${up ? "+" : ""}${ch.toFixed(2)}%`}</Text>
            </View>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>24h range {fmtNum(c.low_24h)} {"\u2013"} {fmtNum(c.high_24h)}</Text>
        </Card>;
  })}
    </>;
}
function VoteBar({ yes, no }) {
  const y = Math.max(0, Math.min(100, Number(yes || 0)));
  const n = Math.max(0, Math.min(100 - y, Number(no || 0)));
  return <View style={{ flexDirection: "row", height: 10, borderRadius: 6, overflow: "hidden", backgroundColor: colors.border, marginVertical: 6 }}>
      <View style={{ width: `${y}%`, backgroundColor: colors.green }} />
      <View style={{ width: `${n}%`, backgroundColor: colors.danger }} />
    </View>;
}
const statusColor = (st) => st === "Active" ? colors.green : st === "Enacted" || st === "Ratified" ? colors.lime : st === "Dropped" ? colors.danger : colors.muted;
function Chip({ text, color, active, onPress }) {
  return <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: active ? colors.green : colors.border, backgroundColor: active ? "#16301F" : "transparent", marginRight: 8, marginBottom: 6 }}>
      <Text style={{ color: color || (active ? colors.green : colors.muted), fontWeight: "700", fontSize: 12 }}>{text}</Text>
    </Pressable>;
}
function GovDetail({ p, curEpoch, onBack }) {
  const votes = useAsync(() => getVotingSummary(p), [govKey(p)]);
  const v = votes.data;
  const st = govStatus(p);
  const req = govRequested(p);
  const title = govTitle(p);
  const abstract = govText(p, "abstract");
  const motivation = govText(p, "motivation");
  const rationale = govText(p, "rationale");
  const left = p.expiration != null && curEpoch != null ? p.expiration - curEpoch : null;
  const pct = (x) => `${Number(x || 0).toFixed(1)}%`;
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Pressable onPress={onBack} style={{ padding: 16 }}><Text style={{ color: colors.green }}>← Back</Text></Pressable>
      <Screen onRefresh={votes.reload} refreshing={votes.loading}>
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Chip text={govTypeLabel(p.proposal_type)} active />
            <Chip text={st} color={statusColor(st)} />
          </View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 4 }}>{title || `${govTypeLabel(p.proposal_type)} #${p.proposal_index ?? ""}`}</Text>
          {abstract ? <Text style={{ color: colors.muted, marginTop: 8 }}>{abstract.slice(0, 700)}{abstract.length > 700 ? "\u2026" : ""}</Text> : null}
        </Card>
        {req > 0 ? <Card>
            <Text style={{ color: colors.muted, fontSize: 12 }}>ADA requested from the treasury</Text>
            <Text style={{ color: colors.green, fontSize: 28, fontWeight: "800" }}>{fmtAda(req, 0)}</Text>
            {govWithdrawals(p).map((w, i) => <Row key={i} label={short(w.stake_address || w.stake_addr || "recipient", 8)} value={fmtAda(w.amount, 0)} />)}
          </Card> : null}
        <Card>
          <Row label="Proposed in epoch" value={String(p.proposed_epoch ?? "\u2014")} />
          <Row label="Expires after epoch" value={String(p.expiration ?? "\u2014")} />
          {st === "Active" && left != null ? <Row label="Time left" value={left < 0 ? "ending" : `~${left * 5} days (${left} epochs)`} color={colors.lime} /> : null}
          {p.ratified_epoch != null ? <Row label="Ratified in epoch" value={String(p.ratified_epoch)} /> : null}
          {p.enacted_epoch != null ? <Row label="Enacted in epoch" value={String(p.enacted_epoch)} /> : null}
          {p.dropped_epoch != null ? <Row label="Dropped in epoch" value={String(p.dropped_epoch)} /> : null}
          {p.expired_epoch != null ? <Row label="Expired in epoch" value={String(p.expired_epoch)} /> : null}
          <Row label="Deposit" value={fmtAda(p.deposit, 0)} />
        </Card>
        <Title>Votes</Title>
        <Card>
          {votes.loading && !v ? <Loading /> : votes.error ? <Text style={{ color: colors.muted }}>Voting data isn't available right now.</Text> : !v ? <Text style={{ color: colors.muted }}>No votes recorded yet.</Text> : <>
              <Text style={{ color: colors.text, fontWeight: "700" }}>DReps</Text>
              <VoteBar yes={v.drep_yes_pct} no={v.drep_no_pct} />
              <Row label="Yes / No (voting power)" value={`${pct(v.drep_yes_pct)} / ${pct(v.drep_no_pct)}`} />
              <Row label="Votes cast (yes / no / abstain)" value={`${v.drep_yes_votes_cast ?? 0} / ${v.drep_no_votes_cast ?? 0} / ${v.drep_abstain_votes_cast ?? 0}`} />
              <Text style={{ color: colors.text, fontWeight: "700", marginTop: 12 }}>Stake pools</Text>
              <VoteBar yes={v.pool_yes_pct} no={v.pool_no_pct} />
              <Row label="Yes / No (voting power)" value={`${pct(v.pool_yes_pct)} / ${pct(v.pool_no_pct)}`} />
              <Row label="Votes cast (yes / no / abstain)" value={`${v.pool_yes_votes_cast ?? 0} / ${v.pool_no_votes_cast ?? 0} / ${v.pool_abstain_votes_cast ?? 0}`} />
              <Text style={{ color: colors.text, fontWeight: "700", marginTop: 12 }}>Constitutional Committee</Text>
              <VoteBar yes={v.committee_yes_pct} no={v.committee_no_pct} />
              <Row label="Yes / No / abstain (votes)" value={`${v.committee_yes_votes_cast ?? 0} / ${v.committee_no_votes_cast ?? 0} / ${v.committee_abstain_votes_cast ?? 0}`} />
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 10 }}>Percentages are shares of voting power. The share needed to pass depends on the type of action, so this screen doesn't say whether a proposal will be ratified.</Text>
            </>}
        </Card>
        {motivation ? <><Title>Motivation</Title><Card><Text style={{ color: colors.muted }}>{motivation.slice(0, 900)}{motivation.length > 900 ? "\u2026" : ""}</Text></Card></> : null}
        {rationale ? <><Title>Rationale</Title><Card><Text style={{ color: colors.muted }}>{rationale.slice(0, 900)}{rationale.length > 900 ? "\u2026" : ""}</Text></Card></> : null}
        {p.meta_url ? <Text style={{ color: colors.muted, fontSize: 11 }} selectable>Metadata: {p.meta_url}</Text> : null}
      </Screen>
    </View>;
}
function GovernanceScreen() {
  const props = useAsync(getProposals);
  const tip = useAsync(getTip);
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState(null);
  const curEpoch = tip.data ? tip.data.epoch_no : null;
  const all = props.data || [];
  const list = all.filter((p) => filter === "all" ? true : filter === "treasury" ? p.proposal_type === "TreasuryWithdrawals" : govStatus(p) === "Active");
  const activeAsks = all.filter((p) => govStatus(p) === "Active" && p.proposal_type === "TreasuryWithdrawals");
  const activeTotal = activeAsks.reduce((sum, p) => sum + govRequested(p), 0);
  if (selected) return <GovDetail p={selected} curEpoch={curEpoch} onBack={() => setSelected(null)} />;
  return <Screen onRefresh={() => { props.reload(); tip.reload(); }} refreshing={props.loading}>
      {props.loading && !props.data ? <Loading /> : props.error ? <ErrorText msg={props.error} /> : <>
          <Card>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Open treasury requests</Text>
            <Text style={{ color: colors.green, fontSize: 26, fontWeight: "800" }}>{fmtAda(activeTotal, 0)}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{activeAsks.length} active treasury {activeAsks.length === 1 ? "proposal" : "proposals"} · {all.filter((p) => govStatus(p) === "Active").length} active actions in total</Text>
          </Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Chip text={"\u{1F5F3}\uFE0F Delegate my voting power"} active onPress={() => openWalletAction({ action: "drep" })} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Chip text="Active" active={filter === "active"} onPress={() => setFilter("active")} />
            <Chip text="Treasury" active={filter === "treasury"} onPress={() => setFilter("treasury")} />
            <Chip text="All" active={filter === "all"} onPress={() => setFilter("all")} />
          </View>
          {list.length === 0 ? <Text style={{ color: colors.muted, marginTop: 12 }}>Nothing to show here.</Text> : null}
          {list.map((p) => {
    const st = govStatus(p);
    const req = govRequested(p);
    const left = p.expiration != null && curEpoch != null ? p.expiration - curEpoch : null;
    return <Pressable key={govKey(p)} onPress={() => setSelected(p)}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{govTypeLabel(p.proposal_type)}</Text>
                  <Text style={{ color: statusColor(st), fontSize: 12, fontWeight: "700" }}>{st}</Text>
                </View>
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15, marginTop: 4 }}>{govTitle(p) || `${govTypeLabel(p.proposal_type)} #${p.proposal_index ?? ""}`}</Text>
                {req > 0 ? <Text style={{ color: colors.green, fontWeight: "800", fontSize: 18, marginTop: 6 }}>{fmtAda(req, 0)} requested</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
                  Proposed epoch {p.proposed_epoch ?? "\u2014"}{st === "Active" && left != null ? ` · ~${Math.max(left, 0) * 5} days left` : p.expiration != null ? ` · expires epoch ${p.expiration}` : ""}
                </Text>
              </Card>
            </Pressable>;
  })}
        </>}
    </Screen>;
}
function PoolPicker({ onPick }) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q), 500); return () => clearTimeout(t); }, [q]);
  const res = useAsync(() => dq.trim().length >= 2 ? searchSpos(dq) : Promise.resolve([]), [dq]);
  const saved = useAsync(async () => { const f = await loadFavs(); return getPoolInfos(f.map((x) => x.id)); }, []);
  const rows = res.data || [];
  return <View>
      <TextInput value={q} onChangeText={setQ} placeholder="Find a pool: ticker or pool ID" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 }} />
      {dq.trim().length >= 2 ? <Card>{res.loading ? <Loading /> : res.error ? <ErrorText msg={res.error} /> : rows.length === 0 ? <Text style={{ color: colors.muted }}>No pools found</Text> : rows.map((p) => <PoolRow key={p.pool_id_bech32} p={p} onPress={() => onPick(p)} />)}</Card> : null}
      {(saved.data || []).length > 0 && dq.trim().length < 2 ? <><Title>Saved pools</Title><Card>{saved.data.map((p) => <PoolRow key={p.pool_id_bech32} p={p} onPress={() => onPick(p)} />)}</Card></> : null}
    </View>;
}
function RewardsCalc() {
  const [pool, setPool] = useState(null);
  const [amount, setAmount] = useState("10000");
  const tip = useAsync(getTip);
  const hist = useAsync(() => pool ? getPoolHistory(pool.pool_id_bech32) : Promise.resolve(null), [pool && pool.pool_id_bech32]);
  const amt = Number(String(amount).replace(/[^0-9.]/g, "")) || 0;
  const st = hist.data ? poolRate(hist.data, tip.data && tip.data.epoch_no) : null;
  const rate = st && st.rate;
  const meta = pool && pool.meta_json || {};
  const money = (n) => `${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 })} \u20B3`;
  return <View>
      <Title>Rewards calculator</Title>
      {!pool ? <>
          <Text style={{ color: colors.muted, marginBottom: 8 }}>Pick a pool to estimate what your ADA could earn there, based on how it actually performed over its last epochs.</Text>
          <PoolPicker onPick={setPool} />
        </> : <>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <PoolLogo pool={pool} size={44} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>[{meta.ticker ?? "\u2014"}] {meta.name ?? ""}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>margin {(Number(pool.margin || 0) * 100).toFixed(1)}% · fixed {fmtAda(pool.fixed_cost, 0)}</Text>
              </View>
              <Pressable onPress={() => setPool(null)}><Text style={{ color: colors.green }}>Change</Text></Pressable>
            </View>
          </Card>
          <Card>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>Amount to stake (ADA)</Text>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 18 }} />
            <View style={{ flexDirection: "row", marginTop: 8 }}>{["1000", "10000", "100000"].map((v) => <Chip key={v} text={Number(v).toLocaleString("en-US")} active={amount === v} onPress={() => setAmount(v)} />)}</View>
          </Card>
          {hist.loading && !hist.data ? <Loading /> : hist.error ? <ErrorText msg={hist.error} /> : rate == null ? <Card><Text style={{ color: colors.muted }}>Not enough reward history for this pool to estimate anything yet.</Text></Card> : <Card>
              <Row label="Average per epoch (5 days)" value={money(amt * rate)} />
              <Row label="Per month (~6 epochs)" value={money(amt * rate * 6)} />
              <Row label="Per year" value={money(amt * rate * 73)} color={colors.green} />
              <Row label="Per year, reinvested each epoch" value={money(amt * (Math.pow(1 + rate, 73) - 1))} />
              <Row label="Estimated yearly rate (APR / APY)" value={`${pct2(aprOf(rate))} / ${pct2(apyOf(rate))}`} />
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 10 }}>Based on the last {st.epochs} epochs with data{st.gaps ? ` (${st.gaps} skipped because Koios had no reward numbers)` : ""}. Pool fees are already taken out. Rewards arrive about two epochs after they are earned. Small pools depend on block luck, so real results can differ a lot. This is an estimate, not a promise.</Text>
            </Card>}
        </>}
    </View>;
}
function ComparePools() {
  const [picked, setPicked] = useState([]);
  const [adding, setAdding] = useState(true);
  const tip = useAsync(getTip);
  const key = picked.map((p) => p.pool_id_bech32).join(",");
  const hists = useAsync(() => Promise.all(picked.map((p) => getPoolHistory(p.pool_id_bech32).catch(() => []))), [key]);
  const epoch = tip.data && tip.data.epoch_no;
  const stats = picked.map((p, i) => hists.data && hists.data[i] ? poolRate(hists.data[i], epoch) : { rate: null, epochs: 0, gaps: 0 });
  // each metric: how to show it, and which value wins ("hi" = higher is better, "lo" = lower is better)
  const metrics = [
    { label: "Live stake", val: (p) => Number(p.live_stake || 0), fmt: (v) => human(v), win: null },
    { label: "Saturation", val: (p) => Number(p.live_saturation || 0), fmt: (v) => v.toFixed(1) + "%", win: "lo" },
    { label: "Delegators", val: (p) => Number(p.live_delegators || 0), fmt: (v) => String(v), win: null },
    { label: "Lifetime blocks", val: (p) => Number(p.block_count || 0), fmt: (v) => String(v), win: "hi" },
    { label: "Margin", val: (p) => Number(p.margin || 0) * 100, fmt: (v) => v.toFixed(2) + "%", win: "lo" },
    { label: "Fixed cost / epoch", val: (p) => ada(p.fixed_cost), fmt: (v) => v.toFixed(0) + " \u20B3", win: "lo" },
    { label: "Pledge", val: (p) => ada(p.pledge), fmt: (v) => v.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " \u20B3", win: "hi" },
    { label: "Est. yearly rate (APR)", val: (p, i) => aprOf(stats[i].rate), fmt: (v) => pct2(v), win: "hi" },
  ];
  const best = (m) => {
    if (!m.win || picked.length < 2) return -1;
    const vals = picked.map((p, i) => m.val(p, i));
    const ok = vals.filter((v) => v != null);
    if (ok.length < 2) return -1;
    const target = m.win === "hi" ? Math.max(...ok) : Math.min(...ok);
    if (ok.every((v) => v === target)) return -1;
    return vals.indexOf(target);
  };
  return <View>
      <Title>Compare pools</Title>
      {picked.length === 0 ? <Text style={{ color: colors.muted, marginBottom: 8 }}>Pick 2 or 3 pools to see them side by side. The best value in each row is highlighted.</Text> : null}
      {picked.length > 0 ? <Card>
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 96 }} />
            {picked.map((p, i) => <View key={p.pool_id_bech32} style={{ flex: 1, alignItems: "center" }}>
                <PoolLogo pool={p} size={36} />
                <Text style={{ color: colors.text, fontWeight: "800", marginTop: 4 }}>{p.meta_json && p.meta_json.ticker || "?"}</Text>
                <Pressable onPress={() => setPicked(picked.filter((x) => x !== p))} hitSlop={8}><Text style={{ color: colors.muted, fontSize: 11 }}>remove ✕</Text></Pressable>
              </View>)}
          </View>
          {metrics.map((m) => {
    const b = best(m);
    return <View key={m.label} style={{ flexDirection: "row", paddingVertical: 8, borderTopColor: colors.border, borderTopWidth: 1, alignItems: "center" }}>
                <Text style={{ width: 96, color: colors.muted, fontSize: 11 }}>{m.label}</Text>
                {picked.map((p, i) => {
      const v = m.val(p, i);
      return <Text key={p.pool_id_bech32} style={{ flex: 1, textAlign: "center", fontWeight: b === i ? "800" : "600", color: b === i ? colors.lime : colors.text, fontSize: 13 }}>{v == null ? "n/a" : m.fmt(v)}{b === i ? " \u25B2" : ""}</Text>;
    })}
              </View>;
  })}
          {hists.loading ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: 8 }}>Loading reward history…</Text> : <Text style={{ color: colors.muted, fontSize: 11, marginTop: 8 }}>Yearly rate is an estimate from each pool's last epochs ({stats.map((x) => x.epochs).join(" / ")} epochs counted). Block luck makes small pools swing a lot. ▲ marks the best value per row; it isn't advice.</Text>}
        </Card> : null}
      {picked.length < 3 ? <>
          {picked.length > 0 && !adding ? <Pressable onPress={() => setAdding(true)}><Text style={{ color: colors.green, marginBottom: 8 }}>+ Add another pool</Text></Pressable> : null}
          {adding || picked.length === 0 ? <PoolPicker onPick={(p) => { if (!picked.some((x) => x.pool_id_bech32 === p.pool_id_bech32)) setPicked([...picked, p]); setAdding(false); }} /> : null}
        </> : null}
    </View>;
}
const ALERT_ITEMS = [
  { key: "proposals", title: "New governance proposals", text: "A new governance action appears, with the ADA it asks for if it's a treasury withdrawal." },
  { key: "blocks", title: "Blocks minted by your pools", text: "Pools you saved with \u2605 in Explore minted a new block." },
  { key: "poolHealth", title: "Pool changes", text: "Saved pools change their fees, announce retirement, or get close to saturation (95%+)." },
  { key: "rewards", title: "Staking rewards", text: "Your connected wallet receives rewards for a new epoch." },
  { key: "priceMoves", title: "Big price moves", text: "ADA, BTC or NIGHT moves 10% or more in 24 hours." },
];
function AlertsScreen() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [allowed, setAllowed] = useState(null);
  const [favs, setFavs] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setSettings(await loadSettings());
    setAllowed(await notificationsAllowed());
    setFavs(await loadFavs());
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5e3); return () => clearInterval(t); }, [refresh]);
  async function toggle(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await saveSettings(next);
    if (value && !allowed) setAllowed(await askNotificationPermission());
  }
  async function allow() { setAllowed(await askNotificationPermission()); }
  async function test() {
    setMsg("");
    try { await notify("Frog Labs", "Notifications are working \u{1F438}", "general"); setMsg(allowed ? "Test sent. Check your notification shade." : "Sent, but notifications are not allowed yet. Tap \"Allow notifications\"."); } catch (e) { setMsg("Could not send: " + e.message); }
  }
  async function checkNow() {
    setBusy(true);
    setMsg("");
    try {
      const r = await runAlertChecks({ notify, force: true });
      setMsg(r.skipped ? "Another check is running, try again in a moment." : r.fired.length ? `${r.fired.length} new ${r.fired.length === 1 ? "alert" : "alerts"} sent.` : "Checked. Nothing new since the last check.");
    } catch (e) { setMsg("Check failed: " + e.message); }
    setBusy(false);
  }
  async function resetAll() { await resetAlertState(); setMsg("Reset. The next check starts fresh and won't notify about old items."); }
  return <Screen>
      {allowed === false ? <Card style={{ borderColor: colors.warn }}>
          <Text style={{ color: colors.warn, fontWeight: "700" }}>Notifications are off</Text>
          <Text style={{ color: colors.muted, marginVertical: 6 }}>Allow notifications so Frog Labs can alert you.</Text>
          <Pressable onPress={allow} style={{ backgroundColor: colors.green, borderRadius: 10, padding: 10 }}><Text style={{ textAlign: "center", fontWeight: "800", color: "#04210F" }}>Allow notifications</Text></Pressable>
        </Card> : null}
      <Card>
        {ALERT_ITEMS.map((it) => <View key={it.key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ color: colors.text, fontWeight: "700" }}>{it.title}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{it.text}</Text>
            </View>
            <Switch value={!!settings[it.key]} onValueChange={(v) => toggle(it.key, v)} trackColor={{ true: colors.green, false: colors.border }} thumbColor="#ECFDF5" />
          </View>)}
      </Card>
      <Title>Watched pools</Title>
      <Card>
        {favs.length === 0 ? <Text style={{ color: colors.muted }}>No saved pools yet. In Explore, search for a pool, open it and tap ☆ Save. Block and pool-change alerts use these pools.</Text> : favs.map((f) => <Row key={f.id} label={`[${f.ticker || "?"}]`} value={short(f.id, 8)} />)}
      </Card>
      <Title>Tools</Title>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Chip text="Send test notification" active onPress={test} />
          <Chip text={busy ? "Checking\u2026" : "Check now"} active onPress={checkNow} />
          <Chip text="Reset" onPress={resetAll} />
        </View>
        {msg ? <Text style={{ color: colors.lime, marginTop: 8 }}>{msg}</Text> : null}
      </Card>
      <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 16 }}>How it works: Frog Labs checks the chain every minute while the app is open, and in the background about every 15 minutes or more. Android decides the exact timing, and battery savers can delay it. If alerts arrive late or not at all, set Frog Labs to "No restrictions" in battery settings and allow autostart. This is not an instant server push, so a block can reach you minutes after it was minted.</Text>
    </Screen>;
}
function useForegroundAlerts() {
  useEffect(() => {
    let alive = true;
    const run = () => { if (alive) runAlertChecks({ notify, minGapMs: 45e3 }).catch(() => {}); };
    (async () => {
      try {
        if (!(await AsyncStorage.getItem("alerts:asked"))) {
          await AsyncStorage.setItem("alerts:asked", "1");
          await askNotificationPermission();
        }
      } catch (e) {}
    })();
    const t0 = setTimeout(run, 4e3);
    const t = setInterval(run, 6e4);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") run(); });
    return () => { alive = false; clearTimeout(t0); clearInterval(t); sub.remove(); };
  }, []);
}
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  render() {
    if (this.state.err) {
      return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
          <Text style={{ color: colors.danger, fontSize: 18, fontWeight: "800" }}>The app hit an error</Text>
          <Text style={{ color: colors.muted, marginVertical: 8 }}>Please screenshot this screen and send it to Claude:</Text>
          <Text selectable style={{ color: colors.text, fontSize: 12 }}>{String(this.state.err && this.state.err.stack || this.state.err)}</Text>
        </ScrollView>;
    }
    return this.props.children;
  }
}
const LOGO_URI = "data:image/png;base64,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";
const logoIcon = ({ focused }) => <Image source={{ uri: LOGO_URI }} style={{ width: 26, height: 26, borderRadius: 13, opacity: focused ? 1 : 0.55 }} />;
const Tab = createBottomTabNavigator();
const tabIcon = (emoji) => ({ focused }) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg, card: colors.card, border: colors.border, primary: colors.green, text: colors.text } };
function App() {
  useForegroundAlerts();
  return <ErrorBoundary><NavigationContainer theme={theme}>
      <StatusBar style="light" />
      <Tab.Navigator screenOptions={{ tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted, headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border } }}>
        <Tab.Screen name="Epoch" component={EpochScreen} options={{ title: "Epoch", tabBarIcon: tabIcon("\u23F3") }} />
        <Tab.Screen name="Wallet" component={WalletScreen} options={{ title: "Wallet", tabBarIcon: tabIcon("\u{1F45B}") }} />
        <Tab.Screen name="Explore" component={ExploreScreen} options={{ title: "Explore", tabBarIcon: tabIcon("\u{1F50E}") }} />
        <Tab.Screen name="Governance" component={GovernanceScreen} options={{ title: "Governance", tabBarIcon: tabIcon("\u{1F5F3}\uFE0F") }} />
        <Tab.Screen name="Alerts" component={AlertsScreen} options={{ title: "Alerts", tabBarIcon: tabIcon("\u{1F514}") }} />
      </Tab.Navigator>
    </NavigationContainer></ErrorBoundary>;
}
var App_default = App;
export {
  App_default as default
};
