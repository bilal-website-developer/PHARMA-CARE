import React, { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import { ROLE_LABELS, UserRole } from '../types/pharmacy';
import { readShopLogo, SHOP_LOGO_EVENT } from '../utils/storeSettings';
import PharmaLogo from './PharmaLogo';
import { StockAlertBell } from './StockAlertBell';
import {
  applyUserDisplayPreferences,
  readUserDisplayPreferences,
  USER_DISPLAY_PREFERENCES_EVENT,
} from '../utils/userDisplayPreferences';

interface TopNavProps {
  currentRole: UserRole;
  username: string;
  userId: string;
  activeTitle: string;
  onChangePassword: () => void;
  onLogout: () => void;
  onOpenStockInventory: (medicineId: string | null) => void;
  onOpenProducts: (searchText: string | null) => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentRole,
  username,
  userId,
  activeTitle,
  onChangePassword,
  onLogout,
  onOpenStockInventory,
  onOpenProducts,
}) => {
  const [shopLogo, setShopLogo] = useState(() => readShopLogo());
  const [animationsEnabled, setAnimationsEnabled] = useState(() =>
    readUserDisplayPreferences(userId, username).animationsEnabled
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleLogoChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ logoUrl?: string }>;
      setShopLogo(customEvent.detail?.logoUrl ?? readShopLogo());
    };
    window.addEventListener(SHOP_LOGO_EVENT, handleLogoChange);
    return () => window.removeEventListener(SHOP_LOGO_EVENT, handleLogoChange);
  }, []);

  useEffect(() => {
    const handlePreferencesChange = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; preferences?: { animationsEnabled?: boolean } }>).detail;
      if (detail?.userId === userId && detail.preferences) {
        applyUserDisplayPreferences(detail.preferences as ReturnType<typeof readUserDisplayPreferences>);
        setAnimationsEnabled(detail.preferences.animationsEnabled === true);
      }
    };
    const preferences = readUserDisplayPreferences(userId, username);
    applyUserDisplayPreferences(preferences);
    setAnimationsEnabled(preferences.animationsEnabled);
    window.addEventListener(USER_DISPLAY_PREFERENCES_EVENT, handlePreferencesChange);
    return () => window.removeEventListener(USER_DISPLAY_PREFERENCES_EVENT, handlePreferencesChange);
  }, [userId, username]);

  useEffect(() => {
    if (!profileOpen) return;
    profileMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        profileButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileOpen]);

  const handleProfileMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = profileMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items?.length) return;
    const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'ArrowDown'
      ? (currentIndex + 1) % items.length
      : (currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
    items[nextIndex].focus();
  };

  const runProfileAction = (action: () => void) => {
    setProfileOpen(false);
    action();
  };

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white/90 px-4 py-2.5 shadow-xs backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {shopLogo ? (
          <img
            src={shopLogo}
            alt="Shop Logo"
            className="h-8 max-w-[130px] rounded object-contain shrink-0"
          />
        ) : (
          <PharmaLogo size={2.6} layout="inline" className="pharma-brand header-pharma-logo" />
        )}
        <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">
          {activeTitle}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
        <StockAlertBell
          userId={userId}
          animationsEnabled={document.documentElement.dataset.animations !== 'off'}
          onOpenStockInventory={onOpenStockInventory}
          onOpenProducts={onOpenProducts}
        />
        <div ref={profileRef} className="relative border-l border-border pl-2">
          <button
            ref={profileButtonRef}
            type="button"
            aria-label={`Profile actions for ${username}`}
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            aria-controls="profile-actions-menu"
            onClick={() => setProfileOpen((open) => !open)}
            className="flex max-w-48 items-center gap-2 rounded-control p-1.5 text-left hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {username.charAt(0).toUpperCase()}
            </span>
            <span className="hidden min-w-0 md:block">
              <span className="block max-w-36 truncate text-xs font-bold text-text">{username}</span>
              <span className="block text-[10px] font-semibold uppercase text-muted">{ROLE_LABELS[currentRole]}</span>
            </span>
            <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
          </button>
          {profileOpen && (
            <div
              ref={profileMenuRef}
              id="profile-actions-menu"
              role="menu"
              aria-label="Profile actions"
              onKeyDown={handleProfileMenuKeyDown}
              className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-border bg-surface p-2 shadow-lg"
            >
              <div className="mb-1 border-b border-border px-3 py-2 md:hidden">
                <div className="truncate text-xs font-bold text-text">{username}</div>
                <div className="text-[10px] font-semibold uppercase text-muted">{ROLE_LABELS[currentRole]}</div>
              </div>
              {currentRole !== UserRole.ADMIN && <button
                type="button"
                role="menuitem"
                onClick={() => runProfileAction(onChangePassword)}
                className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-xs font-semibold text-text hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <KeyRound aria-hidden="true" className="h-4 w-4 text-muted" />
                Change Password
              </button>}
              <button
                type="button"
                role="menuitem"
                onClick={() => runProfileAction(onLogout)}
                className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-xs font-semibold text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <LogOut aria-hidden="true" className="h-4 w-4" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
