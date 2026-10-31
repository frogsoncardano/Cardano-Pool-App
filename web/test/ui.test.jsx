import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/?action=pool', pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = dom.window.getComputedStyle;
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MeshWallet, OfflineFetcher, DEFAULT_PROTOCOL_PARAMETERS } = await import('@meshsdk/core');
const { deserializeTx } = await import('@meshsdk/core-cst');
const { default: App } = await import('../src/App.jsx');

const POOL = 'pool154xmvhp4jnz7phwcla09uvzqnn3ch54lh2yzrt2znxdgc4trp8x';
const L = (a) => String(Math.round(a * 1e6));
let accountFail = true;
let account = { status: 'not registered', delegated_pool: null, delegated_drep: null, rewards_available: '0' };
const submitted = [];
const quiet = console.error; const errors = []; console.error = (...a) => { const m = a.map(String).join(' '); if (!/ReactDOMTestUtils|act\(/.test(m)) errors.push(m.slice(0, 200)); };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const J = (b) => ({ ok: true, status: 200, json: async () => b });
  if (u.includes('/account_info')) { if (accountFail) throw new TypeError('Failed to fetch'); return J([account]); }
  if (u.includes('/pool_info')) return J([{ pool_id_bech32: POOL, meta_json: { ticker: 'LEAP', name: 'Leap pool' }, pool_status: 'registered', live_stake: L(4e6), margin: 0, fixed_cost: L(170), pledge: L(100), live_delegators: 82, live_saturation: 5.08, retiring_epoch: null }]);
  if (u.includes('/pool_list')) return J([{ pool_id_bech32: POOL }]);
  if (u.includes('/drep_info')) return J([{ registered: true, active: true, amount: L(2e6) }]);
  return J([]);
};
// a fake wallet: a real headless Mesh wallet with a funded fake UTxO and a recording submitter
const fetcher = new OfflineFetcher('preprod');
const wallet = new MeshWallet({ networkId: 0, key: { type: 'mnemonic', words: MeshWallet.brew() }, fetcher, submitter: { submitTx: async (tx) => { submitted.push(tx); return 'ab'.repeat(32); } } });
await wallet.init();
const change = await wallet.getChangeAddress();
fetcher.addUTxOs([{ input: { txHash: 'cd'.repeat(32), outputIndex: 0 }, output: { address: change, amount: [{ unit: 'lovelace', quantity: '80000000' }] } }]);
fetcher.addProtocolParameters(DEFAULT_PROTOCOL_PARAMETERS);
const env = { listWallets: () => [{ id: 'fake', name: 'FakeWallet' }], connect: async () => wallet, makeFetcher: async () => fetcher };

const host = document.getElementById('root'); const root = createRoot(host);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => (host.textContent || '').replace(/\s+/g, ' ');
const settle = async (ms = 400) => { await act(async () => { await sleep(ms); }); };
const clickText = async (re, sel = 'button,label,div.pool') => {
  const el = [...host.querySelectorAll(sel)].find((e) => re.test(e.textContent) && !e.disabled);
  if (!el) throw new Error('nothing to click for ' + re + '  |  page: ' + text().slice(0, 300));
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await settle();
};
const typeInto = async (sel, value) => {
  const el = host.querySelector(sel); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); await settle(50);
};
const check = (label, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  -> ' + extra : '')); if (!ok) process.exitCode = 1; };
const certsOf = (hex) => deserializeTx(hex).body().certs().values().map((c) => c.toCore());

await act(async () => { root.render(React.createElement(App, { env })); }); await settle(900);
check('wallet button listed', /FakeWallet/.test(text()));
await clickText(/^FakeWallet$/); await settle(600);
check('connected, test network shown', /Test network \(preprod\)/.test(text()) && /80 ₳/.test(text()));
check('stake address is shown even when chain data is blocked', /Stake address/.test(text()) && /stake_test…/.test(text()), (text().match(/Stake address[^S]{0,24}/) || [''])[0]);
check('blocked chain data is explained and a Retry button appears', /unavailable/.test(text()) && /blocked this browser request/.test(text()) && /Retry/.test(text()));

// search still works while account data is unavailable
await typeInto('input[type=search]', 'LEAP'); await clickText(/^Search$/); await settle(500);
await clickText(/\[LEAP\] Leap pool/, 'div.pool');
check('pool card shown with saturation + fee', /5\.1%/.test(text()) && /170/.test(text()));

// nothing must be built while we do not know the staking status
await clickText(/Review delegation/); await settle(500);
check('no transaction is built without staking status', /could not be read yet/.test(text()) && !/Review before you sign/.test(text()));

// the data comes back after Retry
accountFail = false;
await clickText(/^Retry$/); await settle(600);
check('Retry loads the staking status', /not registered yet/.test(text()) && /none yet/.test(text()) && !/blocked this browser request/.test(text()));

// ---- Stake to LEAP shortcut
await clickText(/^Voting power$/);
await clickText(/Stake to LEAP/);
await settle(800);
check('LEAP shortcut opens the pool tab with LEAP loaded', /Choose a pool/.test(text()) && /\[LEAP\] Leap pool/.test(text()));
await clickText(/Review delegation/); await settle(900);
check('review card has fee and the refundable deposit (first stake)', /Review before you sign/.test(text()) && /Network fee/.test(text()) && /Refundable deposit/.test(text()), (text().match(/Network fee[^A-Z]{0,14}/) || [''])[0]);
await clickText(/Sign in FakeWallet/); await settle(900);
check('success message + tx hash', /Transaction sent/.test(text()));
const tx1 = submitted[0]; const certs1 = tx1 ? certsOf(tx1) : [];
check('signed tx registers stake and delegates to LEAP', certs1.some((c) => c.__typename === 'StakeRegistrationCertificate') && certs1.some((c) => c.__typename === 'StakeDelegationCertificate' && c.poolId === POOL), certs1.map((c) => c.__typename).join(','));

// ---- voting power
await clickText(/^Voting power$/);
await clickText(/Always abstain/, 'label'); await clickText(/^Review$/); await settle(900);
check('review for voting power', /Delegate voting power/.test(text()) && /Always abstain/.test(text()));
await clickText(/Sign in FakeWallet/); await settle(700);
const tx2 = submitted[1]; const certs2 = tx2 ? certsOf(tx2) : [];
check('signed tx delegates voting power (abstain)', certs2.some((c) => c.__typename === 'VoteDelegationCertificate' && c.dRep && c.dRep.__typename === 'AlwaysAbstain'), certs2.map((c) => c.__typename).join(','));

// ---- withdraw is blocked until voting power is chosen, then works
account = { status: 'registered', delegated_pool: POOL, delegated_drep: null, rewards_available: L(12.5) };
await clickText(/^FakeWallet$|Disconnect/).catch(() => {});
if (/Disconnect/.test(text())) await clickText(/^Disconnect$/);
await clickText(/^FakeWallet$/); await settle(600);
await clickText(/^Withdraw rewards$/);
check('withdraw explains the voting-power rule when none is set', /only lets you withdraw rewards after you delegate/.test(text()));
account = { ...account, delegated_drep: 'drep_always_abstain' };
await clickText(/^Disconnect$/); await clickText(/^FakeWallet$/); await settle(600);
await clickText(/^Withdraw rewards$/); await clickText(/Review withdrawal/); await settle(900);
check('review for withdrawal', /Withdraw rewards/.test(text()) && /12\.5 ₳/.test(text()));
await clickText(/Sign in FakeWallet/); await settle(700);
const tx3 = submitted[2]; const wd = tx3 ? deserializeTx(tx3).body().withdrawals() : null;
check('signed tx withdraws 12.5 ADA', !!wd && [...wd.entries()].some(([, v]) => String(v) === L(12.5)));
check('no React errors', errors.length === 0, errors.slice(0, 2).join(' | '));
process.exit(process.exitCode || 0);
