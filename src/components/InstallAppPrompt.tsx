import { useState } from 'react';
import { Download, X } from 'lucide-react';
import type { BeforeInstallPromptEvent } from '../utils/installPrompt';

interface InstallAppPromptProps {
  promptEvent: BeforeInstallPromptEvent;
  onDismiss: () => void;
}

export function InstallAppPrompt({ promptEvent, onDismiss }: InstallAppPromptProps) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  const install = async () => {
    if (installing) return;
    setInstalling(true);
    setError('');
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted' || outcome === 'dismissed') onDismiss();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Use your browser menu to install the app.');
      setInstalling(false);
    }
  };

  return (
    <aside
      role="region"
      aria-label="Install Pharma Care"
      className="fixed bottom-3 right-3 z-[70] w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-surface p-3 text-text shadow-xl sm:bottom-5 sm:right-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Download aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-xs font-bold">Install Pharma Care</h2>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss install prompt"
              className="rounded p-0.5 text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted">Quick access to your pharmacy POS and inventory.</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-[11px] text-danger">{error}</p>}
      <button
        type="button"
        onClick={() => void install()}
        disabled={installing}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        {installing ? 'Waiting for browser…' : 'Install App'}
      </button>
    </aside>
  );
}
