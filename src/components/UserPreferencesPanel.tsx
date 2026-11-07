import { useCallback, useEffect, useState } from 'react';
import { Monitor, Moon, Sun, Type } from 'lucide-react';
import {
  readCustomerDisplayAlternatives,
  saveCustomerDisplayAlternatives,
} from '../utils/customerDisplay';
import { supabase } from '../utils/supabase';
import {
  applyUserDisplayPreferences,
  readUserDisplayPreferences,
  saveUserDisplayPreferences,
  type UserDisplayPreferences,
} from '../utils/userDisplayPreferences';

type ConnectionStatus = 'checking' | 'online' | 'offline' | 'unavailable';

export function UserPreferencesPanel({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  const [preferences, setPreferences] = useState<UserDisplayPreferences>(() =>
    readUserDisplayPreferences(userId, username)
  );
  const [showAlternatives, setShowAlternatives] = useState(() =>
    readCustomerDisplayAlternatives(userId)
  );
  const [notice, setNotice] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('checking');

  const commitPreferences = useCallback((next: UserDisplayPreferences) => {
    if (!saveUserDisplayPreferences(userId, next)) {
      setNotice('Could not save this preference in the browser.');
      return;
    }
    setPreferences(next);
    setNotice('');
  }, [userId]);

  useEffect(() => {
    applyUserDisplayPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    let active = true;
    const checkConnection = async () => {
      if (!navigator.onLine) {
        if (active) setConnectionStatus('offline');
        return;
      }
      if (!supabase) {
        if (active) setConnectionStatus('unavailable');
        return;
      }
      try {
        const { error } = await supabase.auth.getUser();
        if (active) setConnectionStatus(error ? 'unavailable' : 'online');
      } catch {
        if (active) setConnectionStatus('unavailable');
      }
    };
    const handleOnline = () => { void checkConnection(); };
    const handleOffline = () => setConnectionStatus('offline');
    void checkConnection();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const toggleAlternatives = () => {
    const next = !showAlternatives;
    if (!saveCustomerDisplayAlternatives(userId, next)) {
      setNotice('Could not save this preference in the browser.');
      return;
    }
    setShowAlternatives(next);
    setNotice('');
  };

  return (
    <section className="mx-auto max-w-4xl space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Personal settings</p>
          <h2 className="mt-0.5 text-lg font-black text-text">Display preferences</h2>
        </div>
        <p className="text-[11px] text-muted">Only affects your account on this computer.</p>
      </header>

      {notice && <p role="status" className="rounded-control border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-text">{notice}</p>}

      <div className="divide-y divide-border rounded-card border border-border bg-white px-3 shadow-xs sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-text"><Sun className="h-3.5 w-3.5 text-primary" /> Theme</span>
          <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 text-[10px] font-semibold">
          {([
            { value: 'light', label: 'Light Mint', Icon: Sun },
            { value: 'night', label: 'Emerald Night', Icon: Moon },
          ] as const).map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={preferences.theme === value}
              onClick={() => commitPreferences({ ...preferences, theme: value })}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${preferences.theme === value ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
            >
              <Icon className="h-3 w-3" />{label}
            </button>
          ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-text"><Type className="h-3.5 w-3.5 text-primary" /> Text size</span>
          <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 text-[10px] font-semibold">
          {([
            { value: 'normal', label: 'Normal text' },
            { value: 'large', label: 'Large text' },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={preferences.textSize === value}
              onClick={() => commitPreferences({ ...preferences, textSize: value })}
              className={`rounded-full px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${preferences.textSize === value ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
            >
              {label}
            </button>
          ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 py-2.5">
          <span className="text-xs font-semibold text-text">Use animations</span>
          <input
            type="checkbox"
            checked={preferences.animationsEnabled}
            onChange={(event) => commitPreferences({ ...preferences, animationsEnabled: event.target.checked })}
            className="h-4 w-4 accent-[var(--primary)]"
          />
        </label>

        <label className="flex cursor-pointer items-start justify-between gap-3 py-2.5">
          <span className="max-w-3xl">
            <span className="block text-xs font-semibold text-text">Show similar medicines on customer display</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">Up to three in-stock matches by generic and strength; customers can choose one on the display.</span>
          </span>
          <input
            type="checkbox"
            checked={showAlternatives}
            onChange={toggleAlternatives}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
          />
        </label>
      </div>

      <p role="status" className="flex items-center gap-1.5 text-[10px] text-muted">
        <Monitor className="h-3 w-3" />
        Connection: {connectionStatus === 'checking' ? 'Checking…' : connectionStatus === 'online' ? 'Online' : connectionStatus === 'offline' ? 'Offline' : 'Unavailable'}
      </p>
    </section>
  );
}
