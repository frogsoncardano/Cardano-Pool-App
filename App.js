import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
const getPoolBlocks = (id) => get(`/pool_blocks?_pool_bech32=${id}`);
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
const getAccountAssets = (stake) => post("/account_assets", { _stake_addresses: [stake] }).then((r) => r[0]?.asset_list ?? []);

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
  const blocks = useAsync(() => getPoolBlocks(poolId), [poolId]);
  const dels = useAsync(() => getDelegators(poolId), [poolId]);
  const tip = useAsync(() => getTip(), []);
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
  const epochBlocks = curEpoch != null ? recentBlocks.filter((b) => b.epoch_no === curEpoch).length : null;
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
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800" }}>
          [{meta.ticker ?? "\u2014"}] {meta.name ?? ""}
        </Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>{meta.description ?? ""}</Text>
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

      <Title>Top delegators ({topDelegators.length})</Title>
      <Card>
        {dels.loading ? <Loading /> : topDelegators.slice(0, 25).map((d) => <Row key={d.stake_address} label={short(d.stake_address, 8)} value={`${ada(d.amount).toLocaleString("en-US", { maximumFractionDigits: 0 })} \u20B3`} />)}
      </Card>
    </Screen>;
}
function PoolScreen() {
  if (POOL_ID.includes("REPLACE_ME")) return <ErrorText msg="Set POOL_ID in src/config.ts" />;
  return <PoolDetail poolId={POOL_ID} />;
}
function EpochScreen() {
  const { data, error, loading, reload } = useAsync(async () => {
    const tip2 = await getTip();
    const ep2 = await getEpoch(tip2.epoch_no);
    return { tip: tip2, ep: ep2 };
  });
  const [now, setNow] = useState(Date.now() / 1e3);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1e3), 1e3);
    return () => clearInterval(t);
  }, []);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorText msg={error ?? "No data"} />;
  const { tip, ep } = data;
  const left = Math.max(0, ep.end_time - now);
  const pct = (EPOCH_SECONDS - left) / EPOCH_SECONDS * 100;
  const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), sec = Math.floor(left % 60);
  return <Screen onRefresh={reload} refreshing={loading}>
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
    </Screen>;
}
const KEY = "wallet:stake";
function WalletScreen() {
  const [input, setInput] = useState("");
  const [stake, setStake] = useState(null);
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
      const s2 = await resolveStake(input);
      await AsyncStorage.setItem(KEY, s2);
      setStake(s2);
      load(s2);
    } catch (e) {
      setErr(e.message);
    }
  }
  async function disconnect() {
    await AsyncStorage.removeItem(KEY);
    setStake(null);
    setAcc(null);
    setInput("");
  }
  useEffect(() => {
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
        <Card>
          <TextInput
      value={input}
      onChangeText={setInput}
      placeholder="stake1… or addr1…"
      placeholderTextColor={colors.muted}
      autoCapitalize="none"
      autoCorrect={false}
      style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 }}
    />
          <Pressable onPress={connect} style={{ backgroundColor: colors.green, borderRadius: 10, padding: 12, marginTop: 12 }}>
            <Text style={{ textAlign: "center", fontWeight: "800", color: "#04210F" }}>Connect</Text>
          </Pressable>
          {err && <ErrorText msg={err} />}
        </Card>
      </Screen>;
  return <Screen onRefresh={() => load(stake)} refreshing={loading}>
      {loading && !acc ? <Loading /> : <>
          <Card>
            <Text style={{ color: colors.muted }}>Total balance</Text>
            <Text style={{ color: colors.green, fontSize: 32, fontWeight: "800" }}>{fmtAda(acc?.total_balance, 2)}</Text>
            <Row label="Stake address" value={short(stake, 10)} />
            <Row label="Delegated pool" value={acc?.delegated_pool ? short(acc.delegated_pool, 10) : "Not delegated"} />
            <Row label="Rewards available" value={fmtAda(acc?.rewards_available, 2)} />
            <Row label="Withdrawn" value={fmtAda(acc?.withdrawals_sum, 2)} />
          </Card>
          <Title>Rewards history</Title>
          <Card>
            {rewards.slice(0, 15).map((r, i) => <Row key={i} label={`Epoch ${r.earned_epoch} (${r.type})`} value={`+${ada(r.amount).toFixed(2)} \u20B3`} />)}
            {rewards.length === 0 && <Text style={{ color: colors.muted }}>No rewards yet</Text>}
          </Card>
          <Title>Assets ({assets.length})</Title>
          <Card>
            {assets.slice(0, 20).map((a, i) => <Row key={i} label={short(a.policy_id, 6)} value={`${a.quantity}`} />)}
          </Card>
          <Pressable onPress={disconnect}><Text style={{ color: colors.danger, textAlign: "center", marginTop: 8 }}>Disconnect</Text></Pressable>
        </>}
      {err && <ErrorText msg={err} />}
    </Screen>;
}
function PoolRow({ p, onPress, fav, onFav }) {
  const meta = p.meta_json || {};
  const sat = Number(p.live_saturation || 0);
  return <Pressable onPress={onPress} style={{ paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: 1 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.text, fontWeight: "700", flexShrink: 1 }}>[{meta.ticker ?? "\u2014"}] {meta.name ?? ""}</Text>
        {onFav ? <Pressable onPress={onFav} hitSlop={12}><Text style={{ color: colors.lime, fontSize: 22 }}>{fav ? "\u2605" : "\u2606"}</Text></Pressable> : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
        {human(p.live_stake)} · {p.live_delegators ?? 0} delegators · {p.block_count ?? 0} blocks · sat {sat.toFixed(1)}% · margin {(Number(p.margin || 0) * 100).toFixed(1)}%
      </Text>
      <Bar pct={sat} />
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
  return <Screen>
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
  return <ErrorBoundary><NavigationContainer theme={theme}>
      <StatusBar style="light" />
      <Tab.Navigator screenOptions={{ tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted, headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border } }}>
        <Tab.Screen name="Frogs Pool" component={PoolScreen} options={{ title: "Frogs Pool", tabBarIcon: logoIcon }} />
        <Tab.Screen name="Epoch" component={EpochScreen} options={{ title: "Epoch", tabBarIcon: tabIcon("\u23F3") }} />
        <Tab.Screen name="Wallet" component={WalletScreen} options={{ title: "Wallet", tabBarIcon: tabIcon("\u{1F45B}") }} />
        <Tab.Screen name="Explore" component={ExploreScreen} options={{ title: "Explore", tabBarIcon: tabIcon("\u{1F50E}") }} />
      </Tab.Navigator>
    </NavigationContainer></ErrorBoundary>;
}
var App_default = App;
export {
  App_default as default
};
