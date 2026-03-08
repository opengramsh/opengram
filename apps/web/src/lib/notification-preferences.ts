const SOUND_KEY = 'opengram.notifications.sound';
const BROWSER_KEY = 'opengram.notifications.browser';

export function isSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== '0';
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_KEY, enabled ? '1' : '0');
}

export function isBrowserNotificationsEnabled(): boolean {
  return localStorage.getItem(BROWSER_KEY) !== '0';
}

export function setBrowserNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(BROWSER_KEY, enabled ? '1' : '0');
}
