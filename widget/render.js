import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FrogsWidget, PoolMiniWidget, PriceWidget } from './FrogsWidget';
import { loadWidgetData, loadPrice, POOL_ID } from './data';

export const WIDGET_NAMES = ['FrogsPool', 'FrogsPoolMini', 'FrogsAda', 'FrogsNight', 'FrogsBtc'];
// CoinGecko ids for the price widgets (NIGHT = Midnight)
const COIN = { FrogsAda: 'cardano', FrogsNight: 'midnight-3', FrogsBtc: 'bitcoin' };
export const TIMEOUT = { ms: 20000 };

const pad = (n) => String(n).padStart(2, '0');
const clock = () => {
  const t = new Date();
  return pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
};
const withTimeout = (p) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), TIMEOUT.ms))]);

// The pool shown on the pool widgets can be changed in the app (Explore > pool > "Use for widget").
async function widgetPool() {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem('widget:pool'));
    if (saved && saved.id) return saved.id;
  } catch (e) {}
  return POOL_ID;
}

const cacheKey = (name) => 'widget:cache:' + name;

function view(name, d, error) {
  if (COIN[name]) return <PriceWidget d={d} error={error} />;
  if (name === 'FrogsPoolMini') return <PoolMiniWidget d={d} error={error} />;
  return <FrogsWidget d={d} error={error} time={clock()} />;
}

// Last good data for this widget type (or null)
export async function readCache(name) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(name));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Something to paint immediately so a widget is never blank: cached data, or a "Loading…" placeholder.
export async function instantView(name) {
  const cached = await readCache(name);
  return { element: view(name, cached, null), hasCache: !!cached };
}

// Loads fresh data (with a timeout), remembers it, and returns the widget element. Throws on failure.
export async function freshView(name) {
  const d = COIN[name]
    ? await withTimeout(loadPrice(COIN[name]))
    : await withTimeout(loadWidgetData(await widgetPool()));
  try {
    await AsyncStorage.setItem(cacheKey(name), JSON.stringify(d));
  } catch (e) {}
  return view(name, d, null);
}

export const errorView = (name, e) => view(name, null, String((e && e.message) || e));
