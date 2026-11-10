export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALL_PROMPT_DISMISSED_KEY = 'pharma-care.installPromptDismissed';

export function isInstallPromptDismissed(
  storage?: Pick<Storage, 'getItem'>,
): boolean {
  try {
    return (storage ?? globalThis.localStorage)?.getItem(INSTALL_PROMPT_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberInstallPromptDismissed(
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return false;
    target.setItem(INSTALL_PROMPT_DISMISSED_KEY, 'true');
    return true;
  } catch {
    return false;
  }
}
