import { UserRole } from '../types/pharmacy';
import { isModuleKey } from '../permissions';
import { supabase } from './supabase';

export interface AuthSession {
  userId: string;
  displayName: string;
  email: string;
  role: UserRole;
  permissions: string[];
}

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

  return {
    userId,
    displayName: data.username || data.email || authEmail || 'User',
    email: data.email || authEmail || '',
    role: data.role as UserRole,
    permissions: Array.isArray(data.permissions) ? data.permissions.filter(isModuleKey) : [],
  };
}
