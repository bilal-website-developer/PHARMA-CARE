import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  ShoppingCart,
  Package,
  Layers,
  Users,
  FileText,
  MessageSquare,
  History,
  Truck,
  ShoppingBag,
  Receipt,
  Wallet,
  BarChart3,
  UserCheck,
  Settings,
  Trash2,
  HelpCircle,
} from 'lucide-react';
import { UserRole } from '../types/pharmacy';

export type NavItemKey =
  | 'dashboard'
  | 'pos'
  | 'products'
  | 'master-data'
  | 'stock-inventory'
  | 'customers'
  | 'customer-ledger'
  | 'whatsapp-reminders'
  | 'sales-history'
  | 'suppliers'
  | 'purchases'
  | 'purchase-history'
  | 'expenses'
  | 'reports'
  | 'manage-users'
  | 'settings'
  | 'trash-bin'
  | 'help-support';

interface SidebarProps {
  activeItem: NavItemKey;
  onSelectItem: (key: NavItemKey) => void;
  currentRole: UserRole;
  currentUserName: string;
  companyName: string;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeItem,
  onSelectItem,
  currentRole,
  currentUserName,
  companyName,
  onLogout,
}) => {
  const isCashier = currentRole === UserRole.CASHIER;
  const isAdmin = currentRole === UserRole.ADMIN;
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
      className={`sticky top-0 flex h-screen shrink-0 select-none flex-col border-r border-white/10 bg-text text-white transition-[width] ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* ── Brand Header ─────────────────────────────────────────────────── */}
      <div className={`flex items-center border-b border-white/10 p-4 ${isCollapsed ? 'justify-center' : 'justify-between gap-3'}`}>
        <div className="flex min-w-0 items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white font-extrabold text-base shadow-md shadow-primary/30">
          P
        </div>
        <div className="sidebar-brand-label min-w-0">
          <div className="text-sm font-black text-white tracking-wide uppercase">
            {companyName}
          </div>
          <div className="text-[10px] text-white/60 font-semibold tracking-wider uppercase">
            Control Panel
          </div>
        </div>
        </div>
        <button
          type="button"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          className={`sidebar-collapse-control rounded-control p-1.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            isCollapsed ? 'hidden' : ''
          }`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {isCollapsed && (
          <button
            type="button"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={() => setIsCollapsed(false)}
            className="rounded-control p-1.5 text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Nav Links ────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4 text-xs">
        {/* MAIN */}
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
            Main
          </div>
          <button
            onClick={() => onSelectItem('dashboard')}
            title="Dashboard"
            aria-label="Dashboard"
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'dashboard'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Dashboard</span>
          </button>
          <button
            onClick={() => onSelectItem('pos')}
            title="POS Billing"
            aria-label="POS Billing"
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'pos'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>POS Billing</span>
          </button>
        </div>

        {/* INVENTORY & PRODUCTS */}
        {!isCashier && (
          <div className="space-y-1">
            <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
              Inventory & Products
            </div>
            <button
              onClick={() => onSelectItem('products')}
              title="Products"
              aria-label="Products"
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'products'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Products</span>
            </button>
            <button
              onClick={() => onSelectItem('master-data')}
              title="Master Data"
              aria-label="Master Data"
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'master-data'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Master Data</span>
            </button>
          </div>
        )}

        {/* SALES & CUSTOMERS */}
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
            Sales & Customers
          </div>
          {!isCashier && <button
            onClick={() => onSelectItem('customer-ledger')}
            title="Customer Ledger"
            aria-label="Customer Ledger"
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'customer-ledger'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Customer Ledger</span>
          </button>}
          {!isCashier && <button
            onClick={() => onSelectItem('whatsapp-reminders')}
            title="WhatsApp Reminders"
            aria-label="WhatsApp Reminders"
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'whatsapp-reminders'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>WhatsApp Reminders</span>
          </button>}
          <button
            onClick={() => onSelectItem('sales-history')}
            title="Sales History"
            aria-label="Sales History"
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'sales-history'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Sales History</span>
          </button>
        </div>

        {/* PROCUREMENT */}
        {!isCashier && (
          <div className="space-y-1">
            <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
              Procurement
            </div>
            <button
              onClick={() => onSelectItem('suppliers')}
              title="Suppliers"
              aria-label="Suppliers"
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'suppliers'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <Truck className="w-4 h-4" />
              <span>Suppliers</span>
            </button>
            <button
              onClick={() => onSelectItem('purchases')}
              title="Purchases"
              aria-label="Purchases"
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'purchases'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Purchases</span>
            </button>
            <button
              onClick={() => onSelectItem('purchase-history')}
              title="Purchase History"
              aria-label="Purchase History"
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'purchase-history'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <Receipt className="w-4 h-4" />
              <span>Purchase History</span>
            </button>
          </div>
        )}

        {/* ACCOUNTS & ADMIN */}
        {!isCashier && (
          <div className="space-y-1">
            <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
              Accounts & Admin
            </div>
            <button
              onClick={() => onSelectItem('expenses')}
              title="Expenses"
              aria-label="Expenses"
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'expenses'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>Expenses</span>
            </button>
            <button
              onClick={() => onSelectItem('reports')}
              title="Business Analytics"
              aria-label="Business Analytics"
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'reports'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Business Analytics</span>
            </button>
            {isAdmin && (
              <button
                onClick={() => onSelectItem('manage-users')}
                title="Manage Users"
                aria-label="Manage Users"
                className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                  activeItem === 'manage-users'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                    : 'hover:bg-slate-800/60 text-slate-300'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>Manage Users</span>
              </button>
            )}
          </div>
        )}

        {/* SETTINGS & SYSTEM */}
        {!isCashier && (
          <div className="space-y-1">
            <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
              Settings & System
            </div>
          <button
            onClick={() => onSelectItem('settings')}
            title="Settings"
            aria-label="Settings"
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'settings'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
          <button
            onClick={() => onSelectItem('trash-bin')}
            title="Trash Bin"
            aria-label="Trash Bin"
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'trash-bin'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            <span>Trash Bin</span>
          </button>
          <button
            onClick={() => onSelectItem('help-support')}
            title="Help & Support"
            aria-label="Help & Support"
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'help-support'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>Help & Support</span>
          </button>
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className={`mt-auto flex items-center gap-2 border-t border-white/10 p-3 ${isCollapsed ? 'flex-col' : ''}`}>
        <div
          title={`${currentUserName}, ${currentRole}`}
          aria-label={`${currentUserName}, ${currentRole}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
        >
          {currentUserName.charAt(0).toUpperCase()}
        </div>
        <div className="sidebar-user-details min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-white">{currentUserName}</div>
          <div className="text-[10px] font-semibold uppercase text-white/60">{currentRole}</div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          title="Log out"
          aria-label="Log out"
          className="rounded-control border border-white/20 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="sidebar-logout-label">Log out</span>
        </button>
      </div>
    </aside>
  );
};
