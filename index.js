import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import App from './App';
import { widgetTaskHandler } from './widget/task-handler';
import { refreshAllWidgets } from './widget/refresh';
import { registerAlertTask } from './alerts/background'; // importing this also defines the background alert task

registerRootComponent(App);
registerWidgetTaskHandler(widgetTaskHandler);
refreshAllWidgets();
registerAlertTask();
