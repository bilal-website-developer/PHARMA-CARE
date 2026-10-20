import {
  BarChart3, BellRing, FileText, HelpCircle, History, Layers, LayoutDashboard,
  MessageSquare, Package, Printer, Receipt, Settings, ShoppingBag, ShoppingCart,
  Trash2, Truck, UserCheck, Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { UserRole } from '../types/pharmacy';
import type { ModuleKey } from '../permissions';

export type SidebarPageKey =
  | 'dashboard' | 'pos' | 'products' | 'master-data' | 'stock-inventory'
  | 'customers' | 'customer-ledger' | 'whatsapp-reminders' | 'sales-history'
  | 'suppliers' | 'purchases' | 'purchase-history' | 'expenses' | 'reports'
  | 'manage-users' | 'my-print-requests' | 'print-requests' | 'settings' | 'trash-bin' | 'help-support';

export interface SidebarPage {
  key: SidebarPageKey;
  label: string;
  icon: LucideIcon;
  route: string;
  category: string;
  allowedRoles: readonly UserRole[];
  module?: ModuleKey;
  adminOnly?: boolean;
  sidebar?: boolean;
}

const ALL_ROLES = [
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.ACCOUNTANT,
] as const;
const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

export const SIDEBAR_CATEGORIES = [
  'Main',
  'Inventory & Products',
  'Sales & Customers',
  'Procurement',
  'Accounts & Admin',
  'Settings & System',
] as const;

export const SIDEBAR_PAGES: readonly SidebarPage[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, route: '/', category: 'Main', allowedRoles: ALL_ROLES },
  { key: 'pos', label: 'POS Billing', icon: ShoppingCart, route: '/pos', category: 'Main', allowedRoles: ALL_ROLES, module: 'pos' },
  { key: 'products', label: 'Products', icon: Package, route: '/products', category: 'Inventory & Products', allowedRoles: ALL_ROLES, module: 'products' },
  { key: 'master-data', label: 'Categories', icon: Layers, route: '/categories', category: 'Inventory & Products', allowedRoles: ALL_ROLES, module: 'categories' },
  { key: 'stock-inventory', label: 'Stock Inventory', icon: Package, route: '/stock-inventory', category: 'Inventory & Products', allowedRoles: ALL_ROLES, module: 'stock_inventory' },
  { key: 'customer-ledger', label: 'Customer Ledger', icon: FileText, route: '/customer-ledger', category: 'Sales & Customers', allowedRoles: ALL_ROLES, module: 'customers' },
  { key: 'whatsapp-reminders', label: 'WhatsApp Reminders', icon: MessageSquare, route: '/whatsapp-reminders', category: 'Sales & Customers', allowedRoles: ALL_ROLES, module: 'customers' },
  { key: 'sales-history', label: 'Sales History', icon: History, route: '/sales-history', category: 'Sales & Customers', allowedRoles: ALL_ROLES, module: 'sales_history' },
  { key: 'my-print-requests', label: 'My print requests', icon: BellRing, route: '/my-print-requests', category: 'Sales & Customers', allowedRoles: ALL_ROLES },
  { key: 'suppliers', label: 'Suppliers', icon: Truck, route: '/suppliers', category: 'Procurement', allowedRoles: ALL_ROLES, module: 'suppliers' },
  { key: 'purchases', label: 'Purchases', icon: ShoppingBag, route: '/purchases', category: 'Procurement', allowedRoles: ALL_ROLES, module: 'purchases' },
  { key: 'purchase-history', label: 'Purchase History', icon: Receipt, route: '/purchase-history', category: 'Procurement', allowedRoles: ALL_ROLES, module: 'purchase_history' },
  { key: 'expenses', label: 'Expenses', icon: Wallet, route: '/expenses', category: 'Accounts & Admin', allowedRoles: ALL_ROLES, module: 'expenses' },
  { key: 'reports', label: 'Business Analytics', icon: BarChart3, route: '/reports', category: 'Accounts & Admin', allowedRoles: ALL_ROLES, module: 'reports' },
  { key: 'manage-users', label: 'Manage Users', icon: UserCheck, route: '/users', category: 'Accounts & Admin', allowedRoles: ALL_ROLES, module: 'manage_users' },
  { key: 'print-requests', label: 'Print Requests', icon: Printer, route: '/print-requests', category: 'Accounts & Admin', allowedRoles: ADMIN_ROLES, adminOnly: true },
  { key: 'settings', label: 'Settings', icon: Settings, route: '/settings', category: 'Settings & System', allowedRoles: ADMIN_ROLES, adminOnly: true },
  { key: 'trash-bin', label: 'Trash Bin', icon: Trash2, route: '/trash-bin', category: 'Settings & System', allowedRoles: ADMIN_ROLES, adminOnly: true },
  { key: 'help-support', label: 'Help & Support', icon: HelpCircle, route: '/help', category: 'Settings & System', allowedRoles: ALL_ROLES },
  { key: 'customers', label: 'Customers', icon: FileText, route: '/customers', category: 'Sales & Customers', allowedRoles: ALL_ROLES, module: 'customers', sidebar: false },
];

const PAGES_BY_KEY = new Map(SIDEBAR_PAGES.map((page) => [page.key, page]));

export function getSidebarPage(key: string): SidebarPage | undefined {
  return PAGES_BY_KEY.get(key as SidebarPageKey);
}

export function isSidebarPageKey(key: unknown): key is SidebarPageKey {
  return typeof key === 'string' && PAGES_BY_KEY.has(key as SidebarPageKey);
}

export function sidebarPageForRoute(route: string): SidebarPage | undefined {
  return SIDEBAR_PAGES.find((page) => page.route === route);
}
