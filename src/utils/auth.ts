import { UserRole } from '../types/pharmacy';
import { isPermissionKey } from '../permissions';
import { supabase } from './supabase';

export interface AuthSession {
  userId: string;
  displayName: string;
  email: string;
  role: UserRole;
  permissions: string[];
  accountNotice: string | null;
  shopProfile: { name: string; phone: string; address: string; logoPath: string } | null;
}

const legacyPasswordCleanupStatus = new Map<string, string | null>();
const legacyPasswordCleanupWarning =
  'Old password setup metadata could not be cleared. You can continue using the app; contact your administrator if this warning persists.';

export async function loadAuthSession(userId: string, authEmail?: string): Promise<AuthSession> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase
    .from('profiles')
    .select('username,email,role,permissions,is_active,deleted_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    const profileError = new Error(`Could not load your profile: ${error.message}`);
    profileError.name = 'ProfileLoadError';
    throw profileError;
  }
  if (!data) throw new Error('No profile exists for this account. Contact the admin.');
  if (data.is_active !== true || data.deleted_at !== null) {
    await supabase.auth.signOut();
    throw new Error('Your account is disabled. Contact the admin.');
  }
  if (!Object.values(UserRole).includes(data.role as UserRole)) {
    throw new Error('Your profile has an invalid role. Contact the admin.');
  }
  const { data: authUserData, error: authUserError } = await supabase.auth.getUser();
  if (authUserError) throw authUserError;
  if (!authUserData.user || authUserData.user.id !== userId) {
    throw new Error('Your session is no longer valid. Sign in again.');
  }
  let accountNotice: string | null = null;
  if (authUserData.user.app_metadata?.must_change_password === true) {
    if (legacyPasswordCleanupStatus.has(userId)) {
      accountNotice = legacyPasswordCleanupStatus.get(userId) ?? null;
    } else {
      try {
        const { error: cleanupError } = await supabase.functions.invoke('manage-users', {
          body: { action: 'clear_legacy_password_change' },
        });
        if (cleanupError) throw cleanupError;
        legacyPasswordCleanupStatus.set(userId, null);
      } catch (cleanupError) {
        console.error('Could not clear obsolete password setup metadata:', cleanupError);
        accountNotice = legacyPasswordCleanupWarning;
        legacyPasswordCleanupStatus.set(userId, accountNotice);
      }
    }
  }
  const { data: shopAccess, error: shopAccessError } = await supabase.rpc('current_shop_access');
  if (shopAccessError) throw new Error(`Could not verify shop access: ${shopAccessError.message}`);
  const access = typeof shopAccess === 'object' && shopAccess !== null
    ? shopAccess as { locked?: unknown }
    : {};
  if (access.locked === true) {
    await supabase.auth.signOut();
    throw new Error('This shop is no longer accessible. Contact the platform administrator.');
  }
  let shopProfile: AuthSession['shopProfile'] = null;
  if (data.role !== UserRole.SUPER_ADMIN) {
    const { data: profileData, error: profileRpcError } = await supabase.rpc('current_shop_profile');
    if (profileRpcError) throw new Error(`Could not load shop identity: ${profileRpcError.message}`);
    if (typeof profileData === 'object' && profileData !== null) {
      const profile = profileData as Record<string, unknown>;
      shopProfile = {
        name: typeof profile.name === 'string' ? profile.name : '',
        phone: typeof profile.phone === 'string' ? profile.phone : '',
        address: typeof profile.address === 'string' ? profile.address : '',
        logoPath: typeof profile.logo_path === 'string' ? profile.logo_path : '',
      };
    }
    if (!shopProfile) throw new Error('Your shop identity could not be resolved.');
  }

  return {
    userId,
    displayName: data.username || data.email || authEmail || 'User',
    email: data.email || authEmail || '',
    role: data.role as UserRole,
    permissions: Array.isArray(data.permissions) ? data.permissions.filter(isPermissionKey) : [],
    accountNotice,
    shopProfile,
  };
}
