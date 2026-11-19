import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignableRolesFor,
  canAssignRole,
  canAccessShopProfile,
  canManagePlatformShops,
  canEditManagedUser,
  hasValidShopAssignment,
  isShopRoleLimitReached,
  canManageTarget,
  canViewAdminTeam,
  canViewManagedUser,
  canUseManageUsers,
  grantablePermissionsFor,
  normalizePermissions,
  permissionGrantDenial,
  publicTeamMember,
  profileChangeDenial,
  withoutLegacyPasswordChangeFlag,
} from './policy.ts';

const emptyChange = {
  callerRole: 'admin' as const,
  callerId: 'actor',
  targetId: 'target',
  targetRole: 'cashier' as const,
  targetCreatedBy: 'actor',
  targetPermissions: ['pos'],
  targetActive: true,
  activeAdminCount: 2,
  superAdminCount: 1,
  activeSuperAdminCount: 1,
};

test('Shop Admins assign staff; Super Admins assign Admin accounts only', () => {
  assert.deepEqual(assignableRolesFor('admin'), ['cashier', 'manager']);
  assert.deepEqual(assignableRolesFor('super_admin'), ['admin']);
  assert.equal(canAssignRole('super_admin', 'super_admin'), false);
  assert.deepEqual(assignableRolesFor('manager', ['manage_users']), []);
});

test('only platform Super Admins manage shops and private platform resources', () => {
  assert.equal(canManagePlatformShops('super_admin'), true);
  assert.equal(canManagePlatformShops('admin'), false);
  assert.equal(canManagePlatformShops('manager'), false);
});

test('shop staff share one role-independent profile cap', () => {
  assert.equal(isShopRoleLimitReached('admin', 10, 0, 10, 100), true);
  assert.equal(isShopRoleLimitReached('cashier', 0, 99, 10, 100), false);
  assert.equal(isShopRoleLimitReached('manager', 0, 100, 10, 100), true);
  assert.equal(isShopRoleLimitReached('super_admin', 0, 1000, 10, 100), false);
});

test('legacy forced-password metadata is removed without changing other app metadata', () => {
  assert.deepEqual(withoutLegacyPasswordChangeFlag({
    must_change_password: true,
    provisioning_operation_id: 'operation',
  }), {
    provisioning_operation_id: 'operation',
  });
  assert.deepEqual(withoutLegacyPasswordChangeFlag(undefined), {});
});

test('admin cannot create or manage admin users while super_admin can manage admins', () => {
  assert.equal(canAssignRole('admin', 'admin'), false);
  assert.equal(profileChangeDenial({
    ...emptyChange,
    action: 'update',
    targetRole: 'admin',
    nextRole: 'admin',
    nextPermissions: [],
    nextActive: true,
  }), 'You are not allowed to manage this user.');
  assert.equal(canManageTarget('super_admin', 'root', 'target', 'admin'), true);
});

test('super_admin edits admin', () => {
  assert.equal(profileChangeDenial({
    ...emptyChange,
    action: 'update',
    callerRole: 'super_admin',
    targetRole: 'admin',
    targetPermissions: ['pos', 'reports'],
    nextRole: 'admin',
    nextPermissions: ['pos', 'reports'],
    nextActive: true,
  }), null);
  assert.equal(profileChangeDenial({
    ...emptyChange,
    action: 'delete',
    callerRole: 'super_admin',
    targetRole: 'admin',
    targetActive: true,
    activeAdminCount: 2,
  }), null);
});

test('super_admin can edit own profile details but not own role or active status', () => {
  const ownProfile = {
    ...emptyChange,
    action: 'update' as const,
    callerRole: 'super_admin' as const,
    callerId: 'root',
    targetId: 'root',
    targetRole: 'super_admin' as const,
    targetPermissions: ['pos', 'reports'],
    nextRole: 'super_admin' as const,
    nextPermissions: ['pos', 'reports'],
    targetActive: true,
    nextActive: true,
  };
  assert.equal(profileChangeDenial(ownProfile), null);
  assert.match(profileChangeDenial({ ...ownProfile, nextRole: 'admin' }) ?? '', /own role/);
  assert.match(profileChangeDenial({ ...ownProfile, nextActive: false }) ?? '', /own role/);
});

test('nobody can change their own role, permissions, or active state', () => {
  assert.match(profileChangeDenial({
    ...emptyChange,
    action: 'update',
    callerRole: 'admin',
    callerId: 'same',
    targetId: 'same',
    nextRole: 'admin',
    nextPermissions: [],
    nextActive: true,
  }) ?? '', /own role, permissions, or active status/);
});

test('protects the last active super_admin from delete, demotion, and deactivation', () => {
  const deleteDenial = profileChangeDenial({
    ...emptyChange,
    action: 'delete',
    callerRole: 'super_admin',
    targetRole: 'super_admin',
    superAdminCount: 1,
    activeSuperAdminCount: 1,
  });
  const demoteDenial = profileChangeDenial({
    ...emptyChange,
    action: 'update',
    callerRole: 'super_admin',
    targetRole: 'super_admin',
    nextRole: 'admin',
    nextPermissions: [],
    nextActive: true,
    superAdminCount: 1,
    activeSuperAdminCount: 1,
  });
  const deactivateDenial = profileChangeDenial({
    ...emptyChange,
    action: 'update',
    callerRole: 'super_admin',
    targetRole: 'super_admin',
    nextRole: 'super_admin',
    nextPermissions: ['pos'],
    nextActive: false,
    superAdminCount: 2,
    activeSuperAdminCount: 1,
  });
  assert.match(deleteDenial ?? '', /last super_admin/);
  assert.match(demoteDenial ?? '', /last super_admin/);
  assert.match(deactivateDenial ?? '', /last super_admin/);
});

test('does not block removing an inactive admin when another active admin remains', () => {
  assert.equal(profileChangeDenial({
    ...emptyChange,
    action: 'delete',
    callerRole: 'super_admin',
    targetRole: 'admin',
    targetActive: false,
    activeAdminCount: 1,
  }), null);
});

  test('protects the last active admin from deletion and deactivation', () => {
    for (const change of [
      { action: 'delete' as const },
      { action: 'update' as const, nextRole: 'admin' as const, nextActive: false },
    ]) {
      assert.match(profileChangeDenial({
        ...emptyChange,
        ...change,
        callerRole: 'super_admin',
        targetRole: 'admin',
        targetActive: true,
        nextPermissions: [],
        activeAdminCount: 1,
      }) ?? '', /last active admin/);
    }
  });

  test('super_admin may create an admin role', () => {
  assert.equal(profileChangeDenial({
    ...emptyChange,
    action: 'update',
    callerRole: 'super_admin',
    targetRole: 'cashier',
    nextRole: 'admin',
    nextPermissions: [],
    nextActive: true,
  }), null);
});

  test('only Admin roles can manage users; Shop Admins cannot grant Manage Users', () => {
    const permissions = ['manage_users', 'customers', 'pos'];
    assert.deepEqual(assignableRolesFor('manager', permissions), []);
    assert.deepEqual(grantablePermissionsFor('admin', permissions, [
      'pos', 'customers', 'manage_users', 'reports', 'pos_print_sale', 'pos_print_payment',
    ]), ['customers', 'pos']);
    assert.equal(canManageTarget('manager', 'actor', 'user', 'cashier', ['pos'], permissions), false);
    assert.equal(canManageTarget('admin', 'actor', 'user', 'cashier', ['pos'], permissions, 'actor'), true);
    assert.equal(permissionGrantDenial('admin', permissions, ['pos']), null);
    assert.match(permissionGrantDenial('admin', permissions, ['reports']) ?? '', /only grant permissions that you hold/);
    assert.match(permissionGrantDenial('admin', permissions, ['manage_users']) ?? '', /Only super_admin/);
    assert.equal(canUseManageUsers('manager', permissions), false);
  });

  test('Manage Users profile scope requires the same shop for Admins and no shop for Super Admins', () => {
    assert.equal(canAccessShopProfile('admin', 'shop-a', 'shop-a'), true);
    assert.equal(canAccessShopProfile('admin', 'shop-a', 'shop-b'), false);
    assert.equal(canAccessShopProfile('admin', 'shop-a', null), false);
    assert.equal(canAccessShopProfile('admin', null, null), false);
    assert.equal(canAccessShopProfile('super_admin', null, 'shop-a'), true);
    assert.equal(canAccessShopProfile('super_admin', 'shop-a', 'shop-a'), false);
  });

  test('profile shop assignment matches platform versus shop-role invariants', () => {
    assert.equal(hasValidShopAssignment('super_admin', null), true);
    assert.equal(hasValidShopAssignment('super_admin', 'shop-a'), false);
    assert.equal(hasValidShopAssignment('admin', 'shop-a'), true);
    assert.equal(hasValidShopAssignment('cashier', null), false);
    assert.equal(hasValidShopAssignment('unknown', 'shop-a'), false);
  });

  test('admins can manage only their own created users; unassigned users stay inaccessible', () => {
    assert.equal(canManageTarget('admin', 'admin-a', 'member', 'cashier', [], [], 'admin-a'), true);
    assert.equal(canManageTarget('admin', 'admin-a', 'member', 'cashier', [], [], 'admin-b'), false);
    assert.equal(canManageTarget('admin', 'admin-a', 'member', 'cashier', [], [], null), false);
    assert.equal(canManageTarget('admin', 'admin-a', 'admin-a', 'admin'), true);
    assert.equal(canManageTarget('super_admin', 'root', 'member', 'cashier', [], [], null), true);
  });

  test('managed-user list visibility is scoped to an admin creator and preserves super-admin oversight', () => {
    assert.equal(canViewManagedUser('admin', 'admin-a', 'admin-a', null), true);
    assert.equal(canViewManagedUser('admin', 'admin-a', 'member', 'admin-a'), true);
    assert.equal(canViewManagedUser('admin', 'admin-a', 'member', 'admin-b'), false);
    assert.equal(canViewManagedUser('admin', 'admin-a', 'legacy', null), false);
    assert.equal(canViewManagedUser('super_admin', 'root', 'legacy', null), true);
    assert.equal(canViewManagedUser('manager', 'manager-a', 'member', null), false);
  });

  test('only super_admin may access an Admin team view', () => {
    assert.equal(canViewAdminTeam('super_admin', 'admin'), true);
    assert.equal(canViewAdminTeam('super_admin', 'cashier'), false);
    assert.equal(canViewAdminTeam('admin', 'admin'), false);
    assert.equal(canViewAdminTeam('manager', 'admin'), false);
  });

  test('Super Admin profile editing is limited to Admin accounts and self', () => {
    assert.equal(canEditManagedUser('super_admin', 'admin', false), true);
    assert.equal(canEditManagedUser('super_admin', 'cashier', false), false);
    assert.equal(canEditManagedUser('super_admin', 'super_admin', true), true);
    assert.equal(canEditManagedUser('admin', 'manager', false), true);
  });

  test('only super_admin may change account status or remove user access', () => {
    const memberChange = {
      ...emptyChange,
      action: 'update' as const,
      nextRole: 'cashier' as const,
      nextPermissions: ['pos'],
      nextActive: false,
    };
    assert.equal(profileChangeDenial(memberChange), 'Only super_admin may change account status.');
    assert.equal(profileChangeDenial({
      ...memberChange,
      callerRole: 'manager',
      callerPermissions: ['manage_users'],
    }), 'Only super_admin may change account status.');
    assert.equal(profileChangeDenial({
      ...memberChange,
      callerRole: 'super_admin',
    }), null);
    assert.equal(profileChangeDenial({
      ...emptyChange,
      action: 'delete',
      callerRole: 'admin',
    }), 'Only super_admin may remove user access.');
  });

  test('team member projection contains only safe fields and distinguishes removed accounts', () => {
    const member = publicTeamMember({
      username: 'cashier-one',
      role: 'cashier',
      is_active: false,
      deleted_at: null,
      created_at: '2026-10-01T10:00:00.000Z',
    }, {
      created_at: '2026-10-01T09:59:00.000Z',
      last_sign_in_at: null,
    });
    assert.deepEqual(Object.keys(member), [
      'username',
      'role',
      'status',
      'created_at',
      'last_sign_in_at',
    ]);
    assert.equal(member.status, 'deactivated');
    assert.equal(member.last_sign_in_at, null);
    assert.equal(publicTeamMember({
      username: 'cashier-two',
      role: 'cashier',
      is_active: false,
      deleted_at: '2026-10-02T10:00:00.000Z',
      created_at: '2026-10-01T10:00:00.000Z',
    }).status, 'removed');
  });

  test('Manage Users requires an explicit grant for Shop Admins', () => {
    assert.equal(canUseManageUsers('cashier', []), false);
    assert.equal(canUseManageUsers('manager', ['manage_users']), false);
    assert.equal(canUseManageUsers('admin', []), false);
    assert.equal(canUseManageUsers('admin', ['manage_users']), true);
    assert.equal(canUseManageUsers('super_admin', []), true);
  });

  test('Shop Admins can grant only permissions they hold and cannot grant Manage Users', () => {
    const callerPermissions = ['manage_users', 'customers', 'pos'];
    assert.equal(permissionGrantDenial('admin', callerPermissions, ['customers', 'pos']), null);
    assert.match(permissionGrantDenial('admin', callerPermissions, ['reports']) ?? '', /only grant permissions that you hold/);
    assert.match(permissionGrantDenial('admin', callerPermissions, ['manage_users']) ?? '', /Only super_admin/);
    assert.equal(permissionGrantDenial('manager', callerPermissions, ['customers']), 'Only admin or super_admin may manage users.');
  });

  test('normalizes print sub-permissions and strips them when POS is absent', () => {
    assert.deepEqual(normalizePermissions(['customers', 'pos_print_sale', 'pos_print_payment']), ['customers']);
    assert.deepEqual(
      normalizePermissions(['pos', 'pos_print_sale', 'pos_print_sale', 'pos_print_payment']),
      ['pos', 'pos_print_sale', 'pos_print_payment'],
    );
  });

  test('Admin settings section grants are Super-Admin-only and require the Settings module', () => {
    const section = 'settings_receipt_memo';
    assert.equal(permissionGrantDenial('super_admin', [], ['settings', section]), null);
    assert.equal(
      permissionGrantDenial('super_admin', [], [section]),
      'Admin settings section grants require the Settings page grant.',
    );
    assert.equal(
      permissionGrantDenial('admin', ['settings', section], ['settings', section], ['settings', section]),
      null,
    );
    assert.equal(
      permissionGrantDenial('admin', ['settings', section], ['settings'], ['settings', section]),
      'Only super_admin may change Admin settings section access.',
    );
    assert.deepEqual(normalizePermissions([section, 'pos']), ['pos']);
    assert.deepEqual(normalizePermissions(['settings', section]), ['settings', section]);
    assert.equal(profileChangeDenial({
      ...emptyChange,
      action: 'update',
      callerRole: 'super_admin',
      targetRole: 'cashier',
      nextRole: 'cashier',
      nextPermissions: ['settings', section],
      nextActive: true,
    }), 'Admin settings section access can only be assigned to Admin accounts.');
  });
