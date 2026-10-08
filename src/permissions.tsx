import React, { createContext, useContext, useMemo } from 'react';
import { UserRole } from './types/pharmacy';

export const MODULES = [
  { key: 'pos', label: 'POS Billing' },
  { key: 'products', label: 'Products' },
  { key: 'categories', label: 'Categories' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'customers', label: 'Customers' },
  { key: 'sales_history', label: 'Sales History' },
  { key: 'purchase_history', label: 'Purchase History' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'stock_inventory', label: 'Stock Inventory' },
  { key: 'reports', label: 'Reports' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, readonly ModuleKey[]> = {
  [UserRole.CASHIER]: ['pos', 'customers'],
  [UserRole.MANAGER]: [
    'pos', 'products', 'categories', 'suppliers', 'customers',
    'sales_history', 'purchase_history', 'purchases', 'stock_inventory', 'reports',
  ],
  [UserRole.ACCOUNTANT]: [
    'customers', 'suppliers', 'sales_history', 'purchase_history', 'expenses', 'reports',
  ],
  [UserRole.ADMIN]: [],
  [UserRole.SUPER_ADMIN]: MODULES.map(({ key }) => key),
};

const PAGE_MODULE: Partial<Record<string, ModuleKey>> = {
  pos: 'pos',
  products: 'products',
  'master-data': 'categories',
  'stock-inventory': 'stock_inventory',
  customers: 'customers',
  'customer-ledger': 'customers',
  'whatsapp-reminders': 'customers',
  'sales-history': 'sales_history',
  suppliers: 'suppliers',
  purchases: 'purchases',
  'purchase-history': 'purchase_history',
  expenses: 'expenses',
  reports: 'reports',
};

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && MODULES.some(({ key }) => key === value);
}

export function permissionsForRole(role: UserRole, permissions: readonly string[]) {
  return role === UserRole.SUPER_ADMIN ? ROLE_DEFAULT_PERMISSIONS[role] : permissions;
}

export function isAdminRole(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

export function canAccessModule(role: UserRole, permissions: readonly string[], moduleKey: ModuleKey) {
  return permissionsForRole(role, permissions).includes(moduleKey);
}

export function canAccessPage(role: UserRole, permissions: readonly string[], pageKey: string) {
  if (pageKey === 'dashboard' || pageKey === 'help-support') return true;
  if (['manage-users', 'settings', 'trash-bin'].includes(pageKey)) return isAdminRole(role);
  const moduleKey = PAGE_MODULE[pageKey];
  return moduleKey ? canAccessModule(role, permissions, moduleKey) : false;
}

interface PermissionContextValue {
  isAdmin: boolean;
  can: (moduleKey: ModuleKey) => boolean;
  canPage: (pageKey: string) => boolean;
}

const PermissionContext = createContext<PermissionContextValue | null>(null);

export function PermissionsProvider({
  role,
  permissions,
  children,
}: React.PropsWithChildren<{ role: UserRole; permissions: readonly string[] }>) {
  const value = useMemo<PermissionContextValue>(() => {
    const isAdmin = isAdminRole(role);
    const can = (moduleKey: ModuleKey) => canAccessModule(role, permissions, moduleKey);
    const canPage = (pageKey: string) => canAccessPage(role, permissions, pageKey);
    return { isAdmin, can, canPage };
  }, [role, permissions]);
  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (!context) throw new Error('usePermissions must be used within PermissionsProvider.');
  return context;
}
