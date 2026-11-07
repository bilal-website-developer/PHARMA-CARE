import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isInstalledApp(): boolean {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

export function InstallAppPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const updateInstalledState = () => {
      const installed = isInstalledApp();
      setIsInstalled(installed);
      if (installed) setIsVisible(false);
    };
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setIsVisible(false);
    };

    updateInstalledState();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    displayMode.addEventListener('change', updateInstalledState);
    const timer = window.setTimeout(() => {
      if (!isInstalledApp()) setIsVisible(true);
    }, 1200);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
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
      setInstallPrompt(null);
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
          Choose <strong>Install app</strong> in your browser menu. On iPhone or iPad, use Share, then <strong>Add to Home Screen</strong>.
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
