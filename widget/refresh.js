import { requestWidgetUpdate } from 'react-native-android-widget';
import { WIDGET_NAMES, instantView, freshView } from './render';

// Repaints every widget that is on the home screen. Called whenever the app starts, so a widget that
// came up blank (for example because the phone blocked its background task) is fixed by opening the app.
export function refreshAllWidgets() {
  for (const widgetName of WIDGET_NAMES) {
    try {
      requestWidgetUpdate({
        widgetName,
        renderWidget: async () => {
          try {
            return await freshView(widgetName);
          } catch (e) {
            return (await instantView(widgetName)).element;
          }
        },
        widgetNotFound: () => {},
      }).catch(() => {});
    } catch (e) {}
  }
}
