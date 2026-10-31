import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { realEnv } from './lib/wallets.js';
import { koios } from './lib/koios.js';
import { normalizePoolId, isDRepId, short, fmtAda, ada } from './lib/ids.js';
import { friendlyError } from './lib/errors.js';
import { FROG_POOL } from './config.js';

const EXPLORER = { mainnet: 'https://cexplorer.io/tx/', preprod: 'https://preprod.cexplorer.io/tx/', preview: 'https://preview.cexplorer.io/tx/' };
const TABS = [['pool', 'Stake to a pool'], ['drep', 'Voting power'], ['withdraw', 'Withdraw rewards']];

const Row = ({ label, value, cls }) => (
  <div className="row"><span>{label}</span><span className={cls}>{value}</span></div>
);

export default function App({ env = realEnv }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [tab, setTab] = useState(TABS.some((t) => t[0] === params.get('action')) ? params.get('action') : 'pool');
  const [wallets, setWallets] = useState([]);
  const [testNet, setTestNet] = useState('preprod');
  const [conn, setConn] = useState(null); // connected wallet and what we learned about it
  const [account, setAccount] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [preset, setPreset] = useState({ pool: params.get('pool') || '', n: 0 });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);
  const [result, setResult] = useState(null);

  // wallets inject themselves a moment after the page loads, so look for a few seconds
  useEffect(() => {
    let n = 0;
    const look = () => setWallets(env.listWallets());
    look();
    const t = setInterval(() => { look(); if (++n > 12) clearInterval(t); }, 700);
    return () => clearInterval(t);
  }, [env]);

  const network = conn ? conn.network : 'mainnet';
  const k = useMemo(() => koios(network), [network]);

  // Reads staking status (registered? which pool? which DRep? rewards?). It must succeed before we build anything,
  // because the transaction depends on it (for example whether the stake address still needs registering).
  const refreshAccount = useCallback(async (c) => {
    setAccountError('');
    try {
      const info = await koios(c.network).accountInfo(c.rewardAddress);
      setAccount(info || { status: 'not registered' });
    } catch (e) {
      setAccount(null);
      setAccountError(String((e && e.message) || e));
    }
  }, []);

  async function connect(id, name) {
    setError(''); setResult(null); setReview(null); setBusy('Connecting…');
    try {
      const api = await env.connect(id);
      const networkId = await api.getNetworkId();
      const net = networkId === 1 ? 'mainnet' : testNet;
      const [change, rewards] = await Promise.all([api.getChangeAddress(), api.getRewardAddresses()]);
      if (!rewards || !rewards[0]) throw new Error('This wallet account has no stake address, so it cannot stake.');
      let lovelace = '0';
      try { lovelace = String(await api.getLovelace()); } catch (e) {}
      const c = { id, name, api, networkId, network: net, change, rewardAddress: rewards[0], lovelace };
      setConn(c);
      await refreshAccount(c);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy('');
  }
  function disconnect() { setConn(null); setAccount(null); setAccountError(''); setReview(null); setResult(null); setError(''); }
  async function switchTestNet(v) {
    setTestNet(v);
    if (conn && conn.networkId !== 1) { const c = { ...conn, network: v }; setConn(c); await refreshAccount(c); }
  }

  // Build the transaction, read it back, and show it for review. Nothing is signed yet.
  async function prepare(kind, ctxExtra, lines) {
    setError(''); setResult(null);
    if (!account) { setError('Your staking status could not be read yet, so nothing was built. Tap "Retry" in the wallet card and try again.'); return; }
    setBusy('Building the transaction…');
    try {
      const fetcher = await env.makeFetcher(conn.network);
      const { buildPoolDelegation, buildVoteDelegation, buildWithdrawal, describeTx } = await import('./lib/tx.js');
      const utxos = await conn.api.getUtxos();
      if (!utxos || utxos.length === 0) throw new Error('Your wallet has no spendable ADA, so it cannot pay the network fee.');
      const register = account.status !== 'registered';
      const ctx = { network: conn.network, fetcher, utxos, changeAddress: conn.change, rewardAddress: conn.rewardAddress, register, ...ctxExtra };
      const hex = kind === 'pool' ? await buildPoolDelegation(ctx) : kind === 'drep' ? await buildVoteDelegation(ctx) : await buildWithdrawal(ctx);
      const d = describeTx(hex);
      setReview({ kind, hex, fee: d.feeLovelace, registers: d.registersStake, lines });
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy('');
  }

  async function signAndSend() {
    setError(''); setBusy('Waiting for your wallet…');
    try {
      const signed = await conn.api.signTx(review.hex);
      setBusy('Sending…');
      const hash = await conn.api.submitTx(signed);
      setResult({ hash, kind: review.kind });
      setReview(null);
      setTimeout(() => refreshAccount(conn), 20000);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy('');
  }

  return (
    <>
      <header>
        <img src="./logo.png" alt="Frog Labs" />
        <div><h1>Frog Labs · Wallet actions</h1><div className="sub">Your keys stay in your wallet. We build the transaction, you check it and sign it there.</div></div>
      </header>

      <WalletCard {...{ wallets, conn, account, accountError, busy, connect, disconnect, testNet, switchTestNet, k, retry: () => refreshAccount(conn) }} />

      {error ? <div className="card bad"><span className="badText">{error}</span></div> : null}
      {busy ? <div className="card"><span className="muted">{busy}</span></div> : null}

      {result ? (
        <div className="card ok">
          <b className="good">Transaction sent</b>
          <div className="muted" style={{ margin: '6px 0' }}>{short(result.hash, 12)}</div>
          <a href={EXPLORER[network] + result.hash} target="_blank" rel="noreferrer">View on Cexplorer</a>
          <div className="muted" style={{ marginTop: 8 }}>
            {result.kind === 'pool' ? 'Staking becomes active after about 2 epochs (around 10–15 days); the first rewards arrive about 2 epochs after that.' : result.kind === 'drep' ? 'Your voting power choice is recorded once the transaction is confirmed (about a minute). After that you can withdraw rewards.' : 'Your rewards will arrive in your wallet once the transaction is confirmed (about a minute).'}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="./logo.png" alt="" style={{ width: 40, height: 40, borderRadius: '50%' }} />
        <div style={{ flex: 1 }}>
          <b>Stake with Frog Labs</b>
          <div className="muted">Pool [{FROG_POOL.ticker}] · you sign in your own wallet</div>
        </div>
        <button className="ghost" onClick={() => { setTab('pool'); setReview(null); setResult(null); setError(''); setPreset((p) => ({ pool: FROG_POOL.id, n: p.n + 1 })); }}>Stake to {FROG_POOL.ticker}</button>
      </div>

      <div className="tabs">{TABS.map(([id, label]) => <button key={id} className={'tab' + (tab === id ? ' active' : '')} onClick={() => { setTab(id); setReview(null); setError(''); }}>{label}</button>)}</div>

      {!conn ? <div className="card"><span className="muted">Connect a wallet above to continue.</span></div> : (
        <>
          {tab === 'pool' && <PoolTab {...{ k, preset, prepare, account, busy }} />}
          {tab === 'drep' && <DRepTab {...{ k, params, prepare, account, busy }} />}
          {tab === 'withdraw' && <WithdrawTab {...{ prepare, account, busy, goVoting: () => setTab('drep') }} />}
        </>
      )}

      {review ? <ReviewCard {...{ review, conn, busy, signAndSend, cancel: () => setReview(null) }} /> : null}

      <p className="muted" style={{ marginTop: 24 }}>
        Frog Labs is not a wallet and never sees your keys or recovery phrase. Never type your recovery phrase on any website. Always check the amounts and addresses your wallet shows before you approve.
      </p>
    </>
  );
}

function WalletCard({ wallets, conn, account, accountError, busy, connect, disconnect, testNet, switchTestNet, k, retry }) {
  const [poolName, setPoolName] = useState('');
  useEffect(() => {
    let alive = true;
    setPoolName('');
    if (account && account.delegated_pool) k.poolInfo(account.delegated_pool).then((p) => { if (alive && p) setPoolName(`[${(p.meta_json && p.meta_json.ticker) || '?'}]`); }).catch(() => {});
    return () => { alive = false; };
  }, [account && account.delegated_pool, k]);
  if (!conn) {
    return (
      <div className="card">
        <b>Connect your wallet</b>
        {wallets.length === 0 ? (
          <p className="muted">No Cardano wallet found in this browser yet. On your phone, open this page inside your wallet's own browser (Eternl, Vespr, Begin and others have one). On a computer, use a browser with a wallet extension such as Eternl or Lace.</p>
        ) : wallets.map((w) => (
          <button key={w.id} className="wallet" disabled={!!busy} onClick={() => connect(w.id, w.name)}>
            {w.icon ? <img src={w.icon} alt="" /> : null}<span>{w.name}</span>
          </button>
        ))}
      </div>
    );
  }
  const drep = account && account.delegated_drep;
  const drepText = !drep ? 'none yet' : drep === 'drep_always_abstain' ? 'Always abstain' : drep === 'drep_always_no_confidence' ? 'Always no confidence' : short(drep, 8);
  return (
    <div className="card">
      <div className="row"><b>{conn.name}</b><button className="ghost" onClick={disconnect}>Disconnect</button></div>
      <Row label="Network" value={conn.network === 'mainnet' ? 'Mainnet' : `Test network (${conn.network})`} cls={conn.network === 'mainnet' ? 'good' : 'warnText'} />
      {conn.networkId !== 1 ? (
        <div className="row"><span>Test network</span><select value={testNet} onChange={(e) => switchTestNet(e.target.value)}><option value="preprod">preprod</option><option value="preview">preview</option></select></div>
      ) : null}
      <Row label="Address" value={short(conn.change, 10)} />
      <Row label="Balance" value={fmtAda(conn.lovelace)} />
      <Row label="Stake address" value={short(conn.rewardAddress, 10)} />
      <Row label="Stake status" value={account ? (account.status === 'registered' ? 'registered' : 'not registered yet') : accountError ? 'unavailable' : 'checking…'} cls={accountError ? 'warnText' : ''} />
      <Row label="Staked to" value={account && account.delegated_pool ? poolName || short(account.delegated_pool, 8) : 'no pool yet'} />
      <Row label="Voting power" value={drepText} cls={drep ? '' : 'warnText'} />
      <Row label="Rewards available" value={account ? fmtAda(account.rewards_available) : '…'} />
      {accountError ? (
        <div style={{ marginTop: 8 }}>
          <div className="warnText" style={{ fontSize: 13 }}>{accountError}</div>
          <button className="ghost" style={{ marginTop: 8 }} onClick={retry}>Retry</button>
        </div>
      ) : null}
    </div>
  );
}

function PoolTab({ k, preset, prepare, account, busy }) {
  const [q, setQ] = useState(preset.pool || '');
  const [results, setResults] = useState([]);
  const [pool, setPool] = useState(null);
  const [msg, setMsg] = useState('');
  const search = useCallback(async (text) => {
    setMsg(''); setResults([]); setPool(null);
    const id = normalizePoolId(text);
    try {
      if (id) { const p = await k.poolInfo(id); if (p) setPool(p); else setMsg('No pool with that ID was found.'); }
      else if (text.trim().length >= 2) { const r = await k.searchPools(text); setResults(r); if (r.length === 0) setMsg('No pools found.'); }
    } catch (e) { setMsg('Could not reach the pool data service. Try again in a moment.'); }
  }, [k]);
  useEffect(() => { if (preset.pool) { setQ(preset.pool); search(preset.pool); } }, [preset.n]); // eslint-disable-line
  const meta = (pool && pool.meta_json) || {};
  const sat = pool ? Number(pool.live_saturation || 0) : 0;
  const retiring = pool && (pool.retiring_epoch != null || (pool.pool_status && pool.pool_status !== 'registered'));
  const alreadyThere = pool && account && account.delegated_pool === pool.pool_id_bech32;
  return (
    <div className="card">
      <b>Choose a pool</b>
      <input type="search" placeholder="Pool ticker or pool ID (pool1…)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(q)} />
      <button className="ghost" style={{ marginTop: 8 }} onClick={() => search(q)}>Search</button>
      {msg ? <p className="muted">{msg}</p> : null}
      {results.map((p) => (
        <div key={p.pool_id_bech32} className="pool" onClick={() => { setPool(p); setResults([]); }}>
          <b>[{(p.meta_json && p.meta_json.ticker) || '?'}] {(p.meta_json && p.meta_json.name) || ''}</b>
          <div className="muted">{fmtAda(p.live_stake, 0)} · saturation {Number(p.live_saturation || 0).toFixed(1)}% · margin {(Number(p.margin || 0) * 100).toFixed(1)}%</div>
        </div>
      ))}
      {pool ? (
        <div style={{ marginTop: 12 }}>
          <b>[{meta.ticker || '?'}] {meta.name || ''}</b>
          <Row label="Live stake" value={fmtAda(pool.live_stake, 0)} />
          <Row label="Saturation" value={`${sat.toFixed(1)}%`} cls={sat >= 95 ? 'warnText' : ''} />
          <Row label="Delegators" value={String(pool.live_delegators ?? '—')} />
          <Row label="Margin" value={`${(Number(pool.margin || 0) * 100).toFixed(2)}%`} />
          <Row label="Fixed fee / epoch" value={fmtAda(pool.fixed_cost, 0)} />
          <Row label="Pledge" value={fmtAda(pool.pledge, 0)} />
          {sat >= 95 ? <p className="warnText">This pool is nearly saturated. Rewards shrink above 100%.</p> : null}
          {retiring ? <p className="badText">This pool is retiring or not active, so you cannot stake to it.</p> : null}
          {alreadyThere ? <p className="muted">You are already staked to this pool.</p> : null}
          <button className="primary" disabled={!!busy || retiring || alreadyThere}
            onClick={() => prepare('pool', { poolBech32: pool.pool_id_bech32 }, [['Action', `Stake to [${meta.ticker || '?'}] ${meta.name || ''}`], ['Pool', short(pool.pool_id_bech32, 10)]])}>
            Review delegation
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DRepTab({ k, params, prepare, account, busy }) {
  const initial = params.get('drep');
  const [choice, setChoice] = useState(initial ? 'drep' : 'abstain');
  const [id, setId] = useState(initial || '');
  const [info, setInfo] = useState(undefined); // undefined: not looked up, null: not found
  const [msg, setMsg] = useState('');
  const check = useCallback(async (value) => {
    setMsg(''); setInfo(undefined);
    if (!isDRepId(value)) { setMsg('That does not look like a DRep ID (it starts with drep1…).'); return; }
    try { setInfo(await k.drepInfo(value.trim())); } catch (e) { setMsg('Could not look that DRep up right now.'); }
  }, [k]);
  useEffect(() => { if (initial) check(initial); }, []); // eslint-disable-line
  const registered = info && info.registered !== false;
  const drepOk = choice !== 'drep' || (isDRepId(id) && info !== null);
  const label = choice === 'abstain' ? 'Always abstain' : choice === 'noconf' ? 'Always no confidence' : `DRep ${short(id.trim(), 8)}`;
  const drepArg = choice === 'abstain' ? { alwaysAbstain: null } : choice === 'noconf' ? { alwaysNoConfidence: null } : { dRepId: id.trim() };
  const Opt = ({ v, title, text }) => (
    <label className={'radio' + (choice === v ? ' on' : '')} onClick={() => setChoice(v)}><b>{title}</b><div className="muted">{text}</div></label>
  );
  return (
    <div className="card">
      <b>Delegate your voting power</b>
      <p className="muted">Your ADA never moves. You only say who votes on governance for you. Cardano requires this choice before you can withdraw staking rewards.</p>
      <Opt v="abstain" title="Always abstain" text="You are not counted in governance votes. The simplest choice if you don't want to take part." />
      <Opt v="noconf" title="Always no confidence" text="Your stake counts as a vote of no confidence in the current constitutional committee." />
      <Opt v="drep" title="A specific DRep" text="Pick someone who votes for you. Paste their DRep ID." />
      {choice === 'drep' ? (
        <>
          <input type="text" placeholder="drep1…" value={id} onChange={(e) => { setId(e.target.value); setInfo(undefined); }} />
          <button className="ghost" style={{ marginTop: 8 }} onClick={() => check(id)}>Look up DRep</button>
          {msg ? <p className="warnText">{msg}</p> : null}
          {info === null ? <p className="badText">No DRep with that ID is registered.</p> : null}
          {info ? (
            <div style={{ marginTop: 8 }}>
              <Row label="Registered" value={registered ? 'yes' : 'no'} cls={registered ? 'good' : 'badText'} />
              <Row label="Active" value={info.active ? 'yes' : 'no'} cls={info.active ? 'good' : 'warnText'} />
              <Row label="Voting power" value={fmtAda(info.amount, 0)} />
              {info.active === false ? <p className="warnText">This DRep looks inactive; inactive DReps' voting power is not counted.</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
      <button className="primary" disabled={!!busy || !drepOk} onClick={() => prepare('drep', { drep: drepArg }, [['Action', 'Delegate voting power'], ['Choice', label]])}>
        Review
      </button>
    </div>
  );
}

function WithdrawTab({ prepare, account, busy, goVoting }) {
  const rewards = account ? Number(account.rewards_available || 0) : 0;
  const hasDrep = !!(account && account.delegated_drep);
  return (
    <div className="card">
      <b>Withdraw staking rewards</b>
      <Row label="Rewards available" value={fmtAda(rewards)} cls={rewards > 0 ? 'good' : ''} />
      {rewards <= 0 ? <p className="muted">There is nothing to withdraw yet. Rewards arrive about 2 epochs (10 days) after you start staking.</p> : null}
      {rewards > 0 && !hasDrep ? (
        <>
          <p className="warnText">Cardano only lets you withdraw rewards after you delegate your voting power (to a DRep, or to Abstain / No confidence). Your rewards keep growing meanwhile.</p>
          <button className="ghost" onClick={goVoting}>Choose voting power first</button>
        </>
      ) : null}
      <button className="primary" disabled={!!busy || rewards <= 0 || !hasDrep}
        onClick={() => prepare('withdraw', { rewardLovelace: String(account.rewards_available) }, [['Action', 'Withdraw rewards'], ['Amount', fmtAda(rewards)]])}>
        Review withdrawal
      </button>
    </div>
  );
}

function ReviewCard({ review, conn, busy, signAndSend, cancel }) {
  const deposit = review.registers ? 2 : 0;
  return (
    <div className="card ok">
      <b>Review before you sign</b>
      {review.lines.map(([a, b]) => <Row key={a} label={a} value={b} />)}
      <Row label="Wallet" value={`${conn.name} · ${short(conn.change, 8)}`} />
      <Row label="Network" value={conn.network} />
      <Row label="Network fee" value={fmtAda(review.fee, 3)} />
      {deposit ? <Row label="Refundable deposit" value={`${deposit} ₳ (first-time stake registration)`} /> : null}
      <p className="muted">Your wallet will show these same details next. If anything differs from what you see here, cancel.</p>
      <button className="primary" disabled={!!busy} onClick={signAndSend}>Sign in {conn.name}</button>
      <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={cancel}>Cancel</button>
    </div>
  );
}
