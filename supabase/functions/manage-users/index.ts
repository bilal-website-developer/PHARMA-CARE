import { createClient } from 'npm:@supabase/supabase-js@2';
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
  ROLES,
  withoutLegacyPasswordChangeFlag,
} from './policy.ts';
import type { Role } from './policy.ts';

const MODULE_KEYS = [
  'pos', 'products', 'categories', 'suppliers', 'customers', 'sales_history',
  'purchase_history', 'purchases', 'expenses', 'stock_inventory', 'reports', 'manage_users', 'settings',
] as const;
const POS_PRINT_PERMISSION_KEYS = ['pos_print_sale', 'pos_print_payment'] as const;
const SETTINGS_SECTION_PERMISSION_KEYS = [
  'settings_shop_profile',
  'settings_receipt_memo',
  'settings_receipt_qr',
  'settings_operations',
  'settings_demo_data',
  'settings_whatsapp_templates',
] as const;
const PERMISSION_KEYS = [...MODULE_KEYS, ...POS_PRINT_PERMISSION_KEYS, ...SETTINGS_SECTION_PERMISSION_KEYS] as const;
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

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function findProvisioningAuthUser(
  client: ReturnType<typeof createClient>,
  operationId: string,
) {
  const perPage = 1000;
  for (let page = 1; page <= 10000; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((candidate) =>
      candidate.app_metadata?.provisioning_operation_id === operationId
    );
    if (user) return user;
    if (data.users.length < perPage) return null;
  }
  throw new Error('Auth user recovery exceeded the supported page limit.');
}

async function clearProvisioningMetadata(
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error) return `Could not reload the first Admin Auth account: ${error.message}`;
  const { provisioning_operation_id: _operationId, ...appMetadata } =
    withoutLegacyPasswordChangeFlag(data.user.app_metadata);
  const { error: updateError } = await client.auth.admin.updateUserById(userId, {
    app_metadata: appMetadata,
  });
  return updateError ? `Could not clear provisioning metadata: ${updateError.message}` : null;
}

function validRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value as Role);
}

async function writeAuditLog(
  client: ReturnType<typeof createClient>,
  actorId: string,
  action: string,
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) {
  const { error } = await client.from('audit_logs').insert({
    actor_id: actorId,
    action,
    entity: 'profile',
    entity_id: targetId,
    details: { before, after },
  });
  if (error) throw new Error(`User change succeeded but audit logging failed: ${error.message}`);
}

async function writeTrashEvent(
  client: ReturnType<typeof createClient>,
  actorId: string,
  entityId: string,
  action: 'deleted' | 'restored',
  displayName: string,
  metadata: Record<string, unknown>,
) {
  const { error } = await client.from('trash_bin_events').insert({
    actor_id: actorId,
    entity_type: 'profile',
    entity_id: entityId,
    action,
    display_name: displayName,
    metadata,
  });
  if (error) throw new Error(`User change succeeded but Trash Bin history could not be saved: ${error.message}`);
}

async function restoreAuthStatusFromProfile(
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('is_active,deleted_at')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) return `Could not reload profile status: ${profileError.message}`;

  const isActive = profile?.is_active === true && profile.deleted_at === null;
  const { error: authError } = await client.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : '876000h',
  });
  return authError ? `Could not synchronize Auth status: ${authError.message}` : null;
}

function validPermissions(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(
    (permission) => typeof permission === 'string' && PERMISSION_KEYS.includes(permission as typeof PERMISSION_KEYS[number])
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
    shop_id?: string | null;
    created_by?: string | null;
    deleted_at?: string | null;
  },
  authEmail?: string,
) {
  const publicFields = { ...profile };
  delete publicFields.created_by;
  delete publicFields.shop_id;
  const email = String(profile.email ?? authEmail ?? '');
  const username = String(profile.username ?? email.split('@')[0] ?? '');
  const roleValue = String(profile.role ?? '').toLowerCase();
  return {
    ...publicFields,
    full_name: String(profile.full_name ?? username ?? email.split('@')[0] ?? ''),
    username,
    email,
    role: validRole(roleValue) ? roleValue : 'cashier',
    is_active: profile.is_active === true,
    permissions: roleValue === 'super_admin'
      ? []
      : Array.isArray(profile.permissions)
        ? normalizePermissions(profile.permissions.filter((permission) => PERMISSION_KEYS.includes(permission as typeof PERMISSION_KEYS[number])))
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
      .select('role,is_active,deleted_at,permissions,shop_id')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (callerError) throw callerError;
    const callerShopId = typeof callerProfile?.shop_id === 'string' ? callerProfile.shop_id : null;
    if (
      !callerProfile ||
      !validRole(callerProfile.role) ||
      callerProfile.is_active !== true ||
      callerProfile.deleted_at !== null ||
      (callerProfile.role === 'admin' && callerShopId === null) ||
      (callerProfile.role === 'super_admin' && callerShopId !== null)
    ) {
      return response(403, { message: 'An active admin or super_admin account is required.' });
    }
    const isSuperAdmin = callerProfile.role === 'super_admin';
    const callerRole = callerProfile.role as Role;
    const callerPermissions = Array.isArray(callerProfile.permissions)
      ? callerProfile.permissions.filter((permission) =>
        typeof permission === 'string' && PERMISSION_KEYS.includes(permission as typeof PERMISSION_KEYS[number])
      )
      : [];
    const targetInScope = (target: { role?: string | null; shop_id?: string | null }) => {
      const targetShopId = target.shop_id ?? null;
      return typeof target.role === 'string'
        && hasValidShopAssignment(target.role, targetShopId)
        && canAccessShopProfile(callerRole, callerShopId, targetShopId);
    };

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
    if (action === 'clear_legacy_password_change') {
      if (authData.user.app_metadata?.must_change_password !== true) {
        return response(200, { message: 'No legacy password setup flag needs clearing.' });
      }
      const { error: metadataError } = await adminClient.auth.admin.updateUserById(authData.user.id, {
        app_metadata: withoutLegacyPasswordChangeFlag(authData.user.app_metadata),
      });
      if (metadataError) {
        return response(500, { message: `Could not clear obsolete password setup metadata: ${metadataError.message}` });
      }
      return response(200, { message: 'Obsolete password setup metadata cleared.' });
    }

    if (callerRole === 'admin' && callerShopId !== null) {
      const { data: ownShop, error: ownShopError } = await adminClient
        .from('shops')
        .select('status')
        .eq('id', callerShopId)
        .maybeSingle();
      if (ownShopError) throw ownShopError;
      if (ownShop?.status !== 'active') {
        return response(403, { message: 'Your shop is not active. Contact the platform administrator.' });
      }
    }

    if (!canUseManageUsers(callerRole, callerPermissions)) {
      return response(403, { message: 'An active admin or super_admin account is required.' });
    }
    if (action === 'shops_list') {
      if (!canManagePlatformShops(callerRole)) {
        return response(403, { message: 'Only the platform Super Admin may manage shops.' });
      }
      const [
        { data: shops, error: shopsError },
        { data: operationalSettings, error: operationalSettingsError },
        { data: receiptQrSettings, error: receiptQrSettingsError },
      ] = await Promise.all([
        adminClient.from('shops')
          .select('id,name,phone,address,logo_path,status,admin_limit,staff_limit')
          .order('name', { ascending: true }),
        adminClient.from('shop_settings').select('shop_id,settings'),
        adminClient.from('shop_receipt_qr_settings')
          .select('shop_id,public_receipts_enabled,link_lifetime_days,show_medicine_names,qr_placement,qr_base_url'),
      ]);
      if (shopsError || operationalSettingsError || receiptQrSettingsError) {
        throw shopsError ?? operationalSettingsError ?? receiptQrSettingsError;
      }
      const settingsByShop = new Map((operationalSettings ?? []).map((row) => [row.shop_id, row.settings]));
      const qrSettingsByShop = new Map((receiptQrSettings ?? []).map((row) => [row.shop_id, row]));
      const missingSettings = (shops ?? []).some((shop) => !settingsByShop.has(shop.id));
      if (missingSettings) {
        return response(503, { message: 'One or more shops do not have initialized settings. Apply the reviewed shop settings package first.' });
      }
      return response(200, {
        shops: (shops ?? []).map((shop) => {
          const qr = qrSettingsByShop.get(shop.id);
          return {
            ...shop,
            operational_settings: settingsByShop.get(shop.id),
            receipt_qr_settings: {
              publicReceiptsEnabled: qr?.public_receipts_enabled ?? false,
              linkLifetimeDays: qr?.link_lifetime_days ?? 90,
              showMedicineNames: qr?.show_medicine_names ?? true,
              qrPlacement: qr?.qr_placement ?? 'footer',
              qrBaseUrl: qr?.qr_base_url ?? '',
            },
          };
        }),
      });
    }

    if (action === 'update_shop') {
      if (!canManagePlatformShops(callerRole)) {
        return response(403, { message: 'Only the platform Super Admin may manage shops.' });
      }
      const id = typeof payload.id === 'string' ? payload.id : '';
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      const phone = typeof payload.phone === 'string' ? payload.phone : '';
      const address = typeof payload.address === 'string' ? payload.address : '';
      const logoPath = typeof payload.logo_path === 'string' ? payload.logo_path : '';
      const status = typeof payload.status === 'string' ? payload.status : '';
      const adminLimit = Number(payload.admin_limit);
      const staffLimit = Number(payload.staff_limit);
      if (!validUuid(id) || !name || name.length > 120 || phone.length > 40 || address.length > 240
        || logoPath.length > 4096
        || !['active', 'suspended', 'deleted'].includes(status)
        || !Number.isInteger(adminLimit) || adminLimit < 1 || adminLimit > 50
        || !Number.isInteger(staffLimit) || staffLimit < 1 || staffLimit > 500) {
        return response(400, { message: 'Shop details are invalid.' });
      }
      const { error: updateError } = await adminClient.rpc('platform_manage_shop', {
        p_actor_id: authData.user.id,
        p_shop_id: id,
        p_name: name,
        p_phone: phone,
        p_address: address,
        p_logo_path: logoPath,
        p_status: status,
        p_admin_limit: adminLimit,
        p_staff_limit: staffLimit,
      });
      if (updateError) {
        const statusCode = updateError.code === 'P0001' ? 409
          : updateError.code === '42501' ? 403 : 400;
        return response(statusCode, { message: `Could not update shop: ${updateError.message}` });
      }
      return response(200, { message: 'Shop updated successfully.' });
    }

    if (action === 'update_shop_settings') {
      if (!canManagePlatformShops(callerRole)) {
        return response(403, { message: 'Only the platform Super Admin may update shop settings.' });
      }
      const shopId = typeof payload.id === 'string' ? payload.id : '';
      if (!validUuid(shopId)) return response(400, { message: 'A valid target shop id is required.' });
      const { error: settingsError } = await adminClient.rpc('platform_update_shop_settings', {
        p_actor_id: authData.user.id,
        p_shop_id: shopId,
        p_settings: payload.settings,
        p_receipt_qr_settings: payload.receipt_qr_settings,
      });
      if (settingsError) {
        const statusCode = settingsError.code === 'P0001' ? 409
          : settingsError.code === '42501' ? 403 : 400;
        return response(statusCode, { message: `Could not update shop settings: ${settingsError.message}` });
      }
      return response(200, { message: 'Shop settings updated successfully.' });
    }

    if (action === 'get_admin_note' || action === 'save_admin_note') {
      if (!canManagePlatformShops(callerRole)) {
        return response(403, { message: 'Only the platform Super Admin may access private Admin notes.' });
      }
      const adminId = typeof payload.admin_id === 'string' ? payload.admin_id : '';
      if (!validUuid(adminId)) return response(400, { message: 'A valid Admin profile id is required.' });
      const note = action === 'save_admin_note'
        ? typeof payload.note === 'string' ? payload.note : null
        : null;
      if (note === null && action === 'save_admin_note') {
        return response(400, { message: 'The private note must be text.' });
      }
      if (note !== null && note.length > 2000) {
        return response(400, { message: 'The private note must be 2000 characters or fewer.' });
      }
      const { data, error: noteError } = await adminClient.rpc('platform_admin_private_note', {
        p_actor_id: authData.user.id,
        p_admin_profile_id: adminId,
        p_note: note,
      });
      if (noteError) {
        const statusCode = noteError.code === 'P0001' ? 404
          : noteError.code === '42501' ? 403 : 400;
        return response(statusCode, { message: `Could not access private note: ${noteError.message}` });
      }
      return response(200, { note: data });
    }

    if (action === 'provision_shop') {
      if (!canManagePlatformShops(callerRole)) {
        return response(403, { message: 'Only the platform Super Admin may provision shops.' });
      }
      const operationId = typeof payload.operation_id === 'string' ? payload.operation_id : '';
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      const phone = typeof payload.phone === 'string' ? payload.phone : '';
      const address = typeof payload.address === 'string' ? payload.address : '';
      const adminFullName = typeof payload.admin_full_name === 'string' ? payload.admin_full_name.trim() : '';
      const adminUsername = typeof payload.admin_username === 'string' ? payload.admin_username.trim() : '';
      const adminEmail = typeof payload.admin_email === 'string' ? payload.admin_email.trim().toLowerCase() : '';
      const adminPassword = typeof payload.admin_password === 'string' ? payload.admin_password : '';
      if (!validPermissions(payload.admin_permissions)) {
        return response(400, { message: 'Admin permissions contain an invalid permission key.' });
      }
      const settingsGrantDenial = permissionGrantDenial('super_admin', [], payload.admin_permissions);
      if (settingsGrantDenial) return response(400, { message: settingsGrantDenial });
      const adminPermissions = normalizePermissions(payload.admin_permissions);
      if (!validUuid(operationId) || !name || name.length > 120 || phone.length > 40 || address.length > 240
        || !adminFullName || adminFullName.length > 120
        || !adminUsername || adminUsername.length > 80 || !validEmail(adminEmail)
        || adminPassword.length < 8 || !validPermissions(payload.admin_permissions)) {
        return response(400, { message: 'Shop and first Admin details are invalid.' });
      }
      const fingerprint = await sha256Hex(JSON.stringify({
        requested_by: authData.user.id,
        name,
        phone,
        address,
        admin_full_name: adminFullName,
        admin_username: adminUsername,
        admin_email: adminEmail,
        admin_permissions: adminPermissions,
      }));
      let { data: operation, error: operationError } = await adminClient
        .from('shop_provisioning_operations')
        .select('operation_id,requested_by,request_fingerprint,status,auth_user_id,shop_id,auth_email,attempt_count,updated_at')
        .eq('operation_id', operationId)
        .maybeSingle();
      if (operationError) throw operationError;
      if (!operation) {
        const { data: insertedOperation, error: insertOperationError } = await adminClient
          .from('shop_provisioning_operations')
          .insert({
            operation_id: operationId,
            requested_by: authData.user.id,
            request_fingerprint: fingerprint,
            auth_email: adminEmail,
            status: 'pending_auth',
          })
          .select('operation_id,requested_by,request_fingerprint,status,auth_user_id,shop_id,auth_email,attempt_count,updated_at')
          .single();
        if (insertOperationError?.code === '23505') {
          const retry = await adminClient
            .from('shop_provisioning_operations')
            .select('operation_id,requested_by,request_fingerprint,status,auth_user_id,shop_id,auth_email,attempt_count,updated_at')
            .eq('operation_id', operationId)
            .maybeSingle();
          if (retry.error) throw retry.error;
          operation = retry.data;
        } else if (insertOperationError) {
          throw insertOperationError;
        } else {
          operation = insertedOperation;
        }
      }
      if (!operation || operation.requested_by !== authData.user.id
        || operation.request_fingerprint !== fingerprint || operation.auth_email !== adminEmail) {
        return response(409, { message: 'This provisioning operation id is already bound to different request data.' });
      }
      if (operation.status === 'completed' && operation.shop_id) {
        if (operation.auth_user_id) {
          const { data: completedAuthUser, error: completedAuthLookupError } =
            await adminClient.auth.admin.getUserById(operation.auth_user_id);
          if (completedAuthLookupError) throw completedAuthLookupError;
          const {
            provisioning_operation_id: _completedOperationId,
            ...completedMetadata
          } = withoutLegacyPasswordChangeFlag(completedAuthUser.user.app_metadata);
          const { error: completedMetadataError } = await adminClient.auth.admin.updateUserById(
            operation.auth_user_id,
            { app_metadata: completedMetadata },
          );
          if (completedMetadataError) {
            return response(500, {
              message: `Shop exists, but Auth metadata cleanup needs owner review. Ref: ${operationId}`,
            });
          }
        }
        return response(200, { message: 'Shop and first Admin were already provisioned.', shop_id: operation.shop_id });
      }
      if (['compensated', 'failed'].includes(operation.status)) {
        return response(409, { message: 'This provisioning operation was already closed. Start a new operation.' });
      }
      if (operation.status === 'pending_auth' || operation.status === 'auth_creating') {
        const { data: duplicateUsername, error: usernameError } = await adminClient
          .from('profiles').select('id').ilike('username', adminUsername).limit(1);
        if (usernameError) throw usernameError;
        if (duplicateUsername?.length) {
          const { error: closeError } = await adminClient
            .from('shop_provisioning_operations')
            .update({
              status: 'failed',
              last_error_code: 'username_conflict',
              updated_at: new Date().toISOString(),
            })
            .eq('operation_id', operationId)
            .eq('status', operation.status);
          if (closeError) throw closeError;
          return response(409, { message: 'Username already taken.' });
        }
      }
      const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      if (['compensation_pending', 'compensation_failed', 'compensating'].includes(operation.status)) {
        let recoveryClaim = adminClient.from('shop_provisioning_operations')
          .update({
            status: 'compensating',
            attempt_count: (operation.attempt_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('operation_id', operationId)
          .eq('status', operation.status);
        if (operation.status === 'compensating') recoveryClaim = recoveryClaim.lt('updated_at', staleBefore);
        const { data: claimedRecovery, error: recoveryClaimError } = await recoveryClaim
          .select('auth_user_id')
          .maybeSingle();
        if (recoveryClaimError) throw recoveryClaimError;
        if (!claimedRecovery) {
          return response(409, { message: `Provisioning recovery is already in progress. Ref: ${operationId}` });
        }
        let recoveryUserId = claimedRecovery.auth_user_id;
        if (!recoveryUserId) {
          const recoveryUser = await findProvisioningAuthUser(adminClient, operationId);
          recoveryUserId = recoveryUser?.id ?? null;
        }
        const { error: recoveryDeleteError } = recoveryUserId
          ? await adminClient.auth.admin.deleteUser(recoveryUserId)
          : { error: null };
        const nextStatus = recoveryDeleteError ? 'compensation_failed' : 'compensated';
        const { error: recoveryUpdateError } = await adminClient
          .from('shop_provisioning_operations')
          .update({
            status: nextStatus,
            last_error_code: recoveryDeleteError ? 'auth_compensation_failed' : null,
            updated_at: new Date().toISOString(),
          })
          .eq('operation_id', operationId)
          .eq('status', 'compensating');
        if (recoveryUpdateError) throw recoveryUpdateError;
        if (recoveryDeleteError) {
          return response(500, { message: `Could not complete provisioning recovery. Operation: ${operationId}` });
        }
        return response(409, { message: `Provisioning compensation completed. Start a new operation. Ref: ${operationId}` });
      }

      let authUserId = operation.auth_user_id;
      if (operation.status === 'pending_auth' || operation.status === 'auth_creating') {
        let authClaim = adminClient.from('shop_provisioning_operations')
          .update({
            status: 'auth_creating',
            attempt_count: (operation.attempt_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('operation_id', operationId)
          .eq('status', operation.status);
        if (operation.status === 'auth_creating') authClaim = authClaim.lt('updated_at', staleBefore);
        const { data: claimedAuth, error: authClaimError } = await authClaim
          .select('attempt_count')
          .maybeSingle();
        if (authClaimError) throw authClaimError;
        if (!claimedAuth) {
          return response(409, { message: `Provisioning Auth setup is already in progress. Retry after 10 minutes. Ref: ${operationId}` });
        }
        const recoveredAuthUser = await findProvisioningAuthUser(adminClient, operationId);
        if (recoveredAuthUser && recoveredAuthUser.email?.toLowerCase() !== adminEmail) {
          return response(409, { message: `The recovered Auth account email does not match the operation. Ref: ${operationId}` });
        }
        if (recoveredAuthUser) {
          authUserId = recoveredAuthUser.id;
        } else {
          const { data: createdAuth, error: createAuthError } = await adminClient.auth.admin.createUser({
            email: adminEmail,
            password: adminPassword,
            email_confirm: true,
            app_metadata: { provisioning_operation_id: operationId },
          });
          if (createAuthError || !createdAuth.user) {
            const { error: failedOperationError } = await adminClient
              .from('shop_provisioning_operations')
              .update({
                status: 'failed',
                last_error_code: 'auth_create_failed',
                updated_at: new Date().toISOString(),
              })
              .eq('operation_id', operationId)
              .eq('status', 'auth_creating');
            if (failedOperationError) throw failedOperationError;
            return response(400, { message: createAuthError?.message ?? 'Could not create the first Admin Auth account.' });
          }
          authUserId = createdAuth.user.id;
        }
        const { data: recordedAuth, error: authRecordError } = await adminClient
          .from('shop_provisioning_operations')
          .update({
            auth_user_id: authUserId,
            status: 'auth_created',
            updated_at: new Date().toISOString(),
          })
          .eq('operation_id', operationId)
          .eq('status', 'auth_creating')
          .select('operation_id')
          .maybeSingle();
        if (authRecordError) throw authRecordError;
        if (!recordedAuth) {
          return response(409, { message: `Auth account recovery is required before finalization. Ref: ${operationId}` });
        }
        operation = { ...operation, status: 'auth_created', auth_user_id: authUserId };
      }

      if (operation.status !== 'auth_created' && operation.status !== 'finalizing') {
        return response(409, { message: `Provisioning cannot continue from status ${operation.status}. Ref: ${operationId}` });
      }
      if (!authUserId) {
        const recoveredAuthUser = await findProvisioningAuthUser(adminClient, operationId);
        if (!recoveredAuthUser || recoveredAuthUser.email?.toLowerCase() !== adminEmail) {
          return response(409, { message: `Provisioning has no matching Auth account. Ref: ${operationId}` });
        }
        authUserId = recoveredAuthUser.id;
        const { data: relinkedAuth, error: relinkError } = await adminClient
          .from('shop_provisioning_operations')
          .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
          .eq('operation_id', operationId)
          .eq('status', operation.status)
          .select('operation_id')
          .maybeSingle();
        if (relinkError) throw relinkError;
        if (!relinkedAuth) {
          return response(409, { message: `Provisioning status changed while relinking Auth. Ref: ${operationId}` });
        }
      }
      let finalizeClaim = adminClient.from('shop_provisioning_operations')
        .update({
          status: 'finalizing',
          attempt_count: (operation.attempt_count ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('operation_id', operationId)
        .eq('status', operation.status);
      if (operation.status === 'finalizing') finalizeClaim = finalizeClaim.lt('updated_at', staleBefore);
      const { data: claimedFinalization, error: finalizeClaimError } = await finalizeClaim
        .select('operation_id')
        .maybeSingle();
      if (finalizeClaimError) throw finalizeClaimError;
      if (!claimedFinalization) {
        return response(409, { message: `Shop finalization is already in progress. Retry after 10 minutes. Ref: ${operationId}` });
      }

      const { data: finalized, error: finalizeError } = await adminClient.rpc('finalize_shop_provisioning', {
        p_operation_id: operationId,
        p_actor_id: authData.user.id,
        p_auth_user_id: authUserId,
        p_request_fingerprint: fingerprint,
        p_shop_name: name,
        p_phone: phone,
        p_address: address,
        p_admin_full_name: adminFullName,
        p_admin_username: adminUsername,
        p_admin_email: adminEmail,
        p_admin_permissions: adminPermissions,
        p_admin_limit: 10,
        p_staff_limit: 100,
      });
      if (finalizeError) {
        const { data: pendingOperation, error: pendingError } = await adminClient
          .from('shop_provisioning_operations')
          .update({
            status: 'compensation_pending',
            last_error_code: finalizeError.code ?? 'finalize_failed',
            updated_at: new Date().toISOString(),
          })
          .eq('operation_id', operationId)
          .eq('status', 'finalizing')
          .select('operation_id')
          .maybeSingle();
        if (pendingError) throw pendingError;
        if (!pendingOperation) {
          const { data: latestOperation, error: latestError } = await adminClient
            .from('shop_provisioning_operations')
            .select('status,shop_id')
            .eq('operation_id', operationId)
            .maybeSingle();
          if (latestError) throw latestError;
          if (latestOperation?.status === 'completed' && latestOperation.shop_id) {
            const metadataError = await clearProvisioningMetadata(adminClient, authUserId);
            return metadataError
              ? response(500, { message: `Shop was provisioned, but Auth metadata cleanup needs owner review. Ref: ${operationId}. ${metadataError}` })
              : response(201, { message: 'Shop and first Admin provisioned.', shop_id: latestOperation.shop_id });
          }
          return response(409, { message: `Provisioning status changed during finalization. Ref: ${operationId}` });
        }
        const { data: recoveryClaim, error: recoveryClaimError } = await adminClient
          .from('shop_provisioning_operations')
          .update({
            status: 'compensating',
            attempt_count: (operation.attempt_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('operation_id', operationId)
          .eq('status', 'compensation_pending')
          .select('operation_id')
          .maybeSingle();
        if (recoveryClaimError) throw recoveryClaimError;
        if (!recoveryClaim) {
          return response(409, { message: `Provisioning compensation is already in progress. Ref: ${operationId}` });
        }
        const { error: authCompensationError } = await adminClient.auth.admin.deleteUser(authUserId);
        const { error: compensationRecordError } = await adminClient
          .from('shop_provisioning_operations')
          .update({
            status: authCompensationError ? 'compensation_failed' : 'compensated',
            last_error_code: authCompensationError ? 'auth_compensation_failed' : 'finalize_failed',
            updated_at: new Date().toISOString(),
          })
          .eq('operation_id', operationId)
          .eq('status', 'compensating');
        if (compensationRecordError) throw compensationRecordError;
        return response(500, {
          message: authCompensationError
            ? `Shop finalization failed and Auth cleanup also failed. Owner recovery is required. Ref: ${operationId}`
            : `Shop finalization failed; Auth cleanup completed. Start a new operation. Ref: ${operationId}`,
        });
      }

      const metadataError = await clearProvisioningMetadata(adminClient, authUserId);
      if (metadataError) {
        console.error('Provisioning completed but temporary Auth operation metadata cleanup failed.', metadataError);
        return response(500, {
          message: `Shop was provisioned, but Auth metadata cleanup needs owner review. Ref: ${operationId}. ${metadataError}`,
        });
      }
      return response(201, {
        message: 'Shop and first Admin provisioned. The Admin can sign in using the password set during creation.',
        shop_id: (finalized as { shop_id?: string } | null)?.shop_id ?? null,
      });
    }

    if (action === 'permanently_delete') {
      if (callerRole !== 'admin' && callerRole !== 'super_admin') {
        return response(403, { message: 'Only admin or super_admin may permanently delete Trash Bin items.' });
      }
      const eventId = typeof payload.event_id === 'string' ? payload.event_id : '';
      if (!eventId) return response(400, { message: 'Trash Bin event id is required.' });

      const { data: trashEvent, error: eventError } = await adminClient
        .from('trash_bin_events')
        .select('id,entity_id,entity_type,action,display_name,created_at')
        .eq('id', eventId)
        .maybeSingle();
      if (eventError) throw eventError;
      if (!trashEvent || trashEvent.entity_type !== 'profile' || trashEvent.action !== 'deleted') {
        return response(404, { message: 'Deleted user Trash Bin item not found.' });
      }

      const { data: latestEvent, error: latestError } = await adminClient
        .from('trash_bin_events')
        .select('id')
        .eq('entity_type', 'profile')
        .eq('entity_id', trashEvent.entity_id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw latestError;
      if (latestEvent?.id !== trashEvent.id) {
        return response(409, { message: 'This Trash Bin item is no longer the latest event and cannot be permanently deleted.' });
      }

      const { data: target, error: targetError } = await adminClient
        .from('profiles')
        .select('id,full_name,username,email,role,permissions,deleted_at,created_by,shop_id')
        .eq('id', trashEvent.entity_id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (target) {
        if (target.deleted_at === null || !validRole(target.role)) {
          return response(404, { message: 'The deleted user profile is no longer available.' });
        }
        if (!targetInScope(target) || target.id === authData.user.id || !canManageTarget(
          callerRole,
          authData.user.id,
          target.id,
          target.role,
          target.permissions ?? [],
          callerPermissions,
          target.created_by,
        )) {
          return response(403, { message: 'You are not allowed to permanently delete this user.' });
        }

        const { error: deleteError } = await adminClient.auth.admin.deleteUser(target.id);
        if (deleteError) {
          return response(409, {
            message: `Could not permanently delete ${trashEvent.display_name}: ${deleteError.message}`,
          });
        }
      } else if (callerRole !== 'super_admin') {
        return response(403, { message: 'Only super_admin may clean up an already deleted user record.' });
      }

      const { error: cleanupError } = await adminClient.rpc('trash_bin_finalize_profile_purge', {
        p_event_id: trashEvent.id,
        p_target_id: trashEvent.entity_id,
        p_actor_id: authData.user.id,
      });
      if (cleanupError) {
        return response(500, {
          message: `The account was deleted, but its Trash Bin history could not be cleaned up: ${cleanupError.message}`,
        });
      }

      return response(200, { message: `${trashEvent.display_name} permanently deleted.` });
    }

    if (action === 'get_team') {
      if (typeof payload.admin_id !== 'string') {
        return response(400, { message: 'Admin id is required.' });
      }
      const { data: targetAdmin, error: targetAdminError } = await adminClient
        .from('profiles')
        .select('id,role,shop_id')
        .eq('id', payload.admin_id)
        .maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (!targetAdmin || !validRole(targetAdmin.role) || targetAdmin.shop_id === null
        || !canViewAdminTeam(callerRole, targetAdmin.role)) {
        return response(404, { message: 'Admin team not found.' });
      }
      const { data: teamProfiles, error: teamError } = await adminClient
        .from('profiles')
        .select('id,username,role,is_active,deleted_at,created_at')
        .eq('created_by', targetAdmin.id)
        .eq('shop_id', targetAdmin.shop_id)
        .order('created_at', { ascending: true });
      if (teamError) throw teamError;
      const { data: authUsers, error: authUsersError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (authUsersError) throw authUsersError;
      const authMetadataById = new Map(authUsers.users.map((user) => [user.id, {
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      }]));
      return response(200, {
        team_count: teamProfiles?.length ?? 0,
        team_limit: null,
        team_members: (teamProfiles ?? []).map((profile) => ({
          member_id: profile.id,
          ...publicTeamMember(profile, authMetadataById.get(profile.id)),
        })),
      });
    }

    if (action === 'list') {
      const usersQuery = adminClient
        .from('profiles')
        .select('id,full_name,username,email,role,is_active,permissions,created_by,shop_id')
        .is('deleted_at', null);
      const { data: users, error } = callerShopId === null
        ? await usersQuery
        : await usersQuery.eq('shop_id', callerShopId);
      if (error) throw error;
      const countQuery = adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true });
      const { count: globalCount, error: countError } = callerShopId === null
        ? await countQuery
        : await countQuery.eq('shop_id', callerShopId);
      if (countError) throw countError;
      const { data: authUsers, error: authUsersError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (authUsersError) throw authUsersError;
      const creationOrder = new Map(authUsers.users.map((user) => [user.id, user.created_at]));
      const authEmailById = new Map(authUsers.users.map((user) => [user.id, user.email]));
      const authMetadataById = new Map(authUsers.users.map((user) => [user.id, {
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      }]));
      let usernameById = new Map((users ?? []).map((user) => [
        user.id,
        String(user.username ?? user.email?.split('@')[0] ?? 'Unknown'),
      ]));
      if (isSuperAdmin) {
        const { data: allProfiles, error: allProfilesError } = await adminClient
          .from('profiles')
          .select('id,username,email');
        if (allProfilesError) throw allProfilesError;
        usernameById = new Map((allProfiles ?? []).map((profile) => [
          profile.id,
          String(profile.username ?? profile.email?.split('@')[0] ?? 'Unknown'),
        ]));
      }
      const visibleUsers = (users ?? []).filter((user) =>
        (isSuperAdmin || user.role !== 'super_admin')
        && targetInScope(user)
        && canViewManagedUser(callerRole, authData.user.id, user.id, user.created_by)
      );
      const orderedUsers = visibleUsers
        .map((user) => {
          const { created_by: createdBy, ...profile } = user;
          const safeUser = safeProfile(profile, authEmailById.get(user.id));
          if (isSuperAdmin) safeUser.shop_id = user.shop_id;
          return isSuperAdmin
            ? {
              ...safeUser,
              created_by_username: createdBy ? usernameById.get(createdBy) ?? 'Unassigned' : 'Unassigned',
            }
            : safeUser;
        })
        .sort((left, right) =>
          (creationOrder.get(left.id) ?? '').localeCompare(creationOrder.get(right.id) ?? '')
        )
        .map((user) => ({
          ...user,
          can_manage: canManageTarget(
            callerRole,
            authData.user.id,
            user.id,
            user.role,
            user.permissions,
            callerPermissions,
            (users ?? []).find((profile) => profile.id === user.id)?.created_by ?? null,
          ),
          can_edit: canEditManagedUser(callerRole, user.role, user.id === authData.user.id),
        }));
      let teamCount = 0;
      let teamMembers: ReturnType<typeof publicTeamMember>[] = [];
      if (callerRole === 'admin') {
        const { data: teamProfiles, error: teamError } = await adminClient
          .from('profiles')
          .select('id,username,role,is_active,deleted_at,created_at')
          .eq('created_by', authData.user.id)
          .eq('shop_id', callerShopId)
          .order('created_at', { ascending: true });
        if (teamError) throw teamError;
        teamCount = (teamProfiles ?? []).length;
        teamMembers = (teamProfiles ?? []).map((profile) => publicTeamMember(
          profile,
          authMetadataById.get(profile.id),
        ));
      }
      let shops: { id: string; name: string; status: string }[] = [];
      if (isSuperAdmin) {
        const { data: shopRows, error: shopsError } = await adminClient
          .from('shops')
          .select('id,name,status')
          .order('name', { ascending: true });
        if (shopsError) throw shopsError;
        shops = shopRows ?? [];
      }
      return response(200, {
        api_version: 6,
        users: orderedUsers,
        currentCount: globalCount ?? 0,
        team_count: teamCount,
        team_members: teamMembers,
        shops,
        assignable_roles: assignableRolesFor(callerRole, callerPermissions),
        grantable_permissions: grantablePermissionsFor(callerRole, callerPermissions, PERMISSION_KEYS),
      });
    }

    if (action === 'list_deleted') {
      if (callerRole !== 'admin' && callerRole !== 'super_admin') {
        return response(403, { message: 'Only admin or super_admin may access deleted users.' });
      }
      const { data: users, error } = await adminClient
        .from('profiles')
        .select('id,full_name,username,email,role,is_active,permissions,deleted_at,created_by,shop_id')
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
          .filter((user) =>
            (isSuperAdmin || user.role !== 'super_admin')
            && targetInScope(user)
            && canViewManagedUser(callerRole, authData.user.id, user.id, user.created_by)
          )
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
        .select('id,role,permissions,deleted_at,created_by,shop_id')
        .eq('id', id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || !targetInScope(target) || !validRole(target.role) || !canManageTarget(
        callerRole,
        authData.user.id,
        id,
        target.role,
        target.permissions ?? [],
        callerPermissions,
        target.created_by,
      )) {
        return response(404, { message: 'User not found.' });
      }
      if (!canEditManagedUser(callerRole, target.role, target.id === authData.user.id)) {
        return response(404, { message: 'User not found.' });
      }
      if (target.deleted_at !== null) return response(400, { message: 'Restore this user before changing its password.' });

      const { error: passwordError } = await adminClient.auth.admin.updateUserById(id, { password });
      if (passwordError) return response(400, { message: `Could not reset password: ${passwordError.message}` });
      await writeAuditLog(adminClient, authData.user.id, 'reset_password', id, {
        role: target.role,
        permissions: target.permissions,
      }, {
        role: target.role,
        permissions: target.permissions,
      });
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
      if (!validRole(role)) return response(400, { message: 'Role is invalid.' });
      if (!canAssignRole(callerRole, role, callerPermissions)) {
        return response(403, { message: 'You are not allowed to assign this role.' });
      }
      let targetShopId = callerShopId;
      if (role === 'admin') {
        const requestedShopId = typeof payload.shop_id === 'string' ? payload.shop_id : '';
        if (callerRole !== 'super_admin' || !requestedShopId) {
          return response(400, { message: 'Select an active shop for this Admin account.' });
        }
        const { data: shop, error: shopError } = await adminClient
          .from('shops')
          .select('id')
          .eq('id', requestedShopId)
          .eq('status', 'active')
          .maybeSingle();
        if (shopError) throw shopError;
        if (!shop) return response(400, { message: 'The selected shop is not active.' });
        targetShopId = shop.id;
      } else if (role !== 'super_admin' && (callerRole !== 'admin' || callerShopId === null)) {
        return response(403, { message: 'Only a Shop Admin may create staff accounts.' });
      } else if (role !== 'super_admin' && payload.shop_id !== undefined) {
        return response(400, { message: 'Shop assignment is managed by the server.' });
      }
      if (!validPermissions(payload.permissions)) return response(400, { message: 'Permissions contain an invalid permission key.' });
      if (role !== 'admin' && payload.permissions.some((permission) =>
        SETTINGS_SECTION_PERMISSION_KEYS.includes(permission as typeof SETTINGS_SECTION_PERMISSION_KEYS[number])
      )) {
        return response(400, { message: 'Settings section grants can only be assigned to Admin accounts.' });
      }
      const permissionDenial = permissionGrantDenial(callerRole, callerPermissions, payload.permissions);
      if (permissionDenial) return response(403, { message: permissionDenial });
      const normalizedPermissions = normalizePermissions(payload.permissions);
      if (payload.is_active !== undefined && typeof payload.is_active !== 'boolean') {
        return response(400, { message: 'Active status must be true or false.' });
      }
      if (payload.is_active === false && callerRole !== 'super_admin') {
        return response(403, { message: 'Only super_admin may create an inactive account.' });
      }

      const { data: currentUsers, error: usersError } = await adminClient
        .from('profiles')
        .select('username,email');
      if (usersError) throw usersError;
      if (role !== 'super_admin' && targetShopId) {
        const { data: shopLimits, error: shopLimitsError } = await adminClient
          .from('shops')
          .select('status,admin_limit,staff_limit')
          .eq('id', targetShopId)
          .maybeSingle();
        if (shopLimitsError) throw shopLimitsError;
        if (!shopLimits || shopLimits.status !== 'active') {
          return response(409, { message: 'The selected shop is not active.' });
        }
        let roleCountQuery = adminClient
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', targetShopId);
        roleCountQuery = role === 'admin'
          ? roleCountQuery.eq('role', 'admin')
          : roleCountQuery.in('role', ['manager', 'cashier', 'accountant']);
        const { count: roleCount, error: roleCountError } = await roleCountQuery;
        if (roleCountError) throw roleCountError;
        const roleLimitReached = isShopRoleLimitReached(
          role,
          role === 'admin' ? roleCount ?? 0 : 0,
          role === 'admin' ? 0 : roleCount ?? 0,
          shopLimits.admin_limit,
          shopLimits.staff_limit,
        );
        if (roleLimitReached) {
          return response(409, {
            message: role === 'admin'
              ? 'The shop Admin limit has been reached.'
              : 'The shop staff limit has been reached.',
          });
        }
      }
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
      const permissions = role === 'super_admin' ? [] : normalizedPermissions;
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
        created_by: authData.user.id,
        shop_id: role === 'super_admin' ? null : targetShopId,
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
      await writeAuditLog(adminClient, authData.user.id, 'create', createdAuth.user.id, null, {
        role,
        permissions,
        is_active: payload.is_active !== false,
        full_name: fullName,
        username,
        email,
        shop_id: targetShopId,
      });
      return response(201, { message: 'User created successfully.', id: createdAuth.user.id });
    }

    if (action === 'update' || action === 'delete' || action === 'restore' || action === 'set_status') {
      const id = typeof payload.id === 'string' ? payload.id : '';
      if (!id) return response(400, { message: 'User id is required.' });
      if (action === 'set_status' && callerRole !== 'super_admin') {
        return response(403, { message: 'Only super_admin may change account status or remove user access.' });
      }
      if (action === 'set_status' && !['deactivate', 'reactivate', 'remove_access'].includes(String(payload.status))) {
        return response(400, { message: 'A valid account status action is required.' });
      }
      const { data: target, error: targetError } = await adminClient
        .from('profiles')
        .select('id,full_name,username,email,role,is_active,permissions,deleted_at,created_by,shop_id')
        .eq('id', id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target || !targetInScope(target) || !validRole(target.role)) {
        return response(404, { message: 'User not found.' });
      }
      const adminCountQuery = adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('is_active', true)
        .is('deleted_at', null);
      const { count: activeAdminCount, error: adminCountError } = target.shop_id === null
        ? await adminCountQuery
        : await adminCountQuery.eq('shop_id', target.shop_id);
      if (adminCountError) throw adminCountError;
      const { count: activeSuperAdminCount, error: superAdminCountError } = await adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .eq('is_active', true)
        .is('deleted_at', null);
      if (superAdminCountError) throw superAdminCountError;
      const { count: superAdminCount, error: allSuperAdminCountError } = await adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .is('deleted_at', null);
      if (allSuperAdminCountError) throw allSuperAdminCountError;

      if (action === 'set_status' && payload.status !== 'remove_access') {
        const statusAction = payload.status as 'deactivate' | 'reactivate';
        if (target.deleted_at !== null) {
          return response(400, { message: 'Restore this user before changing account status.' });
        }
        const nextActive = statusAction === 'reactivate';
        if (target.is_active === nextActive) {
          return response(409, { message: nextActive ? 'User is already active.' : 'User is already deactivated.' });
        }
        const denial = profileChangeDenial({
          action: 'update',
          callerRole,
          callerId: authData.user.id,
          targetId: id,
          targetRole: target.role,
          targetCreatedBy: target.created_by,
          nextRole: target.role,
          targetPermissions: target.role === 'super_admin' ? [] : target.permissions ?? [],
          nextPermissions: target.role === 'super_admin' ? [] : target.permissions ?? [],
          targetActive: target.is_active === true,
          nextActive,
          activeAdminCount: activeAdminCount ?? 0,
          superAdminCount: superAdminCount ?? 0,
          activeSuperAdminCount: activeSuperAdminCount ?? 0,
          callerPermissions,
        });
        if (denial) return response(403, { message: denial });

        const { error: authStatusError } = await adminClient.auth.admin.updateUserById(id, {
          ban_duration: nextActive ? 'none' : '876000h',
        });
        if (authStatusError) {
          return response(500, { message: `Could not ${nextActive ? 'reactivate' : 'deactivate'} the account: ${authStatusError.message}` });
        }
        const { error: statusError } = await adminClient.rpc('manage_users_team_member_access', {
          p_actor_id: authData.user.id,
          p_target_id: id,
          p_action: statusAction,
        });
        if (statusError) {
          const authRollbackError = await restoreAuthStatusFromProfile(adminClient, id);
          if (authRollbackError) {
            return response(500, {
              message: `Could not update profile status: ${statusError.message}. ${authRollbackError}`,
            });
          }
          return response(statusError.code === 'P0001' ? 409 : 500, {
            message: `Could not update profile status: ${statusError.message}`,
          });
        }
        return response(200, {
          message: nextActive ? 'User reactivated successfully.' : 'User deactivated successfully.',
        });
      }

      if (action === 'delete' || (action === 'set_status' && payload.status === 'remove_access')) {
        if (target.deleted_at !== null) return response(404, { message: 'User is already deleted.' });
        const denial = profileChangeDenial({
          action: 'delete',
          callerRole,
          callerId: authData.user.id,
          targetId: id,
          targetRole: target.role,
          targetCreatedBy: target.created_by,
          targetPermissions: target.permissions ?? [],
          targetActive: target.is_active === true,
          activeAdminCount: activeAdminCount ?? 0,
          superAdminCount: superAdminCount ?? 0,
          activeSuperAdminCount: activeSuperAdminCount ?? 0,
        });
        if (denial) return response(403, { message: denial });
        const { error: banError } = await adminClient.auth.admin.updateUserById(id, { ban_duration: '876000h' });
        if (banError) {
          return response(500, { message: `Could not disable the account: ${banError.message}` });
        }
        const { error: removalError } = await adminClient.rpc('manage_users_team_member_access', {
          p_actor_id: authData.user.id,
          p_target_id: id,
          p_action: 'remove_access',
        });
        if (removalError) {
          const authRollbackError = await restoreAuthStatusFromProfile(adminClient, id);
          if (authRollbackError) {
            return response(500, {
              message: `Could not remove user access: ${removalError.message}. ${authRollbackError}`,
            });
          }
          return response(removalError.code === 'P0001' ? 409 : 500, {
            message: `Could not remove user access: ${removalError.message}`,
          });
        }
        return response(200, { message: 'User access removed and profile moved to Trash Bin.' });
      }

      if (action === 'restore') {
        if (callerRole !== 'super_admin') {
          return response(403, { message: 'Only super_admin may restore users.' });
        }
        if (!canManageTarget(
          callerRole,
          authData.user.id,
          id,
          target.role,
          target.permissions ?? [],
          callerPermissions,
          target.created_by,
        )) {
          return response(403, { message: 'You are not allowed to manage this user.' });
        }
        if (target.deleted_at === null) return response(400, { message: 'User is not deleted.' });
        const { error: updateError } = await adminClient.from('profiles')
          .update({ deleted_at: null, is_active: true })
          .eq('id', id);
        if (updateError) throw updateError;
        const { error: unbanError } = await adminClient.auth.admin.updateUserById(id, { ban_duration: 'none' });
        if (unbanError) {
          await adminClient.from('profiles').update({ deleted_at: target.deleted_at, is_active: false }).eq('id', id);
          return response(500, { message: `Could not restore the account: ${unbanError.message}` });
        }
        const displayName = target.full_name || target.username || target.email || 'Unknown user';
        try {
          await writeTrashEvent(adminClient, authData.user.id, id, 'restored', displayName, {
            role: target.role,
          });
        } catch (historyError) {
          const { error: profileDeleteError } = await adminClient.from('profiles')
            .update({ deleted_at: target.deleted_at, is_active: false })
            .eq('id', id);
          const { error: rebanError } = await adminClient.auth.admin.updateUserById(id, { ban_duration: '876000h' });
          if (profileDeleteError || rebanError) {
            throw new Error(
              `Trash Bin history failed and rollback was incomplete. ${profileDeleteError?.message ?? ''} ${rebanError?.message ?? ''}`.trim(),
            );
          }
          throw historyError;
        }
        await writeAuditLog(adminClient, authData.user.id, 'restore', id, {
          role: target.role,
          permissions: target.permissions,
          is_active: false,
          deleted_at: target.deleted_at,
        }, {
          role: target.role,
          permissions: target.permissions,
          is_active: true,
          deleted_at: null,
        });
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
      if (!canManageTarget(
        callerRole,
        authData.user.id,
        id,
        target.role,
        target.permissions ?? [],
        callerPermissions,
        target.created_by,
      )) {
        return response(403, { message: 'You are not allowed to manage this user.' });
      }
      if (!canEditManagedUser(callerRole, target.role, target.id === authData.user.id)) {
        return response(403, { message: 'Super Admins may edit Admin accounts; use the Admin team controls for staff access.' });
      }
      if (!validPermissions(payload.permissions)) return response(400, { message: 'Permissions contain an invalid permission key.' });
      if (role !== 'admin' && payload.permissions.some((permission) =>
        SETTINGS_SECTION_PERMISSION_KEYS.includes(permission as typeof SETTINGS_SECTION_PERMISSION_KEYS[number])
      )) {
        return response(400, { message: 'Settings section grants can only be assigned to Admin accounts.' });
      }
      const permissionDenial = permissionGrantDenial(
        callerRole,
        callerPermissions,
        payload.permissions,
        target.permissions ?? [],
      );
      if (permissionDenial) return response(403, { message: permissionDenial });
      const normalizedPermissions = normalizePermissions(payload.permissions);
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
      if (nextActive !== (target.is_active === true)) {
        return response(400, { message: 'Use the dedicated account status action to deactivate or reactivate users.' });
      }
      const denial = profileChangeDenial({
        action: 'update',
        callerRole,
        callerId: authData.user.id,
        targetId: id,
        targetRole: target.role,
        targetCreatedBy: target.created_by,
        nextRole,
        targetPermissions: target.role === 'super_admin' ? [] : target.permissions ?? [],
        nextPermissions: nextRole === 'super_admin' ? [] : normalizedPermissions,
        targetActive: target.is_active === true,
        nextActive,
        activeAdminCount: activeAdminCount ?? 0,
        superAdminCount: superAdminCount ?? 0,
        activeSuperAdminCount: activeSuperAdminCount ?? 0,
        callerPermissions,
      });
      if (denial) return response(403, { message: denial });
      const permissions = nextRole === 'super_admin' ? [] : normalizedPermissions;
      let nextShopId = target.shop_id;
      if (callerRole === 'super_admin' && nextRole === 'admin') {
        const requestedShopId = typeof payload.shop_id === 'string' ? payload.shop_id : '';
        if (!requestedShopId) return response(400, { message: 'Select an active shop for this Admin account.' });
        const { data: shop, error: shopError } = await adminClient
          .from('shops')
          .select('id')
          .eq('id', requestedShopId)
          .eq('status', 'active')
          .maybeSingle();
        if (shopError) throw shopError;
        if (!shop) return response(400, { message: 'The selected shop is not active.' });
        nextShopId = shop.id;
        if (target.role === 'admin' && target.is_active === true
          && target.shop_id !== nextShopId && (activeAdminCount ?? 0) <= 1) {
          return response(409, { message: 'Cannot move the last active Admin out of a shop.' });
        }
      } else if (payload.shop_id !== undefined) {
        return response(400, { message: 'Shop assignment is managed by the platform Super Admin.' });
      }
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
      const { error: profileUpdateError } = await adminClient.rpc('manage_users_profile_update', {
        p_actor_id: authData.user.id,
        p_target_id: id,
        p_full_name: fullName,
        p_username: username,
        p_email: email,
        p_role: nextRole,
        p_permissions: permissions,
        p_is_active: nextActive,
        p_shop_id: nextRole === 'super_admin' ? null : nextShopId,
      });
      if (profileUpdateError) {
        if (authChanges.email || authChanges.ban_duration) {
          const rollback: { email?: string; ban_duration?: string } = {};
          if (authChanges.email) rollback.email = target.email;
          if (authChanges.ban_duration) rollback.ban_duration = target.is_active ? 'none' : '876000h';
          const { error: rollbackError } = await adminClient.auth.admin.updateUserById(id, rollback);
          if (rollbackError) {
            return response(500, {
              message: `Could not update profile: ${profileUpdateError.message}. Auth rollback also failed: ${rollbackError.message}`,
            });
          }
        }
        const statusCode = profileUpdateError.code === 'P0001' || profileUpdateError.code === '23505'
          ? 409
          : profileUpdateError.code === '42501'
            ? 403
            : 400;
        return response(statusCode, { message: `Could not update profile: ${profileUpdateError.message}` });
      }
      return response(200, { message: 'User updated successfully.' });
    }

    return response(400, { message: 'Unknown action. Use list, create, update, delete, list_deleted, or restore.' });
  } catch (error) {
    console.error('manage-users request failed:', messageOf(error));
    return response(500, { message: messageOf(error) });
  }
});
