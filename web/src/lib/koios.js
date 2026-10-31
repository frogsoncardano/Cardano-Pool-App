// Read-only chain data from Koios (public API). Never involves keys.
const HOSTS = {
  mainnet: 'https://api.koios.rest/api/v1',
  preprod: 'https://preprod.koios.rest/api/v1',
  preview: 'https://preview.koios.rest/api/v1',
};

// Koios blocks browser requests (CORS) on its anonymous public tier. A free Koios API token lifts that.
// The token is added at build time from the KOIOS_TOKEN secret in GitHub (see README).
const TOKEN = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_KOIOS_TOKEN) || '';
export const hasKoiosToken = !!TOKEN;

export function koios(network) {
  const base = HOSTS[network] || HOSTS.mainnet;
  const call = async (path, body) => {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
    let r;
    try {
      r = await fetch(base + path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
    } catch (e) {
      // a blocked (CORS) or offline request looks the same to the browser
      throw new Error(TOKEN ? 'Could not reach the chain data service. Check your connection and retry.' : 'The chain data service blocked this browser request. Frog Labs needs a Koios API token for the website (see README).');
    }
    if (r.status === 401 || r.status === 403) throw new Error('The chain data service rejected our API token. It may have expired.');
    if (r.status === 429) throw new Error('The chain data service is busy right now. Retry in a few seconds.');
    if (!r.ok) throw new Error(`The chain data service answered with an error (${r.status}).`);
    return r.json();
  };
  return {
    accountInfo: (stake) => call('/account_info', { _stake_addresses: [stake] }).then((r) => r[0] || null),
    poolInfo: (id) => call('/pool_info', { _pool_bech32_ids: [id] }).then((r) => r[0] || null),
    poolInfos: (ids) => (ids.length ? call('/pool_info', { _pool_bech32_ids: ids }) : Promise.resolve([])),
    searchPools: async (q) => {
      const list = await call(`/pool_list?ticker=ilike.*${encodeURIComponent(q.trim())}*&pool_status=eq.registered&limit=12`);
      const infos = await call('/pool_info', { _pool_bech32_ids: list.map((p) => p.pool_id_bech32) });
      return infos.sort((a, b) => Number(b.live_stake || 0) - Number(a.live_stake || 0));
    },
    drepInfo: (id) => call('/drep_info', { _drep_ids: [id] }).then((r) => r[0] || null),
  };
}
