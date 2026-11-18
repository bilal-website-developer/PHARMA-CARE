import { UserRole } from '../types/pharmacy';

export const ROLE_DEMO_STATE_KEY = 'pharma-care.role-demo.state.v1';
export const ROLE_DEMO_ROLE_KEY = 'pharma-care.role-demo.role.v1';
export const DEMO_ACCOUNT_MARKER_KEY = 'pharma-care.demo-account.v1';
export const DEMO_ACCOUNT_ENTER_KEY = 'pharma-care.demo-account.enter.v1';

export interface DemoAccountMarker {
  userId: string;
  role: UserRole;
}

function isUserRole(value: unknown): value is UserRole {
  return Object.values(UserRole).some((role) => role === value);
}

export function readDemoAccountMarker(
  storage: Pick<Storage, 'getItem'>,
): { marker: DemoAccountMarker | null; warning: string | null } {
  try {
    const raw = storage.getItem(DEMO_ACCOUNT_MARKER_KEY);
    if (!raw) return { marker: null, warning: null };
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object'
      && value !== null
      && 'userId' in value
      && typeof value.userId === 'string'
      && value.userId.length > 0
      && 'role' in value
      && isUserRole(value.role)
    ) {
      return { marker: { userId: value.userId, role: value.role }, warning: null };
    }
    return { marker: null, warning: 'The saved demo account details are invalid and were ignored.' };
  } catch (error) {
    return {
      marker: null,
      warning: `Saved demo account details could not be read. ${error instanceof Error ? error.message : ''}`.trim(),
    };
  }
}

export function writeDemoAccountMarker(
  storage: Pick<Storage, 'setItem'>,
  marker: DemoAccountMarker,
): string | null {
  try {
    storage.setItem(DEMO_ACCOUNT_MARKER_KEY, JSON.stringify(marker));
    return null;
  } catch (error) {
    return `The signed-in session could not be linked to the Demo Hub. ${error instanceof Error ? error.message : ''}`.trim();
  }
}

export function clearDemoAccountMarker(storage: Pick<Storage, 'removeItem'>): string | null {
  try {
    storage.removeItem(DEMO_ACCOUNT_MARKER_KEY);
    return null;
  } catch (error) {
    return `The saved demo account link could not be cleared. ${error instanceof Error ? error.message : ''}`.trim();
  }
}

export function markDemoAccountEntry(
  storage: Pick<Storage, 'setItem'>,
  userId: string,
): string | null {
  try {
    storage.setItem(DEMO_ACCOUNT_ENTER_KEY, userId);
    return null;
  } catch (error) {
    return `The demo account could not be opened automatically. ${error instanceof Error ? error.message : ''}`.trim();
  }
}

export function consumeDemoAccountEntry(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  userId: string,
): { shouldEnter: boolean; warning: string | null } {
  try {
    const shouldEnter = storage.getItem(DEMO_ACCOUNT_ENTER_KEY) === userId;
    storage.removeItem(DEMO_ACCOUNT_ENTER_KEY);
    return { shouldEnter, warning: null };
  } catch (error) {
    return {
      shouldEnter: false,
      warning: `The saved demo account entry could not be restored. ${error instanceof Error ? error.message : ''}`.trim(),
    };
  }
}

export function clearDemoAccountEntry(storage: Pick<Storage, 'removeItem'>): string | null {
  try {
    storage.removeItem(DEMO_ACCOUNT_ENTER_KEY);
    return null;
  } catch (error) {
    return `The saved demo account entry could not be cleared. ${error instanceof Error ? error.message : ''}`.trim();
  }
}

type DemoStorage = Pick<Storage, 'removeItem'>;

export function clearRoleDemoSession(storage: DemoStorage): string | null {
  try {
    storage.removeItem(ROLE_DEMO_STATE_KEY);
    storage.removeItem(ROLE_DEMO_ROLE_KEY);
    return null;
  } catch (error) {
    return `Demo session data could not be cleared. ${error instanceof Error ? error.message : ''}`.trim();
  }
}
