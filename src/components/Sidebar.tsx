import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Layers,
  Boxes,
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
}

export const Sidebar: React.FC<SidebarProps> = ({ activeItem, onSelectItem, currentRole }) => {
  const isCashier = currentRole === UserRole.CASHIER;

  return (
    <aside className="w-64 bg-text text-white flex flex-col shrink-0 h-screen sticky top-0 overflow-y-auto select-none border-r border-white/10">
      {/* ── Brand Header ─────────────────────────────────────────────────── */}
      <div className="p-4 flex items-center gap-3 border-b border-slate-800">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white font-extrabold text-base shadow-md shadow-primary/30">
          D
        </div>
        <div>
          <div className="text-sm font-black text-white tracking-wide uppercase">
            Demo Store
          </div>
          <div className="text-[10px] text-accent font-semibold tracking-wider uppercase">
            Control Panel • Rx
          </div>
        </div>
      </div>

      {/* ── Nav Links ────────────────────────────────────────────────────── */}
      <div className="flex-1 px-3 py-4 space-y-5 text-xs">
        {/* MAIN */}
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
            Main
          </div>
          <button
            onClick={() => onSelectItem('dashboard')}
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
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'master-data'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Master Data</span>
            </button>
            <button
              onClick={() => onSelectItem('stock-inventory')}
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'stock-inventory'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <Boxes className="w-4 h-4" />
              <span>Stock Inventory</span>
            </button>
          </div>
        )}

        {/* SALES & CUSTOMERS */}
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
            Sales & Customers
          </div>
          <button
            onClick={() => onSelectItem('customers')}
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'customers'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Customers</span>
          </button>
          <button
            onClick={() => onSelectItem('customer-ledger')}
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'customer-ledger'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Customer Ledger</span>
          </button>
          <button
            onClick={() => onSelectItem('whatsapp-reminders')}
            className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
              activeItem === 'whatsapp-reminders'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                : 'hover:bg-slate-800/60 text-slate-300'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>WhatsApp Reminders</span>
          </button>
          <button
            onClick={() => onSelectItem('sales-history')}
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
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'reports'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Business Analytics</span>
            </button>
            <button
              onClick={() => onSelectItem('manage-users')}
              className={`w-full text-left px-3 py-2 rounded-lg font-medium flex items-center gap-2.5 transition ${
                activeItem === 'manage-users'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                  : 'hover:bg-slate-800/60 text-slate-300'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Manage Users</span>
            </button>
          </div>
        )}

        {/* SETTINGS & SYSTEM */}
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
            Settings & System
          </div>
          <button
            onClick={() => onSelectItem('settings')}
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
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="p-3 border-t border-slate-800/80 text-[10px] text-slate-400 text-center leading-tight">
        <div>Developed with ❤️ by</div>
        <div className="font-bold text-slate-200 mt-0.5">EdgeX Digital & Babar Joya</div>
      </div>
    </aside>
  );
};
