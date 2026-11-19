import React, { createContext, useContext, useMemo } from 'react';
import { UserRole } from './types/pharmacy';
import { getSidebarPage } from './components/sidebarPages';

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
  { key: 'manage_users', label: 'Manage Users' },
  { key: 'settings', label: 'Settings' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];

export const POS_PRINT_PERMISSION_KEYS = ['pos_print_sale', 'pos_print_payment'] as const;
export type PosPrintPermissionKey = (typeof POS_PRINT_PERMISSION_KEYS)[number];
export const SETTINGS_SECTION_PERMISSIONS = [
  { key: 'settings_shop_profile', label: 'Shop profile' },
  { key: 'settings_receipt_memo', label: 'Receipt and memo' },
  { key: 'settings_receipt_qr', label: 'Receipt QR' },
  { key: 'settings_operations', label: 'Operational limits' },
  { key: 'settings_demo_data', label: 'Demo data' },
  { key: 'settings_whatsapp_templates', label: 'WhatsApp templates' },
] as const;
export type SettingsSectionPermissionKey = (typeof SETTINGS_SECTION_PERMISSIONS)[number]['key'];
export type PermissionKey = ModuleKey | PosPrintPermissionKey | SettingsSectionPermissionKey;

export function hasPosPrintToggles(permissions: readonly PermissionKey[]): boolean {
  return permissions.includes('pos');
}

export function normalizePermissionSelection(permissions: readonly PermissionKey[]): PermissionKey[] {
  const unique = [...new Set(permissions)];
  const withSettingsSections = unique.includes('settings')
    ? unique
    : unique.filter((permission) =>
      !SETTINGS_SECTION_PERMISSIONS.some(({ key }) => key === permission)
    );
  return hasPosPrintToggles(withSettingsSections)
    ? withSettingsSections
    : withSettingsSections.filter((permission) => !POS_PRINT_PERMISSION_KEYS.includes(permission as PosPrintPermissionKey));
}

export function setModulePermission(
  permissions: readonly PermissionKey[],
  module: ModuleKey,
  enabled: boolean,
): PermissionKey[] {
  const next = new Set(permissions);
  if (enabled) next.add(module);
  else next.delete(module);

  if (module === 'pos') {
    if (!enabled) {
      POS_PRINT_PERMISSION_KEYS.forEach((permission) => next.delete(permission));
    }
  }
  if (module === 'settings' && !enabled) {
    SETTINGS_SECTION_PERMISSIONS.forEach(({ key }) => next.delete(key));
  }

  return normalizePermissionSelection([...next]);
}

export function setPosPrintPermission(
  permissions: readonly PermissionKey[],
  permission: PosPrintPermissionKey,
  enabled: boolean,
): PermissionKey[] {
  if (!hasPosPrintToggles(permissions)) return normalizePermissionSelection(permissions);
  const next = new Set(permissions);
  if (enabled) next.add(permission);
  else next.delete(permission);
  return normalizePermissionSelection([...next]);
}

export function setSettingsSectionPermission(
  permissions: readonly PermissionKey[],
  permission: SettingsSectionPermissionKey,
  enabled: boolean,
): PermissionKey[] {
  if (!permissions.includes('settings')) return normalizePermissionSelection(permissions);
  const next = new Set(permissions);
  if (enabled) next.add(permission);
  else next.delete(permission);
  return normalizePermissionSelection([...next]);
}

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && MODULES.some(({ key }) => key === value);
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return isModuleKey(value)
    || POS_PRINT_PERMISSION_KEYS.some((key) => key === value)
    || SETTINGS_SECTION_PERMISSIONS.some(({ key }) => key === value);
}

export function permissionsForRole(role: UserRole, permissions: readonly string[]) {
  return role === UserRole.SUPER_ADMIN ? [] : permissions;
}

export function isAdminRole(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

export function canAccessModule(role: UserRole, permissions: readonly string[], moduleKey: ModuleKey) {
  return permissionsForRole(role, permissions).includes(moduleKey);
}

export function canAccessPage(role: UserRole, permissions: readonly string[], pageKey: string) {
  const page = getSidebarPage(pageKey);
  if (!page || !page.allowedRoles.includes(role)) return false;
  if (page.key === 'manage-users') {
    return role === UserRole.SUPER_ADMIN
      || (role === UserRole.ADMIN && canAccessModule(role, permissions, 'manage_users'));
  }

  if (page.adminOnly) return role === UserRole.ADMIN;
  return page.module ? canAccessModule(role, permissions, page.module) : true;
}

export function canEditSettingsSection(
  role: UserRole,
  permissions: readonly string[],
  section: SettingsSectionPermissionKey,
): boolean {
  if (!canAccessModule(role, permissions, 'settings')) return false;
  if (role === UserRole.ADMIN) return permissions.includes(section);
  if (role === UserRole.MANAGER) {
    return section !== 'settings_shop_profile' && section !== 'settings_demo_data';
  }
  return false;
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
