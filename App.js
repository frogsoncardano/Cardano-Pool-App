import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
const Tab = createBottomTabNavigator();
const tabIcon = (emoji) => ({ focused }) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg, card: colors.card, border: colors.border, primary: colors.green, text: colors.text } };
function App() {
  return <ErrorBoundary><NavigationContainer theme={theme}>
      <StatusBar style="light" />
      <Tab.Navigator screenOptions={{ tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted, headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border } }}>
        <Tab.Screen name="Frogs Pool" component={PoolScreen} options={{ title: "Frogs Pool", tabBarIcon: tabIcon("\u{1F438}") }} />
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
