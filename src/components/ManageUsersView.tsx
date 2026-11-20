import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ROLE_LABELS, UserRole } from '../types/pharmacy';
import {
  MODULES,
  hasPosPrintToggles,
  PermissionKey,
  SETTINGS_SECTION_PERMISSIONS,
  setModulePermission,
  setPosPrintPermission,
  setSettingsSectionPermission,
} from '../permissions';
import { supabase } from '../utils/supabase';

interface ShopOption {
  id: string;
  name: string;
  status: string;
}

interface TeamMember {
  username: string;
  role: string;
  status: 'active' | 'deactivated' | 'removed';
  created_at: string;
  last_sign_in_at: string | null;
}

interface AdminTeamMember extends TeamMember {
  member_id: string;
}

interface ManagedUser {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  role: UserRole | null;
  is_active: boolean | null;
  permissions: PermissionKey[] | null;
  shop_id?: string | null;
  can_manage: boolean;
  can_edit?: boolean;
  created_by_username?: string;
}

interface UserForm {
  full_name: string;
  username: string;
  email: string;
  password: string;
  role: UserRole;
  permissions: PermissionKey[];
  is_active: boolean;
  shop_id: string;
}

const EMPTY_FORM: UserForm = {
  full_name: '',
  username: '',
  email: '',
  password: '',
  role: UserRole.CASHIER,
  permissions: [],
  is_active: true,
  shop_id: '',
};

export async function invokeManageUsers<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke('manage-users', { body });
  if (error) {
    const context = 'context' in error ? error.context : undefined;
    if (context instanceof Response) {
      const responseBody: unknown = await context.json().catch(() => null);
      if (typeof responseBody === 'object' && responseBody !== null && 'message' in responseBody) {
        throw new Error(String(responseBody.message));
      }
    }
    throw new Error(error.message);
  }
  return data as T;
}

function roleClass(role: UserRole) {
  switch (role) {
    case UserRole.CASHIER: return 'bg-blue-100 text-blue-800';
    case UserRole.MANAGER: return 'bg-orange-100 text-orange-800';
    case UserRole.ACCOUNTANT: return 'bg-teal-100 text-teal-800';
    case UserRole.ADMIN: return 'bg-purple-100 text-purple-800';
    case UserRole.SUPER_ADMIN: return 'bg-red-100 text-red-800';
  }
}

function formatTeamTimestamp(value: string | null) {
  if (!value) return 'Never';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Unknown' : timestamp.toLocaleString();
}

export function ManageUsersView({
  currentUserId,
  currentRole,
}: {
  currentUserId: string;
  currentRole: UserRole;
}) {
  const isSuperAdmin = currentRole === UserRole.SUPER_ADMIN;
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [adminTeamMembers, setAdminTeamMembers] = useState<AdminTeamMember[]>([]);
  const [adminTeamCount, setAdminTeamCount] = useState(0);
  const [adminTeamLoading, setAdminTeamLoading] = useState(false);
  const [adminPrivateNote, setAdminPrivateNote] = useState('');
  const [privateNoteSaving, setPrivateNoteSaving] = useState(false);
  const [currentCount, setCurrentCount] = useState(0);
  const [assignableRoles, setAssignableRoles] = useState<UserRole[]>([]);
  const [grantablePermissions, setGrantablePermissions] = useState<PermissionKey[]>([]);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serviceReady, setServiceReady] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const teamRequestVersion = useRef(0);
  const visibleUsers = users.filter((user) => user.id !== currentUserId);

  const refresh = useCallback(async () => {
    setLoading(true);
    setServiceReady(false);
    try {
      const result = await invokeManageUsers<{
        api_version?: number;
        users?: ManagedUser[];
        currentCount?: number;
        assignable_roles?: UserRole[];
        grantable_permissions?: PermissionKey[];
        shops?: ShopOption[];
      } | null>(
        { action: 'list' }
      );
      const hasRoleData = result?.api_version === 6
        && Array.isArray(result?.users)
        && Array.isArray(result?.assignable_roles)
        && Array.isArray(result?.grantable_permissions)
        && typeof result?.currentCount === 'number';
      if (!hasRoleData) {
        setUsers([]);
        setCurrentCount(0);
        setAssignableRoles([]);
        setGrantablePermissions([]);
        setShops([]);
        setIsFormOpen(false);
        setEditingId(null);
        setNotice({
          text: 'The user service is out of date. Ask the admin to deploy the compatible manage-users function.',
          error: true,
        });
        return;
      }
      setServiceReady(true);
      setNotice(null);
      setUsers(Array.isArray(result?.users) ? result.users : []);
      setCurrentCount(typeof result?.currentCount === 'number' ? result.currentCount : 0);
      setAssignableRoles(Array.isArray(result?.assignable_roles) ? result.assignable_roles : []);
      setGrantablePermissions(Array.isArray(result?.grantable_permissions) ? result.grantable_permissions : []);
      setShops(Array.isArray(result?.shops) ? result.shops : []);
    } catch (error) {
      setServiceReady(false);
      setUsers([]);
      setCurrentCount(0);
      setAssignableRoles([]);
      setGrantablePermissions([]);
      setShops([]);
      setIsFormOpen(false);
      setEditingId(null);
      setNotice({ text: error instanceof Error ? error.message : 'Could not load users.', error: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadAdminTeam = useCallback(async (adminId: string) => {
    const requestVersion = ++teamRequestVersion.current;
    setAdminTeamLoading(true);
    setAdminTeamMembers([]);
    setAdminTeamCount(0);
    setAdminPrivateNote('');
    try {
      const [result, noteResult] = await Promise.all([
        invokeManageUsers<{
          team_count: number;
          team_members: AdminTeamMember[];
        }>({ action: 'get_team', admin_id: adminId }),
        invokeManageUsers<{ note: { note?: string } }>({ action: 'get_admin_note', admin_id: adminId }),
      ]);
      if (requestVersion !== teamRequestVersion.current) return;
      setAdminTeamCount(result.team_count);
      setAdminTeamMembers(result.team_members);
      setAdminPrivateNote(noteResult.note.note ?? '');
    } catch (error) {
      if (requestVersion === teamRequestVersion.current) {
        setAdminTeamMembers([]);
        setAdminTeamCount(0);
        setAdminPrivateNote('');
        setNotice({ text: error instanceof Error ? error.message : 'Could not load this Admin team.', error: true });
      }
    } finally {
      if (requestVersion === teamRequestVersion.current) setAdminTeamLoading(false);
    }
  }, []);

  const saveAdminPrivateNote = async () => {
    if (!isSuperAdmin || !editingId || form.role !== UserRole.ADMIN || privateNoteSaving) return;
    setPrivateNoteSaving(true);
    setNotice(null);
    try {
      await invokeManageUsers<{ note: unknown }>({
        action: 'save_admin_note',
        admin_id: editingId,
        note: adminPrivateNote,
      });
      setNotice({ text: 'Private Admin note saved.', error: false });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not save private note.', error: true });
    } finally {
      setPrivateNoteSaving(false);
    }
  };

  const startAdd = () => {
    if (!serviceReady) return;
    setEditingId(null);
    setShowFormPassword(false);
    setIsFormOpen(true);
    const role = assignableRoles[0] ?? UserRole.CASHIER;
    setForm({
      ...EMPTY_FORM,
      role,
      permissions: [],
      shop_id: role === UserRole.ADMIN
        ? shops.find((shop) => shop.status === 'active')?.id ?? ''
        : '',
    });
    setNotice(null);
  };

  const startEdit = (user: ManagedUser) => {
    if (!serviceReady || !user.can_edit) return;
    teamRequestVersion.current += 1;
    setAdminTeamLoading(false);
    setAdminTeamMembers([]);
    setAdminTeamCount(0);
    setAdminPrivateNote('');
    const email = String(user.email ?? '');
    setEditingId(user.id);
    setShowFormPassword(false);
    setIsFormOpen(true);
    const userRole = Object.values(UserRole).includes(user.role as UserRole)
      ? user.role as UserRole
      : UserRole.CASHIER;
    setForm({
      full_name: String(user.full_name ?? ''),
      username: String(user.username ?? ''),
      email,
      password: '',
      role: userRole,
      permissions: Array.isArray(user.permissions) ? [...user.permissions] : [],
      is_active: user.is_active === true,
      shop_id: user.shop_id ?? '',
    });
    setNotice(null);
    if (isSuperAdmin && userRole === UserRole.ADMIN) void loadAdminTeam(user.id);
  };

  const cancelForm = () => {
    teamRequestVersion.current += 1;
    setAdminTeamLoading(false);
    setAdminTeamMembers([]);
    setAdminTeamCount(0);
    setEditingId(null);
    setIsFormOpen(false);
    setShowFormPassword(false);
    setForm({
      ...EMPTY_FORM,
      permissions: [...EMPTY_FORM.permissions],
    });
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serviceReady) return;
    const fullName = form.full_name.trim();
    const username = form.username.trim();
    const email = form.email.trim();
    if (!fullName) return setNotice({ text: 'Full name is required.', error: true });
    if (!username) return setNotice({ text: 'Username is required.', error: true });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setNotice({ text: 'Enter a valid email address.', error: true });
    }
    if (!editingId && form.password.length < 8) {
      return setNotice({ text: 'Password must be at least 8 characters.', error: true });
    }
    if (editingId && form.password && form.password.length < 8) {
      return setNotice({ text: 'Password must be at least 8 characters.', error: true });
    }
    if (isSuperAdmin && form.role === UserRole.ADMIN && !form.shop_id) {
      return setNotice({ text: 'Select a shop for this Admin account.', error: true });
    }

    setSaving(true);
    setNotice(null);
    try {
      const result = await invokeManageUsers<{ message: string; id?: string }>({
        action: editingId ? 'update' : 'create',
        ...(editingId ? { id: editingId } : {}),
        full_name: fullName,
        username,
        email,
        ...(!editingId ? { password: form.password } : {}),
        role: form.role,
        permissions: form.role === UserRole.SUPER_ADMIN ? [] : form.permissions,
        is_active: form.is_active,
        shop_id: form.role === UserRole.ADMIN ? form.shop_id : undefined,
      });

      if (editingId && form.password) {
        try {
          await invokeManageUsers<{ message: string }>({
            action: 'reset_password',
            id: editingId,
            password: form.password,
          });
        } catch (error) {
          cancelForm();
          await refresh();
          setNotice({
            text: `Profile updated, but the password reset failed: ${error instanceof Error ? error.message : 'Unknown error.'}`,
            error: true,
          });
          return;
        }
      }
      cancelForm();
      setNotice({ text: result.message || 'User saved.', error: false });
      await refresh();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not save user.', error: true });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: ManagedUser) => {
    if (!serviceReady || !isSuperAdmin || !user.can_manage || user.id === currentUserId) return;
    if (!window.confirm(`Remove access for ${user.username}? They will be blocked from signing in and moved to the Trash Bin.`)) return;
    setNotice(null);
    try {
      const result = await invokeManageUsers<{ message: string }>({
        action: 'set_status',
        status: 'remove_access',
        id: user.id,
      });
      setNotice({ text: result.message || 'User removed.', error: false });
      await refresh();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not remove user.', error: true });
    }
  };

  const handleStatusChange = async (user: ManagedUser, status: 'deactivate' | 'reactivate') => {
    if (!serviceReady || !isSuperAdmin || !user.can_manage || user.id === currentUserId) return;
    const description = status === 'deactivate' ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${description} ${user.username}?`)) return;
    setNotice(null);
    try {
      const result = await invokeManageUsers<{ message: string }>({
        action: 'set_status',
        status,
        id: user.id,
      });
      setNotice({ text: result.message, error: false });
      await refresh();
      if (editingId && form.role === UserRole.ADMIN) await loadAdminTeam(editingId);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : `Could not ${description.toLowerCase()} user.`, error: true });
    }
  };

  const handleAdminTeamStatusChange = async (
    member: AdminTeamMember,
    status: 'deactivate' | 'reactivate' | 'remove_access',
  ) => {
    if (!serviceReady || !isSuperAdmin) return;
    const actionLabel = status === 'remove_access'
      ? 'Remove access for'
      : status === 'deactivate' ? 'Deactivate' : 'Reactivate';
    const detail = status === 'remove_access'
      ? `Remove access for ${member.username}? They will be blocked from signing in and moved to the Trash Bin.`
      : `${actionLabel} ${member.username}?`;
    if (!window.confirm(detail)) return;
    setNotice(null);
    try {
      const result = await invokeManageUsers<{ message: string }>({
        action: 'set_status',
        status,
        id: member.member_id,
      });
      setNotice({ text: result.message, error: false });
      await refresh();
      if (editingId) await loadAdminTeam(editingId);
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : `Could not ${actionLabel.toLowerCase()} ${member.username}.`,
        error: true,
      });
    }
  };

  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-text">Users</h2>
          <p className="mt-1 text-sm text-muted">
            {currentRole === UserRole.ADMIN
              ? 'Manage accounts for this shop.'
              : 'Manage platform Admin accounts and shop access.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isFormOpen && (
            <button type="button" disabled={!serviceReady} onClick={startAdd} className="inline-flex items-center gap-2 rounded-control bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              <Plus size={17} /> Add User
            </button>
          )}
          {editingId && <button type="button" onClick={cancelForm} className="inline-flex items-center gap-2 rounded-control border border-border px-4 py-2.5 text-sm font-bold text-text hover:bg-surface"><X size={16} /> Cancel</button>}
        </div>
      </header>

      {notice && <p role={notice.error ? 'alert' : 'status'} className={`visual-toast rounded-control border px-4 py-3 text-sm ${notice.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{notice.text}</p>}

      {isFormOpen && (
        <form onSubmit={(event) => void handleSave(event)} className="space-y-5 rounded-card border border-border bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold text-text">{editingId ? 'Edit User' : 'Add User'}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-semibold text-text">
              Full name *
              <input required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-semibold text-text">
              Username *
              <input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-semibold text-text">
              Email *
              <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
            </label>
            {!(editingId === currentUserId && currentRole === UserRole.ADMIN) && <label className="space-y-1.5 text-sm font-semibold text-text sm:col-span-2">
              {editingId ? 'Set New Password (optional)' : 'Password *'}
              <span className="relative block">
                <input type={showFormPassword ? 'text' : 'password'} autoComplete="new-password" required={!editingId} minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingId ? 'Leave blank to keep the current password' : 'At least 8 characters'} className="w-full rounded-control border border-border bg-white px-3 py-2 pr-10 text-sm font-normal" />
                <button
                  type="button"
                  aria-label={showFormPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showFormPassword}
                  onClick={() => setShowFormPassword((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-text"
                >
                  {showFormPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              {editingId && <span className="block text-xs font-normal text-muted">Passwords cannot be viewed. Setting a new password replaces the current one.</span>}
            </label>}
            <label className="space-y-1.5 text-sm font-semibold text-text sm:col-span-2">
              Role
              <select value={form.role} disabled={editingId === currentUserId} onChange={(event) => {
                const role = event.target.value as UserRole;
                setForm({
                  ...form,
                  role,
                  permissions: [],
                });
              }} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal">
                {editingId === currentUserId && !assignableRoles.includes(form.role) && (
                  <option value={form.role}>{ROLE_LABELS[form.role]}</option>
                )}
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
              </select>
            </label>
          </div>

          <fieldset disabled={editingId === currentUserId} className="rounded-control border border-border p-4 disabled:opacity-70">
            <legend className="px-2 text-sm font-bold text-text">Allowed Modules (Custom Permissions)</legend>
            {form.role === UserRole.SUPER_ADMIN &&             <p className="mb-3 text-xs font-semibold text-muted">Platform access only; no shop modules are assigned.</p>}
            {form.role === UserRole.ADMIN && <p className="mb-3 text-xs font-semibold text-muted">Select the modules this admin is allowed to access.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {MODULES.filter(({ key }) => grantablePermissions.includes(key)).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(key)}
                    disabled={form.role === UserRole.SUPER_ADMIN || (form.role === UserRole.ADMIN && !isSuperAdmin)}
                    onChange={(event) => setForm({
                      ...form,
                      permissions: setModulePermission(
                        form.permissions,
                        key,
                        event.target.checked,
                      ),
                    })}
                    className="h-4 w-4 accent-green-700"
                  />
                  {label}
                </label>
              ))}
            </div>
            {hasPosPrintToggles(form.permissions) && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                {([
                  ['pos_print_sale', 'Print sale receipts'],
                  ['pos_print_payment', 'Print receiving-money receipts'],
                ] as const).map(([permission, label]) => {
                  const canChange = grantablePermissions.includes(permission)
                    || (editingId !== null && form.permissions.includes(permission));
                  return (
                    <label key={permission} className="flex items-center justify-between gap-3 text-sm text-text">
                      <span>{label}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted">{form.permissions.includes(permission) ? 'Yes' : 'No'}</span>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={label}
                          checked={form.permissions.includes(permission)}
                          disabled={!canChange}
                          onChange={(event) => setForm({
                            ...form,
                            permissions: setPosPrintPermission(form.permissions, permission, event.target.checked),
                          })}
                          className="h-4 w-4 accent-green-700"
                        />
                      </span>
                    </label>
                  );
                })}
                <p className="text-xs text-muted">Sale and receiving-money receipt printing require explicit approval.</p>
              </div>
            )}
            {isSuperAdmin && form.role === UserRole.ADMIN && form.permissions.includes('settings') && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <p className="text-sm font-bold text-text">Settings sections this Admin may edit</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {SETTINGS_SECTION_PERMISSIONS.filter(({ key }) =>
                    grantablePermissions.includes(key) || form.permissions.includes(key)
                  ).map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.permissions.includes(key)}
                        onChange={(event) => setForm({
                          ...form,
                          permissions: setSettingsSectionPermission(
                            form.permissions,
                            key,
                            event.target.checked,
                          ),
                        })}
                        className="h-4 w-4 accent-green-700"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted">Only Super Admin can change these Admin-level settings grants.</p>
              </div>
            )}
          </fieldset>

          <label className="flex items-center gap-2 text-sm font-semibold text-text">
            <input type="checkbox" checked={form.is_active} disabled={editingId !== null || !isSuperAdmin} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} className="h-4 w-4 accent-green-700 disabled:opacity-50" />
            Active (can log in)
          </label>

          {isSuperAdmin && form.role === UserRole.ADMIN && (
            <label className="space-y-1.5 text-sm font-semibold text-text">
              Assign Admin to shop *
              <select
                required
                value={form.shop_id}
                onChange={(event) => setForm({ ...form, shop_id: event.target.value })}
                className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal"
              >
                <option value="">Select an active shop</option>
                {shops.filter((shop) => shop.status === 'active').map((shop) => (
                  <option key={shop.id} value={shop.id}>{shop.name}</option>
                ))}
              </select>
              {shops.length === 0 && (
                <span className="block text-xs font-normal text-muted">Create an active shop before adding an Admin.</span>
              )}
            </label>
          )}

          {isSuperAdmin && editingId && form.role === UserRole.ADMIN && (
            <section className="space-y-3 rounded-card border border-border p-4">
              <div>
                <h4 className="text-sm font-bold text-text">Team</h4>
                <p className="mt-1 text-sm text-muted">
                  {adminTeamCount} accounts created by this Admin, including removed accounts. No per-Admin limit.
                </p>
              </div>
              <div className="space-y-2 border-y border-border py-3">
                <label htmlFor="private-admin-note" className="block text-sm font-bold text-text">Platform-only private note</label>
                <textarea
                  id="private-admin-note"
                  maxLength={2000}
                  rows={3}
                  value={adminPrivateNote}
                  onChange={(event) => setAdminPrivateNote(event.target.value)}
                  className="w-full rounded-control border border-border px-3 py-2 text-sm"
                  placeholder="Visible only to platform Super Admins"
                />
                <button type="button" disabled={privateNoteSaving} onClick={() => void saveAdminPrivateNote()} className="rounded-control border border-border px-3 py-2 text-sm font-semibold text-text disabled:opacity-50">
                  {privateNoteSaving ? 'Saving…' : 'Save private note'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="border-b border-border bg-surface text-[11px] font-bold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Username</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Account created</th>
                      <th className="px-3 py-2">Last sign-in</th>
                      <th className="px-3 py-2 text-right">Access actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {adminTeamLoading
                      ? <tr><td colSpan={6} className="px-3 py-5 text-center text-muted">Loading team…</td></tr>
                      : adminTeamMembers.length === 0
                        ? <tr><td colSpan={6} className="px-3 py-5 text-center text-muted">No team accounts have been attributed to this Admin.</td></tr>
                        : adminTeamMembers.map((member) => (
                          <tr key={member.member_id}>
                            <td className="px-3 py-2 font-semibold text-text">{member.username}</td>
                            <td className="px-3 py-2 capitalize">{ROLE_LABELS[member.role as UserRole] ?? member.role}</td>
                            <td className="px-3 py-2 capitalize">{member.status}</td>
                            <td className="px-3 py-2">{formatTeamTimestamp(member.created_at)}</td>
                            <td className="px-3 py-2">{formatTeamTimestamp(member.last_sign_in_at)}</td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-2">
                                {member.status !== 'removed' && <>
                                  <button
                                    type="button"
                                    onClick={() => void handleAdminTeamStatusChange(
                                      member,
                                      member.status === 'active' ? 'deactivate' : 'reactivate',
                                    )}
                                    className="rounded-control border border-border px-2 py-1 text-xs font-semibold text-text hover:bg-surface"
                                  >
                                    {member.status === 'active' ? 'Deactivate' : 'Reactivate'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleAdminTeamStatusChange(member, 'remove_access')}
                                    aria-label={`Remove access for ${member.username}`}
                                    className="rounded-control border border-red-200 p-1.5 text-danger hover:bg-red-50"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>}
                                {member.status === 'removed' && <span className="text-xs text-muted">Restore via Trash Bin</span>}
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded-control bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{saving ? 'Saving…' : 'Save User'}</button>
            <button type="button" onClick={cancelForm} disabled={saving} className="rounded-control border border-border px-5 py-2.5 text-sm font-bold text-text hover:bg-surface">Cancel</button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-card border border-border bg-white shadow-sm">
        <table className={`w-full ${isSuperAdmin ? 'min-w-[820px]' : 'min-w-[680px]'} text-left text-sm`}>
          <thead className="border-b border-border bg-surface text-[11px] font-bold uppercase tracking-wide text-muted">
            <tr><th className="px-5 py-3">User Info</th><th className="px-5 py-3">Role</th>{isSuperAdmin && <th className="px-5 py-3">Created by</th>}<th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? <tr><td colSpan={isSuperAdmin ? 5 : 4} className="visual-skeleton px-5 py-8 text-center text-muted">Loading users…</td></tr>
              : visibleUsers.length === 0 ? <tr><td colSpan={isSuperAdmin ? 5 : 4} className="px-5 py-8 text-center text-muted">No other user accounts found.</td></tr>
                : visibleUsers.map((user) => (
                  <tr key={user.id} className="users-table-row">
                    <td className="px-5 py-4">
                      <div className="font-bold text-text">{user.full_name}</div>
                      <div className="mt-0.5 text-xs text-muted">{user.username} · {user.email}</div>
                    </td>
                    <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${roleClass(Object.values(UserRole).includes(user.role as UserRole) ? user.role as UserRole : UserRole.CASHIER)}`}>{user.role ? ROLE_LABELS[user.role] : ROLE_LABELS[UserRole.CASHIER]}</span></td>
                    {isSuperAdmin && <td className="px-5 py-4 text-muted">{user.created_by_username ?? 'Unassigned'}</td>}
                    <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${user.is_active === true ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{user.is_active === true ? 'Active' : 'Inactive'}</span></td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        {user.can_edit && <button type="button" onClick={() => startEdit(user)} title={`Edit ${user.username}`} aria-label={`Edit ${user.username}`} className="rounded-control border border-border p-2 text-muted hover:bg-surface"><Pencil size={15} /></button>}
                        {isSuperAdmin && user.can_manage && user.id !== currentUserId && <>
                          <button type="button" onClick={() => void handleStatusChange(user, user.is_active === true ? 'deactivate' : 'reactivate')} className="rounded-control border border-border px-2 py-1 text-xs font-semibold text-text hover:bg-surface">{user.is_active === true ? 'Deactivate' : 'Reactivate'}</button>
                          <button type="button" onClick={() => void handleDelete(user)} title={`Remove access for ${user.username}`} aria-label={`Remove access for ${user.username}`} className="rounded-control border border-red-200 p-2 text-danger hover:bg-red-50"><Trash2 size={15} /></button>
                        </>}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
