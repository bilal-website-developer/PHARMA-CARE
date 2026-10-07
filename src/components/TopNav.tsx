import React, { useEffect, useState } from 'react';
import { Bell, Type } from 'lucide-react';
import { UserRole } from '../types/pharmacy';

interface TopNavProps {
  currentRole: UserRole;
  currentUserName: string;
  activeTitle: string;
}

const largeUiKey = (userName: string) => `pharmacare.largeUi.${userName}`;

function readLargeUiPreference(userName: string): boolean {
  try {
    return localStorage.getItem(largeUiKey(userName)) === 'true';
  } catch {
    return false;
  }
}

export const TopNav: React.FC<TopNavProps> = ({
  currentRole,
  currentUserName,
  activeTitle,
}) => {
  const [largeUi, setLargeUi] = useState(() => readLargeUiPreference(currentUserName));
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    document.documentElement.classList.toggle('large-ui', largeUi);
    try {
      localStorage.setItem(largeUiKey(currentUserName), String(largeUi));
    } catch {
      // The selected size remains active for this page view.
    }
  }, [currentUserName, largeUi]);

  useEffect(() => {
    const checkApi = async () => {
      try {
        const response = await fetch('/api/auth/config', { cache: 'no-store' });
        setOnline(navigator.onLine && response.ok);
      } catch {
        setOnline(false);
      }
    };
    const handleOnline = () => void checkApi();
    const handleOffline = () => setOnline(false);
    void checkApi();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-4 py-2.5 shadow-xs sm:px-6">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-text">PharmaCare</div>
        <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">
          {activeTitle}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex items-center rounded-full border border-border bg-surface p-0.5 text-[10px] font-semibold">
          <button
            type="button"
            aria-pressed={!largeUi}
            onClick={() => setLargeUi(false)}
            className={`rounded-full px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              !largeUi ? 'bg-primary text-white' : 'text-muted'
            }`}
          >
            Normal UI
          </button>
          <button
            type="button"
            aria-pressed={largeUi}
            onClick={() => setLargeUi(true)}
            className={`flex items-center gap-1 rounded-full px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              largeUi ? 'bg-primary text-white' : 'text-muted'
            }`}
          >
            <Type className="h-3 w-3" />
            Large UI
          </button>
        </div>

        <span
          role="status"
          className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold sm:inline-flex ${
            online
              ? 'border-border bg-surface text-primary'
              : 'border-warning bg-warning/15 text-text'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-primary' : 'bg-warning'}`} />
          {online ? 'SYSTEM ONLINE' : 'OFFLINE'}
        </span>

        <button
          type="button"
          aria-label="Notifications"
          className="relative rounded-control p-2 text-muted hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
        </button>

        <div className="flex items-center gap-2 border-l border-border pl-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
            {currentUserName.charAt(0).toUpperCase()}
          </div>
          <div className="hidden min-w-0 md:block">
            <div className="max-w-36 truncate text-xs font-bold text-text">{currentUserName}</div>
            <div className="text-[10px] font-semibold uppercase text-muted">{currentRole}</div>
          </div>
        </div>
      </div>
    </header>
  );
};
