export type UserThemePreference = 'light' | 'night';
export type UserTextSizePreference = 'normal' | 'large';

export interface UserDisplayPreferences {
  theme: UserThemePreference;
  textSize: UserTextSizePreference;
  animationsEnabled: boolean;
}

export const DEFAULT_USER_DISPLAY_PREFERENCES: UserDisplayPreferences = {
  theme: 'light',
  textSize: 'normal',
  animationsEnabled: true,
};

export const USER_DISPLAY_PREFERENCES_EVENT = 'pharma-care:user-display-preferences-changed';

function storageKey(userId: string): string {
  return `pharma-care.user-display-preferences.${userId}`;
}

export function readUserDisplayPreferences(
  userId: string,
  username = '',
): UserDisplayPreferences {
  try {
    const stored = globalThis.localStorage?.getItem(storageKey(userId));
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed === 'object' && parsed !== null) {
        const value = parsed as Partial<UserDisplayPreferences>;
        return {
          theme: value.theme === 'night' ? 'night' : 'light',
          textSize: value.textSize === 'large' ? 'large' : 'normal',
          animationsEnabled: typeof value.animationsEnabled === 'boolean'
            ? value.animationsEnabled
            : true,
        };
      }
    }

    const theme = globalThis.localStorage?.getItem('pharma-care.theme');
    const animations = globalThis.localStorage?.getItem('pharma-care.animations');
    const largeUi = username
      ? globalThis.localStorage?.getItem(`pharma-care.largeUi.${username}`)
      : null;
    return {
      theme: theme === 'night' ? 'night' : DEFAULT_USER_DISPLAY_PREFERENCES.theme,
      textSize: largeUi === 'true' ? 'large' : DEFAULT_USER_DISPLAY_PREFERENCES.textSize,
      animationsEnabled: animations === 'false'
        ? false
        : DEFAULT_USER_DISPLAY_PREFERENCES.animationsEnabled,
    };
  } catch {
    return { ...DEFAULT_USER_DISPLAY_PREFERENCES };
  }
}

export function applyUserDisplayPreferences(preferences: UserDisplayPreferences): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.dataset.theme = preferences.theme;
  root.dataset.animations = preferences.animationsEnabled ? 'on' : 'off';
  root.classList.toggle('large-ui', preferences.textSize === 'large');
}

export function saveUserDisplayPreferences(
  userId: string,
  preferences: UserDisplayPreferences,
): boolean {
  if (!userId) return false;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(storageKey(userId), JSON.stringify(preferences));
    applyUserDisplayPreferences(preferences);
    globalThis.dispatchEvent?.(new CustomEvent(USER_DISPLAY_PREFERENCES_EVENT, {
      detail: { userId, preferences },
    }));
    return true;
  } catch {
    return false;
  }
}
