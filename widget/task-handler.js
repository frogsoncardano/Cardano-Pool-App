import { instantView, freshView, errorView } from './render';
import { runAlertChecks } from '../alerts/engine';
import { notify } from '../alerts/notify';

// Widgets refresh about every 30 minutes, so piggy-back an alert check on that (the engine ignores
// repeated calls within a few minutes, so five widgets don't mean five checks).
async function checkAlerts() {
  try {
    await Promise.race([runAlertChecks({ notify }), new Promise((resolve) => setTimeout(resolve, 25000))]);
  } catch (e) {}
}

// Paint something right away (cached data or "Loading…"), then refresh. If the refresh fails and there
// was cached data, keep showing it; otherwise show the error. A widget is never left blank.
async function draw(props) {
  const name = props.widgetInfo && props.widgetInfo.widgetName;
  let hasCache = false;
  try {
    const first = await instantView(name);
    hasCache = first.hasCache;
    props.renderWidget(first.element);
  } catch (e) {}
  try {
    props.renderWidget(await freshView(name));
  } catch (e) {
    if (!hasCache) {
      try {
        props.renderWidget(errorView(name, e));
      } catch (e2) {}
    }
  }
}

export async function widgetTaskHandler(props) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_RESIZED':
      await draw(props);
      break;
    case 'WIDGET_UPDATE':
      await draw(props);
      await checkAlerts();
      break;
    case 'WIDGET_CLICK':
      if (props.clickAction === 'REFRESH') await draw(props);
      break;
    default:
      break;
  }
}
