// The only place that touches real wallets / network providers, so tests can swap it out.
// Mesh is big, so it is loaded only when the user actually connects a wallet.
export const realEnv = {
  // CIP-30 wallets announce themselves on window.cardano
  listWallets: () => {
    try {
      const out = [];
      for (const id of Object.keys(window.cardano || {})) {
        const w = window.cardano[id];
        if (w && w.name && typeof w.enable === 'function') out.push({ id, name: w.name, icon: w.icon });
      }
      return out;
    } catch (e) {
      return [];
    }
  },
  // Ask for CIP-95 (governance) support first; fall back to a plain connection for wallets without it.
  connect: async (id) => {
    const { BrowserWallet } = await import('@meshsdk/core');
    try {
      return await BrowserWallet.enable(id, [{ cip: 95 }]);
    } catch (e) {
      return BrowserWallet.enable(id);
    }
  },
  makeFetcher: async (network) => {
    const { KoiosProvider } = await import('@meshsdk/core');
    const token = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_KOIOS_TOKEN) || undefined;
    return new KoiosProvider(network === 'mainnet' ? 'api' : network, token);
  },
};
