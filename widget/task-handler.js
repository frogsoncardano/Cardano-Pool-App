import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FrogsWidget, FrogsBlocksWidget } from './FrogsWidget';
import { loadWidgetData, POOL_ID } from './data';

const pad = (n) => String(n).padStart(2, '0');
const clock = () => {
  const t = new Date();
  return pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
};

// The pool shown on the widgets can be changed in the app (Explore > pool > "Use for widget").
async function widgetPool() {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem('widget:pool'));
    if (saved && saved.id) return saved.id;
  } catch (e) {}
  return POOL_ID;
}

async function draw(props) {
  const small = props.widgetInfo && props.widgetInfo.widgetName === 'FrogsBlocks';
  const View = small ? FrogsBlocksWidget : FrogsWidget;
  try {
    const d = await loadWidgetData(await widgetPool());
    props.renderWidget(<View d={d} time={clock()} />);
  } catch (e) {
    props.renderWidget(<View error={String((e && e.message) || e)} time={clock()} />);
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
