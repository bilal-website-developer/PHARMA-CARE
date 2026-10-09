export const ROLES = ['cashier', 'manager', 'accountant', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

const ROLE_LEVEL: Record<Role, number> = {
  cashier: 0,
  manager: 1,
  accountant: 1,
  admin: 2,
  super_admin: 3,
};

export function assignableRolesFor(callerRole: Role): Role[] {
  return callerRole === 'super_admin'
    ? [...ROLES]
    : callerRole === 'admin'
      ? ['cashier', 'manager', 'accountant']
      : [];
}

export function canAssignRole(callerRole: Role, role: Role): boolean {
  return assignableRolesFor(callerRole).includes(role);
}

export function canManageTarget(
  callerRole: Role,
  callerId: string,
  targetId: string,
  targetRole: Role
): boolean {
  if (callerId === targetId) return true;
  if (callerRole === 'super_admin') return true;
  return callerRole === 'admin' && ROLE_LEVEL[targetRole] < ROLE_LEVEL.admin;
}

interface ProfileChangePolicy {
  action: 'update' | 'delete';
  callerRole: Role;
  callerId: string;
  targetId: string;
  targetRole: Role;
  nextRole?: Role;
  targetPermissions: readonly string[];
  nextPermissions?: readonly string[];
  targetActive: boolean;
  nextActive?: boolean;
  activeAdminCount: number;
  superAdminCount: number;
  activeSuperAdminCount: number;
}

function samePermissions(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return new Set(left).size === rightSet.size && left.every((permission) => rightSet.has(permission));
}

export function profileChangeDenial(change: ProfileChangePolicy): string | null {
  const isSelf = change.callerId === change.targetId;
  if (change.action === 'delete' && isSelf) return 'Cannot delete your own account.';

  if (change.action === 'update') {
    const nextRole = change.nextRole;
    const nextPermissions = change.nextPermissions ?? [];
    const nextActive = change.nextActive;
    if (!nextRole || nextActive === undefined) return 'Profile role and active status are required.';
    if (isSelf && (
      nextRole !== change.targetRole
      || !samePermissions(nextPermissions, change.targetPermissions)
      || nextActive !== change.targetActive
    )) {
      return 'Cannot change your own role, permissions, or active status.';
    }
    if (nextRole !== change.targetRole && !canAssignRole(change.callerRole, nextRole)) {
      return 'You are not allowed to assign this role.';
    }
  }

  if (!canManageTarget(change.callerRole, change.callerId, change.targetId, change.targetRole)) {
    return 'You are not allowed to manage this user.';
  }

  const nextRole = change.nextRole ?? change.targetRole;
  const isDemoting = nextRole !== change.targetRole;
  const isDeactivating = change.nextActive === false && change.targetActive;
  if (change.targetRole === 'admin' && change.activeAdminCount <= 1
    && ((change.targetActive && (change.action === 'delete' || isDemoting)) || isDeactivating)) {
    return change.action === 'delete'
      ? 'Cannot delete the last active admin.'
      : 'Cannot demote or deactivate the last active admin.';
  }
  if (change.targetRole === 'super_admin') {
    if (change.action === 'delete'
      && (change.superAdminCount <= 1 || (change.targetActive && change.activeSuperAdminCount <= 1))) {
      return 'Cannot delete the last super_admin.';
    }
    if (isDemoting && (change.superAdminCount <= 1 || (change.targetActive && change.activeSuperAdminCount <= 1))) {
      return 'Cannot demote the last super_admin.';
    }
    if (isDeactivating && change.activeSuperAdminCount <= 1) {
      return 'Cannot deactivate the last super_admin.';
    }
  }
  return null;
}
