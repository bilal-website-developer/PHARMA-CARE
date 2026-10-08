import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_USERS = 99;
const MODULE_KEYS = [
  'pos', 'products', 'categories', 'suppliers', 'customers', 'sales_history',
  'purchase_history', 'purchases', 'expenses', 'stock_inventory', 'reports',
] as const;
const ROLES = ['cashier', 'manager', 'accountant', 'admin', 'super_admin'] as const;
type Role = (typeof ROLES)[number];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value as Role);
}

function validPermissions(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(
    (permission) => typeof permission === 'string' && MODULE_KEYS.includes(permission as typeof MODULE_KEYS[number])
  );
}

function safeProfile(
  profile: {
    id: string;
    full_name: string | null;
    username: string | null;
    email: string | null;
    role: string | null;
    is_active: boolean | null;
    permissions: string[] | null;
    deleted_at?: string | null;
  },
  authEmail?: string,
) {
  const email = String(profile.email ?? authEmail ?? '');
  const username = String(profile.username ?? email.split('@')[0] ?? '');
  const roleValue = String(profile.role ?? '').toLowerCase();
  return {
    ...profile,
    full_name: String(profile.full_name ?? username ?? email.split('@')[0] ?? ''),
    username,
    email,
    role: validRole(roleValue) ? roleValue : 'cashier',
    is_active: profile.is_active === true,
    permissions: roleValue === 'super_admin'
      ? [...MODULE_KEYS]
      : Array.isArray(profile.permissions)
        ? profile.permissions.filter((permission) => MODULE_KEYS.includes(permission as typeof MODULE_KEYS[number]))
        : [],
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { message: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response(401, { message: 'Authorization token is required.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing required Supabase function environment configuration.');
    return response(500, { message: 'User management is not configured on the server.' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return response(401, { message: 'Invalid or expired session.' });

    const { data: callerProfile, error: callerError } = await adminClient
      .from('profiles')
      .select('role,is_active,deleted_at')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (callerError) throw callerError;
    if (
      !callerProfile ||
      (callerProfile.role !== 'admin' && callerProfile.role !== 'super_admin') ||
      callerProfile.is_active !== true ||
      callerProfile.deleted_at !== null
    ) {
      return response(403, { message: 'Only an active admin can manage users.' });
    }
    const isSuperAdmin = callerProfile.role === 'super_admin';

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return response(400, { message: 'Request body must be a JSON object.' });
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return response(400, { message: 'Request body must be valid JSON.' });
    }

    const action = payload.action;
    if (action === 'list') {
      const { data: users, error } = await adminClient
        .from('profiles')
        .select('id,full_name,username,email,role,is_active,permissions')
        .is('deleted_at', null);
      if (error) throw error;
      const { data: authUsers, error: authUsersError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (authUsersError) throw authUsersError;
      const creationOrder = new Map(authUsers.users.map((user) => [user.id, user.created_at]));
      const authEmailById = new Map(authUsers.users.map((user) => [user.id, user.email]));
      const orderedUsers = (users ?? [])
        .filter((user) => isSuperAdmin || user.role !== 'super_admin')
        .map((user) => safeProfile(user, authEmailById.get(user.id)))
        .sort((left, right) =>
          (creationOrder.get(left.id) ?? '').localeCompare(creationOrder.get(right.id) ?? '')
        );
      return response(200, { users: orderedUsers, userLimit: MAX_USERS, currentCount: orderedUsers.length });
    }

    if (action === 'list_deleted') {
      const { data: users, error } = await adminClient
        .from('profiles')
        .select('id,full_name,username,email,role,is_active,permissions,deleted_at')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });
      if (error) throw error;
      const { data: authUsers, error: authUsersError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (authUsersError) throw authUsersError;
      const authEmailById = new Map(authUsers.users.map((user) => [user.id, user.email]));
      return response(200, {
        users: (users ?? [])
          .filter((user) => isSuperAdmin || user.role !== 'super_admin')
          .map((user) => safeProfile(user, authEmailById.get(user.id))),
      });
    }

    if (action === 'reset_password') {
      const id = typeof payload.id === 'string' ? payload.id : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      if (!id) return response(400, { message: 'User id is required.' });
      if (password.length < 8) return response(400, { message: 'Password must be at least 8 characters.' });
      const { data: target, error: targetError } = await adminClient
        .from('profiles')
        .select('id,role,deleted_at')
        .eq('id', id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.role === 'super_admin' || (!isSuperAdmin && target.role === 'admin')) {
        return response(404, { message: 'User not found.' });
      }
      if (target.deleted_at !== null) return response(400, { message: 'Restore this user before changing its password.' });

      const { error: passwordError } = await adminClient.auth.admin.updateUserById(id, { password });
      if (passwordError) return response(400, { message: `Could not reset password: ${passwordError.message}` });
      return response(200, { message: 'Password reset successfully.' });
    }

    if (action === 'create') {
      const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : '';
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const email = typeof payload.email === 'string' ? payload.email.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      const role = typeof payload.role === 'string'
        ? String(payload.role ?? '').trim().toLowerCase()
        : '';
      if (!fullName) return response(400, { message: 'Full name is required.' });
      if (!username) return response(400, { message: 'Username is required.' });
      if (!validEmail(email)) return response(400, { message: 'A valid email is required.' });
      if (password.length < 8) return response(400, { message: 'Password must be at least 8 characters.' });
      if (!role) return response(400, { message: 'Role is required.' });
      if (!validRole(role)) return response(400, { message: 'Role must be cashier, manager, accountant, or admin.' });
      if (role === 'super_admin' || (!isSuperAdmin && role === 'admin')) {
        return response(403, { message: 'You are not allowed to assign this role.' });
      }
      if (!validPermissions(payload.permissions)) return response(400, { message: 'Permissions contain an invalid module key.' });
      if (payload.is_active !== undefined && typeof payload.is_active !== 'boolean') {
        return response(400, { message: 'Active status must be true or false.' });
      }

      const { data: currentUsers, error: usersError } = await adminClient
        .from('profiles')
        .select('username,email');
      if (usersError) throw usersError;
      if ((currentUsers ?? []).some((user) =>
        user.username !== null &&
        String(user.username ?? '').toLowerCase() === String(username ?? '').toLowerCase()
      )) {
        return response(409, { message: 'Username already taken.' });
      }
      if ((currentUsers ?? []).some((user) =>
        user.email !== null &&
        String(user.email ?? '').toLowerCase() === String(email ?? '').toLowerCase()
      )) {
        return response(409, { message: 'Email already taken.' });
      }
      if ((currentUsers?.length ?? 0) >= MAX_USERS) return response(409, { message: 'The user limit has been reached.' });

      const permissions = role === 'super_admin' ? [...MODULE_KEYS] : payload.permissions;
      const { data: createdAuth, error: createAuthError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createAuthError || !createdAuth.user) {
        const detail = createAuthError?.message ?? 'No auth user was returned.';
        if (/already|registered|exists/i.test(detail)) return response(409, { message: 'Email already taken.' });
        return response(400, { message: detail });
      }

      if (payload.is_active === false) {
        const { error: banError } = await adminClient.auth.admin.updateUserById(createdAuth.user.id, {
          ban_duration: '876000h',
        });
        if (banError) {
          await adminClient.auth.admin.deleteUser(createdAuth.user.id);
          return response(500, { message: `Could not disable the new account: ${banError.message}` });
        }
      }

      const { error: profileError } = await adminClient.from('profiles').insert({
        id: createdAuth.user.id,
        full_name: fullName,
        username,
        email,
        role,
        permissions,
        is_active: payload.is_active !== false,
        deleted_at: null,
      });
      if (profileError) {
        const { error: rollbackError } = await adminClient.auth.admin.deleteUser(createdAuth.user.id);
        if (rollbackError) {
          console.error('Failed to roll back auth user after profile insert failure:', rollbackError.message);
          return response(500, {
            message: `Could not create profile: ${profileError.message}. Auth-user rollback also failed; contact support with user id ${createdAuth.user.id}.`,
          });
        }
        if (/username/i.test(profileError.message) && /duplicate|unique/i.test(profileError.message)) {
          return response(409, { message: 'Username already taken.' });
        }
        return response(400, { message: `Could not create profile: ${profileError.message}` });
      }
      return response(201, { message: 'User created successfully.', id: createdAuth.user.id });
    }

    if (action === 'update' || action === 'delete' || action === 'restore') {
      const id = typeof payload.id === 'string' ? payload.id : '';
      if (!id) return response(400, { message: 'User id is required.' });
      const { data: target, error: targetError } = await adminClient
        .from('profiles')
        .select('id,full_name,username,email,role,is_active,permissions,deleted_at')
        .eq('id', id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || target.role === 'super_admin' || (!isSuperAdmin && target.role === 'admin' && id !== authData.user.id)) {
        return response(404, { message: 'User not found.' });
      }
      const isSelf = id === authData.user.id;

      const { count: activeAdminCount, error: countError } = await adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('is_active', true)
        .is('deleted_at', null);
      if (countError) throw countError;
      const isLastActiveAdmin = target.role === 'admin' && target.is_active && target.deleted_at === null && (activeAdminCount ?? 0) <= 1;

      if (action === 'delete') {
        if (target.deleted_at !== null) return response(404, { message: 'User is already deleted.' });
        if (isSelf) return response(403, { message: 'Cannot delete your own account.' });
        if (isLastActiveAdmin) return response(403, { message: 'Cannot delete the last active admin.' });
        const deletedAt = new Date().toISOString();
        const { error: updateError } = await adminClient
          .from('profiles')
          .update({ deleted_at: deletedAt, is_active: false })
          .eq('id', id);
        if (updateError) throw updateError;
        const { error: banError } = await adminClient.auth.admin.updateUserById(id, { ban_duration: '876000h' });
        if (banError) {
          await adminClient.from('profiles').update({ deleted_at: target.deleted_at, is_active: target.is_active }).eq('id', id);
          return response(500, { message: `Could not disable the account: ${banError.message}` });
        }
        return response(200, { message: 'User moved to Trash Bin.' });
      }

      if (action === 'restore') {
        if (target.deleted_at === null) return response(400, { message: 'User is not deleted.' });
        const { count, error: countError } = await adminClient.from('profiles')
          .select('id', { count: 'exact', head: true })
          .is('deleted_at', null);
        if (countError) throw countError;
        if ((count ?? 0) >= MAX_USERS) return response(409, { message: 'The user limit has been reached.' });
        const { error: updateError } = await adminClient.from('profiles')
          .update({ deleted_at: null, is_active: true })
          .eq('id', id);
        if (updateError) throw updateError;
        const { error: unbanError } = await adminClient.auth.admin.updateUserById(id, { ban_duration: 'none' });
        if (unbanError) {
          await adminClient.from('profiles').update({ deleted_at: target.deleted_at, is_active: false }).eq('id', id);
          return response(500, { message: `Could not restore the account: ${unbanError.message}` });
        }
        return response(200, { message: 'User restored successfully.' });
      }

      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : '';
      const email = typeof payload.email === 'string' ? payload.email.trim() : '';
      const role = typeof payload.role === 'string'
        ? String(payload.role ?? '').trim().toLowerCase()
        : '';
      if (!fullName) return response(400, { message: 'Full name is required.' });
      if (!username) return response(400, { message: 'Username is required.' });
      if (!validEmail(email)) return response(400, { message: 'A valid email is required.' });
      if (!role) return response(400, { message: 'Role is required.' });
      if (!validRole(role)) return response(400, { message: 'Role is invalid.' });
      if (
        role === 'super_admin' ||
        (!isSuperAdmin && role === 'admin' && target.role !== 'admin') ||
        (!isSuperAdmin && target.role === 'admin' && role !== 'admin')
      ) {
        return response(403, { message: 'You are not allowed to assign this role.' });
      }
      if (!validPermissions(payload.permissions)) return response(400, { message: 'Permissions contain an invalid module key.' });
      if (typeof payload.is_active !== 'boolean') return response(400, { message: 'Active status is required.' });
      if (payload.password !== undefined) return response(400, { message: 'Use the password reset action to set a new password.' });
      if (target.deleted_at !== null) return response(400, { message: 'Restore this user before editing.' });
      const { data: otherUsers, error: duplicateError } = await adminClient
        .from('profiles')
        .select('id,username,email')
        .neq('id', id);
      if (duplicateError) throw duplicateError;
      if ((otherUsers ?? []).some((user) =>
        user.id !== id &&
        user.username !== null &&
        String(user.username ?? '').toLowerCase() === String(username ?? '').toLowerCase()
      )) {
        return response(409, { message: 'Username already taken.' });
      }
      if ((otherUsers ?? []).some((user) =>
        user.id !== id &&
        user.email !== null &&
        String(user.email ?? '').toLowerCase() === String(email ?? '').toLowerCase()
      )) {
        return response(409, { message: 'Email already taken.' });
      }

      const nextRole = role as Role;
      const nextActive = payload.is_active as boolean;
      const isDemoting = target.role === 'admin' && nextRole !== 'admin';
      if (isSelf && (!nextActive || isDemoting)) return response(403, { message: 'Cannot deactivate or demote your own account.' });
      if (isLastActiveAdmin && (!nextActive || isDemoting)) {
        return response(403, { message: 'Cannot demote or deactivate the last active admin.' });
      }
      const permissions = nextRole === 'super_admin' ? [...MODULE_KEYS] : payload.permissions;

      const authChanges: { email?: string; ban_duration?: string } = {};
      if (String(email ?? '').toLowerCase() !== String(target.email ?? '').toLowerCase()) authChanges.email = email;
      if (nextActive !== target.is_active) authChanges.ban_duration = nextActive ? 'none' : '876000h';
      if (Object.keys(authChanges).length) {
        const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, authChanges);
        if (authUpdateError) {
          if (/already|registered|exists/i.test(authUpdateError.message)) return response(409, { message: 'Email already taken.' });
          return response(400, { message: `Could not update auth user: ${authUpdateError.message}` });
        }
      }
      const { error: profileUpdateError } = await adminClient.from('profiles')
        .update({ full_name: fullName, username, email, role: nextRole, permissions, is_active: nextActive })
        .eq('id', id);
      if (profileUpdateError) {
        if (authChanges.email || authChanges.ban_duration) {
          const rollback: { email?: string; ban_duration?: string } = {};
          if (authChanges.email) rollback.email = target.email;
          if (authChanges.ban_duration) rollback.ban_duration = target.is_active ? 'none' : '876000h';
          const { error: rollbackError } = await adminClient.auth.admin.updateUserById(id, rollback);
          if (rollbackError) console.error('Could not roll back auth changes after profile update failure:', rollbackError.message);
        }
        return response(400, { message: `Could not update profile: ${profileUpdateError.message}` });
      }
      return response(200, { message: 'User updated successfully.' });
    }

    return response(400, { message: 'Unknown action. Use list, create, update, delete, list_deleted, or restore.' });
  } catch (error) {
    console.error('manage-users request failed:', messageOf(error));
    return response(500, { message: messageOf(error) });
  }
});
