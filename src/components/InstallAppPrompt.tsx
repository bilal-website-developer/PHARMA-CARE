import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import {
  clearDeferredInstallPrompt,
  getDeferredInstallPrompt,
  subscribeToInstallPrompt,
  type BeforeInstallPromptEvent,
} from '../utils/pwaInstall';

function isInstalledApp(): boolean {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

async function hasInstalledPwa(): Promise<boolean> {
  const navigatorWithInstalledApps = window.navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform: string; id?: string }>>;
  };
  if (!navigatorWithInstalledApps.getInstalledRelatedApps) return false;
  const apps = await navigatorWithInstalledApps.getInstalledRelatedApps();
  return apps.some((app) => app.platform === 'webapp' && app.id === `${window.location.origin}/`);
}

export function InstallAppPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(getDeferredInstallPrompt);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');
    let active = true;
    const updateInstalledState = () => {
      const installed = isInstalledApp();
      setIsInstalled(installed);
      setIsVisible(!installed);
    };
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setIsVisible(false);
    };

    updateInstalledState();
    void hasInstalledPwa().then((installed) => {
      if (active && installed) {
        setIsInstalled(true);
        setIsVisible(false);
      }
    }).catch((error: unknown) => {
      console.warn('Could not check whether Pharma Care is installed.', error);
    });
    const unsubscribeInstallPrompt = subscribeToInstallPrompt(setInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    displayMode.addEventListener('change', updateInstalledState);

    return () => {
      active = false;
      unsubscribeInstallPrompt();
      window.removeEventListener('appinstalled', handleAppInstalled);
      displayMode.removeEventListener('change', updateInstalledState);
    };
  }, []);

  const installApp = async () => {
    if (!installPrompt) {
      setShowInstructions((shown) => !shown);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      clearDeferredInstallPrompt(installPrompt);
      if (choice.outcome === 'accepted') {
        setIsVisible(false);
      } else {
        setShowInstructions(true);
      }
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'The install prompt could not be opened.');
      setShowInstructions(true);
    }
  };

  if (!isVisible || isInstalled) return null;

  return createPortal(
    <aside
      aria-label="Install Pharma Care"
      role="status"
      aria-live="polite"
      className="fixed bottom-3 right-3 z-[100] w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-primary/20 bg-white p-3 text-text shadow-xl sm:bottom-4 sm:right-4"
    >
      <div className="flex items-center gap-2.5">
        <img
          src="/pharma-care-192.png"
          alt=""
          className="h-8 w-8 shrink-0 rounded-lg border border-primary/10 object-cover"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold">Install Pharma Care</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">Quick access to your pharmacy POS and inventory.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsVisible(false)}
          aria-label="Dismiss install suggestion"
          title="Dismiss"
          className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {showInstructions && (
        <p className="mt-2 rounded-lg bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-muted">
          {installError ? `${installError} ` : ''}
          Choose <strong>Install Pharma Care</strong> from your browser menu or address-bar install icon. On iPhone/iPad, use Share, then <strong>Add to Home Screen</strong>. If the link requires Vercel sign-in, use a public deployment URL.
        </p>
      )}
      <button
        type="button"
        onClick={() => void installApp()}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <Download className="h-3 w-3" />
        Install App
      </button>
    </aside>,
    document.body,
  );
}
