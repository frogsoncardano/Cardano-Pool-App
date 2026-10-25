import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FrogsWidget, PoolMiniWidget, PriceWidget } from './FrogsWidget';
import { loadWidgetData, loadPrice, POOL_ID } from './data';

const pad = (n) => String(n).padStart(2, '0');
const clock = () => {
  const t = new Date();
  return pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
};

// CoinGecko ids for the price widgets (NIGHT = Midnight)
const COIN = { FrogsAda: 'cardano', FrogsNight: 'midnight-3', FrogsBtc: 'bitcoin' };

// The pool shown on the pool widgets can be changed in the app (Explore > pool > "Use for widget").
async function widgetPool() {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem('widget:pool'));
    if (saved && saved.id) return saved.id;
  } catch (e) {}
  return POOL_ID;
}

async function draw(props) {
  const name = props.widgetInfo && props.widgetInfo.widgetName;
  try {
    if (COIN[name]) {
      const d = await loadPrice(COIN[name]);
      props.renderWidget(<PriceWidget d={d} />);
    } else if (name === 'FrogsPoolMini') {
      const d = await loadWidgetData(await widgetPool());
      props.renderWidget(<PoolMiniWidget d={d} />);
    } else {
      const d = await loadWidgetData(await widgetPool());
      props.renderWidget(<FrogsWidget d={d} time={clock()} />);
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (COIN[name]) props.renderWidget(<PriceWidget error={msg} />);
    else if (name === 'FrogsPoolMini') props.renderWidget(<PoolMiniWidget error={msg} />);
    else props.renderWidget(<FrogsWidget error={msg} time={clock()} />);
  }
}

export async function widgetTaskHandler(props) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      await draw(props);
      break;
    case 'WIDGET_CLICK':
      if (props.clickAction === 'REFRESH') await draw(props);
      break;
    default:
      break;
  }
}
