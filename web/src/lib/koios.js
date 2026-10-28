// Read-only chain data from Koios (public API). Never involves keys.
const HOSTS = {
  mainnet: 'https://api.koios.rest/api/v1',
  preprod: 'https://preprod.koios.rest/api/v1',
  preview: 'https://preview.koios.rest/api/v1',
};

export function koios(network) {
  const base = HOSTS[network] || HOSTS.mainnet;
  const call = async (path, body) => {
    const r = await fetch(base + path, body
      ? { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`Koios ${r.status}`);
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
