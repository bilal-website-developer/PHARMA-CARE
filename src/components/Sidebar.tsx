import React, { useEffect, useState } from 'react';
import {
  BarChart3, ChevronLeft, ChevronRight, FileText, HelpCircle, History, KeyRound,
  Layers, LayoutDashboard, LogOut, MessageSquare, Package, Receipt, Settings,
  ShoppingBag, ShoppingCart, Trash2, Truck, UserCheck, Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { UserRole } from '../types/pharmacy';
import { ModuleKey, usePermissions } from '../permissions';

export type NavItemKey =
  | 'dashboard' | 'pos' | 'products' | 'master-data' | 'stock-inventory'
  | 'customers' | 'customer-ledger' | 'whatsapp-reminders' | 'sales-history'
  | 'suppliers' | 'purchases' | 'purchase-history' | 'expenses' | 'reports'
  | 'manage-users' | 'settings' | 'trash-bin' | 'help-support';

interface SidebarProps {
  activeItem: NavItemKey;
  onSelectItem: (key: NavItemKey) => void;
  currentRole: UserRole;
  currentUserName: string;
  companyName: string;
  onLogout: () => void;
  onChangePassword: () => void;
}

interface NavEntry {
  key: NavItemKey;
  label: string;
  icon: LucideIcon;
  module?: ModuleKey;
  admin?: boolean;
}

const GROUPS: Array<{ title: string; items: NavEntry[] }> = [
  { title: 'Main', items: [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'pos', label: 'POS Billing', icon: ShoppingCart, module: 'pos' },
  ] },
  { title: 'Inventory & Products', items: [
    { key: 'products', label: 'Products', icon: Package, module: 'products' },
    { key: 'master-data', label: 'Categories', icon: Layers, module: 'categories' },
    { key: 'stock-inventory', label: 'Stock Inventory', icon: Package, module: 'stock_inventory' },
  ] },
  { title: 'Sales & Customers', items: [
    { key: 'customer-ledger', label: 'Customer Ledger', icon: FileText, module: 'customers' },
    { key: 'whatsapp-reminders', label: 'WhatsApp Reminders', icon: MessageSquare, module: 'customers' },
    { key: 'sales-history', label: 'Sales History', icon: History, module: 'sales_history' },
  ] },
  { title: 'Procurement', items: [
    { key: 'suppliers', label: 'Suppliers', icon: Truck, module: 'suppliers' },
    { key: 'purchases', label: 'Purchases', icon: ShoppingBag, module: 'purchases' },
    { key: 'purchase-history', label: 'Purchase History', icon: Receipt, module: 'purchase_history' },
  ] },
  { title: 'Accounts & Admin', items: [
    { key: 'expenses', label: 'Expenses', icon: Wallet, module: 'expenses' },
    { key: 'reports', label: 'Business Analytics', icon: BarChart3, module: 'reports' },
    { key: 'manage-users', label: 'Manage Users', icon: UserCheck, admin: true },
  ] },
  { title: 'Settings & System', items: [
    { key: 'settings', label: 'Settings', icon: Settings, admin: true },
    { key: 'trash-bin', label: 'Trash Bin', icon: Trash2, admin: true },
    { key: 'help-support', label: 'Help & Support', icon: HelpCircle },
  ] },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeItem, onSelectItem, currentRole, currentUserName, companyName, onLogout, onChangePassword,
}) => {
  const { isAdmin, can } = usePermissions();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(`pharmacare.sidebarCollapsed.${currentUserName}`) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(`pharmacare.sidebarCollapsed.${currentUserName}`, String(isCollapsed));
    } catch {
      // Keep the current layout for this page view if browser storage is unavailable.
    }
  }, [currentUserName, isCollapsed]);

  return (
    <aside
      data-collapsed={isCollapsed}
      className={`sticky top-0 flex h-screen shrink-0 select-none flex-col border-r border-white/10 bg-text text-white transition-[width] ${isCollapsed ? 'w-16' : 'w-64'}`}
    >
      <div className={`flex items-center border-b border-white/10 p-4 ${isCollapsed ? 'justify-center' : 'justify-between gap-3'}`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-base font-extrabold text-white shadow-md shadow-primary/30">P</div>
          <div className="sidebar-brand-label min-w-0">
            <div className="text-sm font-black uppercase tracking-wide text-white">{companyName}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Control Panel</div>
          </div>
        </div>
        <button type="button" aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setIsCollapsed((collapsed) => !collapsed)} className={`sidebar-collapse-control rounded-control p-1.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${isCollapsed ? 'hidden' : ''}`}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        {isCollapsed && <button type="button" aria-label="Expand sidebar" title="Expand sidebar" onClick={() => setIsCollapsed(false)} className="rounded-control p-1.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><ChevronRight className="h-4 w-4" /></button>}
      </div>

      <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 text-xs">
        {GROUPS.map(({ title, items }) => {
          const visibleItems = items.filter((item) =>
            item.admin ? isAdmin : item.module ? can(item.module) : true
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={title} className="space-y-1">
              <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</div>
              {visibleItems.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectItem(key)}
                  title={label}
                  aria-label={label}
                  aria-current={activeItem === key ? 'page' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left font-medium transition ${activeItem === key ? 'bg-blue-600 font-bold text-white shadow-md shadow-blue-600/25' : 'text-slate-300 hover:bg-slate-800/60'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className={`mt-auto flex items-center gap-2 border-t border-white/10 p-3 ${isCollapsed ? 'flex-col' : ''}`}>
        <div title={`${currentUserName}, ${currentRole}`} aria-label={`${currentUserName}, ${currentRole}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
          {currentUserName.charAt(0).toUpperCase()}
        </div>
        <div className="sidebar-user-details min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-white">{currentUserName}</div>
          <div className="text-[10px] font-semibold uppercase text-white/60">{currentRole}</div>
        </div>
        <button type="button" onClick={onChangePassword} title="Change My Password" aria-label="Change My Password" className="rounded-control border border-white/20 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <KeyRound className="h-3.5 w-3.5" />
          <span className="sidebar-logout-label">Password</span>
        </button>
        <button type="button" onClick={onLogout} title="Log out" aria-label="Log out" className="rounded-control border border-white/20 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <LogOut className="h-3.5 w-3.5" />
          <span className="sidebar-logout-label">Log out</span>
        </button>
      </div>
    </aside>
  );
};
