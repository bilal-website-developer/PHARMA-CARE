import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Star, StarOff, X,
} from 'lucide-react';
import { usePermissions } from '../permissions';
import { SIDEBAR_CATEGORIES, SIDEBAR_PAGES, type SidebarPageKey } from './sidebarPages';
import { clampSidebarMenuPosition } from './sidebarMenuPosition';
import { toggleSidebarFavorite } from './sidebarPinLogic';
import PharmaLogo from './PharmaLogo';
import GlowCredit from './GlowCredit';

export type NavItemKey = SidebarPageKey;

interface SidebarProps {
  activeItem: NavItemKey;
  onSelectItem: (key: NavItemKey) => void;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  pendingPrintCount: number;
  favoritePageKeys: readonly NavItemKey[];
  tipDismissed: boolean;
  preferenceNotice: string;
  onToggleFavorite: (key: NavItemKey) => void;
  onDismissTip: () => void;
}

interface ContextMenuState {
  key: NavItemKey;
  left: number;
  top: number;
}

const MENU_WIDTH = 192;
const MENU_HEIGHT = 48;

export const Sidebar: React.FC<SidebarProps> = ({
  activeItem,
  onSelectItem,
  isCollapsed,
  onToggleCollapsed,
  pendingPrintCount,
  favoritePageKeys,
  tipDismissed,
  preferenceNotice,
  onToggleFavorite,
  onDismissTip,
}) => {
  const { canPage } = usePermissions();
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<NavItemKey, HTMLButtonElement>());
  const contextMenuRef = useRef<ContextMenuState | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const touchOrigin = useRef<{ key: NavItemKey; x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const savedScrollTop = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [limitNotice, setLimitNotice] = useState('');

  const visibleFavoriteKeys = favoritePageKeys.filter((key, index) =>
    canPage(key) && favoritePageKeys.indexOf(key) === index
  );
  const visibleFavoriteSignature = visibleFavoriteKeys.join('|');

  useLayoutEffect(() => {
    if (savedScrollTop.current === null || !navRef.current) return;
    navRef.current.scrollTop = savedScrollTop.current;
    savedScrollTop.current = null;
  }, [visibleFavoriteSignature]);

  useEffect(() => {
    contextMenuRef.current = contextMenu;
    if (!contextMenu) return;
    const focusMenuItem = () => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    window.requestAnimationFrame(focusMenuItem);
    const close = (restoreFocus = true) => {
      const key = contextMenuRef.current?.key;
      contextMenuRef.current = null;
      setContextMenu(null);
      if (restoreFocus && key) {
        window.requestAnimationFrame(() => rowRefs.current.get(key)?.focus());
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const onScroll = () => close();
    const onResize = () => close();
    const onBlur = () => close();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
    };
  }, [contextMenu]);

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  const showContextMenu = (key: NavItemKey, x: number, y: number) => {
    const position = clampSidebarMenuPosition(
      x,
      y,
      window.innerWidth,
      window.innerHeight,
      MENU_WIDTH,
      MENU_HEIGHT,
    );
    const nextMenu = { key, ...position };
    contextMenuRef.current = nextMenu;
    setContextMenu(nextMenu);
  };

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchOrigin.current = null;
  };

  const showLimitNotice = () => {
    setLimitNotice('You can favorite up to 8 pages');
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setLimitNotice(''), 3500);
  };

  const chooseFavoriteAction = () => {
    if (!contextMenu) return;
    const key = contextMenu.key;
    const update = toggleSidebarFavorite(visibleFavoriteKeys, key);
    if (update.limitReached) {
      contextMenuRef.current = null;
      setContextMenu(null);
      rowRefs.current.get(key)?.focus();
      showLimitNotice();
      return;
    }
    savedScrollTop.current = navRef.current?.scrollTop ?? null;
    onToggleFavorite(key);
    contextMenuRef.current = null;
    setContextMenu(null);
    window.requestAnimationFrame(() => rowRefs.current.get(key)?.focus());
  };

  const renderRow = (key: NavItemKey) => {
    const page = SIDEBAR_PAGES.find((candidate) => candidate.key === key);
    if (!page) return null;
    const Icon = page.icon;
    const isFavorite = visibleFavoriteKeys.includes(key);
    return (
      <button
        key={key}
        ref={(element) => {
          if (element) rowRefs.current.set(key, element);
          else rowRefs.current.delete(key);
        }}
        type="button"
        onClick={(event) => {
          if (Date.now() < suppressClickUntil.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickUntil.current = 0;
            return;
          }
          onSelectItem(key);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (touchOrigin.current?.key === key) suppressClickUntil.current = Date.now() + 900;
          clearLongPress();
          showContextMenu(key, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            showContextMenu(key, rect.left, rect.bottom);
          }
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') return;
          clearLongPress();
          touchOrigin.current = { key, x: event.clientX, y: event.clientY };
          longPressTimer.current = window.setTimeout(() => {
            const origin = touchOrigin.current;
            if (!origin) return;
            suppressClickUntil.current = Date.now() + 900;
            showContextMenu(origin.key, origin.x, origin.y);
            longPressTimer.current = null;
          }, 500);
        }}
        onPointerMove={(event) => {
          const origin = touchOrigin.current;
          if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) clearLongPress();
        }}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
        title={page.label}
        aria-label={page.label}
        aria-haspopup="menu"
        aria-expanded={contextMenu?.key === key}
        aria-current={activeItem === key ? 'page' : undefined}
        className={`sidebar-nav-item relative flex w-full items-center rounded-lg py-2 text-left font-medium transition ${
          isCollapsed ? 'justify-center px-2' : 'gap-2.5 px-3'
        } ${activeItem === key ? 'bg-primary font-bold text-white shadow-md' : 'text-slate-300 hover:bg-white/10'}`}
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        {!isCollapsed && <span>{page.label}</span>}
        {key === 'print-requests' && pendingPrintCount > 0 && !isCollapsed && (
          <span className="ml-auto min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-black text-white">
            {pendingPrintCount > 99 ? '99+' : pendingPrintCount}
          </span>
        )}
        {isFavorite && !isCollapsed && <Star aria-hidden="true" className="ml-auto h-3.5 w-3.5 opacity-70" />}
      </button>
    );
  };

  return (
    <aside
      data-collapsed={isCollapsed}
      className={`pharma-sidebar sticky top-0 flex h-screen shrink-0 select-none flex-col border-r border-white/10 text-white transition-none ${isCollapsed ? 'w-16' : 'w-64'}`}
    >
      <div className={`flex min-h-[72px] items-center border-b border-white/10 p-4 ${isCollapsed ? 'justify-center' : 'justify-between gap-3'}`}>
        <div className="pharma-brand flex min-w-0 items-center">
          {!isCollapsed && <PharmaLogo size={2.6} layout="inline" />}
        </div>
        <button
          type="button"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
          className={`sidebar-collapse-control flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-white/15 text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${isCollapsed ? 'absolute left-3 top-4' : ''}`}
        >
          {isCollapsed
            ? <ChevronRight aria-hidden="true" className="h-4 w-4" />
            : <ChevronLeft aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>

      <nav ref={navRef} aria-label="Main navigation" className={`min-h-0 flex-1 overflow-y-auto py-4 text-xs ${isCollapsed ? 'space-y-4 px-2' : 'space-y-5 px-3'}`}>
        {visibleFavoriteKeys.length > 0 && (
          <div className={`space-y-1 ${isCollapsed ? '' : 'border-b border-white/20 pb-3'}`}>
            {!isCollapsed && <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Favorites</div>}
            {visibleFavoriteKeys.map(renderRow)}
          </div>
        )}
        {SIDEBAR_CATEGORIES.map((title) => {
          const categoryPages = SIDEBAR_PAGES.filter((page) =>
            page.sidebar !== false
            && page.category === title
            && canPage(page.key)
            && !visibleFavoriteKeys.includes(page.key)
          );
          if (categoryPages.length === 0) return null;
          return (
            <div key={title} className="space-y-1">
              {!isCollapsed && <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</div>}
              {categoryPages.map((page) => renderRow(page.key))}
            </div>
          );
        })}
      </nav>

      {!tipDismissed && (isCollapsed ? (
        <div role="note" className="mx-auto mb-2">
          <button
            type="button"
            title="Tip: right-click any page to add it to Favorites"
            aria-label="Tip: right-click any page to add it to Favorites. Dismiss tip."
            onClick={onDismissTip}
            className="flex h-8 w-8 items-center justify-center rounded-control text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Star aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div role="note" className="mx-3 mb-2 flex items-center gap-1.5 rounded-control border border-white/15 bg-white/10 px-2.5 py-2 text-[10px] text-white/90">
          <span className="min-w-0 flex-1">Tip: right-click any page to add it to Favorites</span>
          <button
            type="button"
            aria-label="Dismiss favorites tip"
            onClick={onDismissTip}
            className="rounded p-0.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {(limitNotice || preferenceNotice) && (
        <div role="status" className={`mx-2 mb-2 rounded-control border border-white/15 bg-white/10 px-2 py-1.5 text-[10px] text-white ${isCollapsed ? 'text-center' : ''}`}>
          {limitNotice || preferenceNotice}
        </div>
      )}

      {!isCollapsed && <div className="mt-auto border-t border-white/10 p-3">
        <GlowCredit />
      </div>}

      {contextMenu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${SIDEBAR_PAGES.find((page) => page.key === contextMenu.key)?.label ?? 'Page'} options`}
          style={{ position: 'fixed', left: contextMenu.left, top: contextMenu.top, width: MENU_WIDTH }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
            }
          }}
          className="sidebar-favorites-menu z-[80] rounded-control border border-border bg-surface p-1 text-text shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={chooseFavoriteAction}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-semibold text-text hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {visibleFavoriteKeys.includes(contextMenu.key)
              ? <StarOff aria-hidden="true" className="h-4 w-4 shrink-0" />
              : <Star aria-hidden="true" className="h-4 w-4 shrink-0" />}
            {visibleFavoriteKeys.includes(contextMenu.key) ? 'Remove from Favorites' : 'Add to Favorites'}
          </button>
        </div>
      )}
    </aside>
  );
};
