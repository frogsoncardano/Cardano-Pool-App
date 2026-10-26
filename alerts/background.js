import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { runAlertChecks } from './engine';
import { notify } from './notify';

// Android wakes this up about every 15+ minutes (it decides, and battery savers can delay it).
export const ALERT_TASK = 'frog-labs-alerts';

TaskManager.defineTask(ALERT_TASK, async () => {
  try {
    await runAlertChecks({ notify });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerAlertTask() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    if (!(await TaskManager.isTaskRegisteredAsync(ALERT_TASK))) {
      await BackgroundTask.registerTaskAsync(ALERT_TASK, { minimumInterval: 15 });
    }
  } catch (e) {}
}
