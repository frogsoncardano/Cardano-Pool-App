import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Show notifications as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

// One Android channel per alert type, so users can mute each one separately in system settings.
export const CHANNELS = {
  governance: 'Governance proposals',
  blocks: 'Pool blocks',
  pools: 'Pool changes',
  rewards: 'Staking rewards',
  prices: 'Price moves',
  general: 'General',
};
let channelsReady = false;
export async function setupChannels() {
  if (Platform.OS !== 'android' || channelsReady) return;
  for (const [id, name] of Object.entries(CHANNELS)) {
    await Notifications.setNotificationChannelAsync(id, { name, importance: Notifications.AndroidImportance.DEFAULT });
  }
  channelsReady = true;
}

export async function notificationsAllowed() {
  try {
    const p = await Notifications.getPermissionsAsync();
    return !!p.granted;
  } catch (e) {
    return false;
  }
}
export async function askNotificationPermission() {
  await setupChannels();
  const p = await Notifications.requestPermissionsAsync();
  return !!p.granted;
}

export async function notify(title, body, channelId = 'general') {
  await setupChannels();
  await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: { channelId } });
}
