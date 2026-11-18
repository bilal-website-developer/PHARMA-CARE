import { UserRole } from '../types/pharmacy';
import { canAccessPage, MODULES } from '../permissions';
import type { PermissionKey } from '../permissions';
import { SIDEBAR_PAGES } from '../components/sidebarPages';
import type { SidebarPageKey } from '../components/sidebarPages';

export type DemoPreviewPageKey = Exclude<SidebarPageKey, 'demo'>;

const ADMIN_PERMISSIONS: readonly PermissionKey[] = MODULES.map(({ key }) => key);

const DEMO_ROLE_PERMISSIONS: Record<UserRole, readonly PermissionKey[]> = {
  [UserRole.SUPER_ADMIN]: [],
  [UserRole.ADMIN]: ADMIN_PERMISSIONS,
  [UserRole.MANAGER]: [
    'pos',
    'products',
    'categories',
    'suppliers',
    'customers',
    'sales_history',
    'purchase_history',
    'purchases',
    'stock_inventory',
    'expenses',
    'reports',
    'settings',
  ],
  [UserRole.CASHIER]: ['pos', 'customers', 'sales_history'],
  [UserRole.ACCOUNTANT]: ['customers', 'sales_history', 'purchase_history', 'expenses', 'reports'],
};

const DEMO_ACCOUNT_NAMES: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Demo Super Admin',
  [UserRole.ADMIN]: 'Demo Admin',
  [UserRole.MANAGER]: 'Demo Manager',
  [UserRole.CASHIER]: 'Demo Cashier',
  [UserRole.ACCOUNTANT]: 'Demo Accountant',
};

export const DEMO_PREVIEW_ROLES: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.ACCOUNTANT,
];

export function canOpenDemoPreview(role: UserRole): boolean {
  return role === UserRole.SUPER_ADMIN;
}

export function isDemoPreviewPageKey(key: SidebarPageKey): key is DemoPreviewPageKey {
  return key !== 'demo';
}

export function parseDemoPreviewRole(value: string | null): UserRole | null {
  return Object.values(UserRole).find((role) => role === value) ?? null;
}

export function getDemoAccountName(role: UserRole): string {
  return DEMO_ACCOUNT_NAMES[role];
}

export function getDemoRolePermissions(role: UserRole): readonly PermissionKey[] {
  return DEMO_ROLE_PERMISSIONS[role];
}

export function getDemoRolePages(role: UserRole) {
  const permissions = getDemoRolePermissions(role);
  return SIDEBAR_PAGES.filter((page) =>
    page.key !== 'demo' && canAccessPage(role, permissions, page.key)
  );
}
