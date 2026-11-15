import { UserRole } from '../types/pharmacy';
import { canAccessPage, MODULES } from '../permissions';
import type { PermissionKey } from '../permissions';
import { SIDEBAR_PAGES } from '../components/sidebarPages';
import type { SidebarPageKey } from '../components/sidebarPages';

export type DemoPreviewPageKey = Exclude<SidebarPageKey, 'demo'>;

export interface DemoPreviewState {
  records: Partial<Record<DemoPreviewPageKey, string[]>>;
  nextRecordId: number;
}

const INITIAL_DEMO_RECORDS: Partial<Record<DemoPreviewPageKey, string[]>> = {
  dashboard: ['Today: 18 sample sales', 'Low stock: 3 sample products', 'Active customers: 12'],
  pos: ['Sample receipt · DEMO-0001 · Rs 1,250.00'],
  products: ['Panadol 500mg · 24 packs', 'Augmentin 625mg · 8 packs', 'Risek 20mg · 16 packs'],
  'master-data': ['Pain Relief', 'Antibiotics', 'Vitamins'],
  'stock-inventory': ['Panadol · Batch DEMO-A · 24 packs', 'Augmentin · Batch DEMO-B · 8 packs'],
  customers: ['Ayesha Khan · Rs 0 balance', 'Usman Ali · Rs 450 balance'],
  'customer-ledger': ['DEMO-0001 · Sale · Rs 1,250', 'PAY-DEMO-001 · Payment · Rs 800'],
  'whatsapp-reminders': ['Usman Ali · Reminder due · Demo only'],
  'sales-history': ['DEMO-0001 · Today · Rs 1,250 · Demo Cashier'],
  suppliers: ['Demo Medical Distributor · Active'],
  purchases: ['Create a demo purchase to preview this workflow.'],
  'purchase-history': ['PUR-DEMO-001 · Today · Rs 4,800 · Draft preview'],
  expenses: ['Shop supplies · Rs 300 · Today'],
  reports: ['Today sales · Rs 1,250', 'Sample transactions · 18'],
  'manage-users': ['Demo Admin · Admin', 'Demo Manager · Manager', 'Demo Cashier · Cashier', 'Demo Accountant · Accountant'],
  'my-print-requests': ['DEMO-0001 · Receipt copy · Sample request'],
  'print-requests': ['DEMO-0001 · Receipt copy · Pending sample'],
  settings: ['Receipt template · Pharmacy Memo', 'Expiry warning · 90 days'],
  'trash-bin': ['Old sample supplier · Recoverable demo entry'],
  'help-support': ['Help and support content preview.'],
  shops: ['Demo Pharmacy · Active · Sample shop'],
};

const DEMO_PREVIEW_PAGE_KEYS: readonly DemoPreviewPageKey[] = [
  'dashboard',
  'pos',
  'products',
  'master-data',
  'stock-inventory',
  'customers',
  'customer-ledger',
  'whatsapp-reminders',
  'sales-history',
  'suppliers',
  'purchases',
  'purchase-history',
  'expenses',
  'reports',
  'manage-users',
  'my-print-requests',
  'print-requests',
  'settings',
  'trash-bin',
  'help-support',
  'shops',
];

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

export function createDemoPreviewState(): DemoPreviewState {
  const records: Partial<Record<DemoPreviewPageKey, string[]>> = {};
  for (const page of DEMO_PREVIEW_PAGE_KEYS) {
    records[page] = [...(INITIAL_DEMO_RECORDS[page] ?? [])];
  }
  return {
    records,
    nextRecordId: 1,
  };
}

export function addDemoPreviewRecord(
  state: DemoPreviewState,
  page: DemoPreviewPageKey,
  label: string,
): DemoPreviewState {
  const cleanedLabel = label.trim();
  if (!cleanedLabel) return state;

  return {
    records: {
      ...state.records,
      [page]: [...(state.records[page] ?? []), `${cleanedLabel} · Temporary demo item ${state.nextRecordId}`],
    },
    nextRecordId: state.nextRecordId + 1,
  };
}
