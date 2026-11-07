export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type InstallPromptListener = (event: BeforeInstallPromptEvent | null) => void;

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<InstallPromptListener>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    listeners.forEach((listener) => listener(deferredInstallPrompt));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    listeners.forEach((listener) => listener(null));
  });
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstallPrompt;
}

export function subscribeToInstallPrompt(listener: InstallPromptListener): () => void {
  listeners.add(listener);
  listener(deferredInstallPrompt);
  return () => listeners.delete(listener);
}

export function clearDeferredInstallPrompt(event: BeforeInstallPromptEvent): void {
  if (deferredInstallPrompt !== event) return;
  deferredInstallPrompt = null;
  listeners.forEach((listener) => listener(null));
}
