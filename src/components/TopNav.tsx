import React from 'react';
import { Bell, Moon } from 'lucide-react';
import { UserRole } from '../types/pharmacy';

interface TopNavProps {
  currentRole: UserRole;
  onLogout: () => void;
  currentUserName: string;
  activeTitle: string;
  onOpenCloseDay: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentRole,
  onLogout,
  currentUserName,
  activeTitle,
  onOpenCloseDay,
}) => {
  return (
    <header className="bg-text text-white border-b border-white/10 px-6 py-2.5 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      {/* ── Breadcrumb / Title ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-white">Demo Store</span>
        <span className="text-white/50 text-xs">/</span>
        <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
          {activeTitle}
        </span>
      </div>

      {/* ── Right Status Indicators & User ────────────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* Close Day Button */}
        <button
          onClick={onOpenCloseDay}
          className="px-3 py-1.5 bg-primary hover:bg-primary text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
        >
          <Moon className="w-3.5 h-3.5" />
          <span>Close Day</span>
        </button>

        {/* UI Mode Badge */}
        <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/10 text-white/80 border border-white/15">
          Normal UI
        </span>

        {/* System Status */}
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-accent text-text border border-accent">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          SYSTEM ONLINE
        </span>

        {/* Bell */}
        <button className="p-1.5 text-white/70 hover:text-white rounded-lg hover:bg-white/10 transition relative">
          <Bell className="w-4 h-4" />
          <span className="w-1.5 h-1.5 rounded-full bg-danger absolute top-1 right-1" />
        </button>

        {/* User Pill & Role Switcher */}
        <div className="flex items-center gap-2 pl-2 border-l border-white/20">
          <div className="w-7 h-7 rounded-lg bg-primary text-white font-black text-xs flex items-center justify-center">
            {currentUserName.charAt(0).toUpperCase()}
          </div>
          <div className="hidden md:flex flex-col text-left">
            <span className="text-xs font-bold text-white leading-none">
              {currentUserName}
            </span>
              <span className="text-[10px] text-accent font-bold uppercase tracking-wider mt-0.5">
                {currentRole}
              </span>
            </div>
          <button
            onClick={onLogout}
            className="ml-1 px-2.5 py-1 text-xs font-semibold text-white/90 border border-white/20 rounded-lg hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
};
