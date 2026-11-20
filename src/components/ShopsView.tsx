import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, Check, ChevronUp, ImagePlus, Pencil, Plus, RefreshCw, Save, Store, X } from 'lucide-react';
import {
  hasPosPrintToggles,
  MODULES,
  POS_PRINT_PERMISSION_KEYS,
  SETTINGS_SECTION_PERMISSIONS,
  setModulePermission,
  setPosPrintPermission,
  setSettingsSectionPermission,
  type ModuleKey,
  type PermissionKey,
} from '../permissions';
import {
  SHOP_LOGO_BUCKET,
  shopLogoFileError,
  shopLogoFileExtension,
  shopLogoStoragePath,
} from '../utils/shopLogo';
import {
  parseShopOperationalSettings,
  toShopSettingsRpcPayload,
  type ShopOperationalSettings,
} from '../utils/shopSettings';
import { parseReceiptQrSettings, type ReceiptQrSettings } from '../utils/receiptLinks';
import { supabase, supabaseUrl } from '../utils/supabase';

interface ShopRecord {
  id: string;
  name: string;
  phone: string;
  address: string;
  logo_path: string | null;
  status: 'active' | 'suspended' | 'provisioning' | 'deleted';
  admin_limit: number;
  staff_limit: number;
  operational_settings: ShopOperationalSettings;
  receipt_qr_settings: ReceiptQrSettings;
}

interface ProvisionForm {
  name: string;
  phone: string;
  address: string;
  admin_full_name: string;
  admin_username: string;
  admin_email: string;
  admin_password: string;
  admin_permissions: PermissionKey[];
}

interface ManagedAdmin {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  role: 'admin';
  is_active: boolean | null;
  permissions: PermissionKey[] | null;
  shop_id: string | null;
}

interface ShopDraft {
  name: string;
  phone: string;
  address: string;
  logo_path: string;
  admin_limit: number;
  staff_limit: number;
}

const EMPTY_FORM: ProvisionForm = {
  name: '',
  phone: '',
  address: '',
  admin_full_name: '',
  admin_username: '',
  admin_email: '',
  admin_password: '',
  admin_permissions: [],
};

async function invokePlatformAction<T>(body: Record<string, unknown>): Promise<T> {
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

export function ShopsView() {
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [admins, setAdmins] = useState<ManagedAdmin[]>([]);
  const [form, setForm] = useState<ProvisionForm>(EMPTY_FORM);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  const provisionOperation = useRef<{ signature: string; id: string } | null>(null);

  const refresh = async (): Promise<boolean> => {
    setLoading(true);
    try {
      const [shopResult, userResult] = await Promise.all([
        invokePlatformAction<{
          shops: Array<Omit<ShopRecord, 'operational_settings' | 'receipt_qr_settings'> & {
            operational_settings: unknown;
            receipt_qr_settings: unknown;
          }>;
        }>({ action: 'shops_list' }),
        invokePlatformAction<{ api_version?: number; users?: ManagedAdmin[] }>({ action: 'list' }),
      ]);
      if (!Array.isArray(shopResult.shops)) throw new Error('The shop service returned an invalid response.');
      if (userResult.api_version !== 6 || !Array.isArray(userResult.users)) {
        throw new Error('The user service is out of date. Deploy the compatible manage-users function.');
      }
      setShops(shopResult.shops.map((shop) => ({
        ...shop,
        operational_settings: parseShopOperationalSettings(shop.operational_settings),
        receipt_qr_settings: parseReceiptQrSettings(shop.receipt_qr_settings),
      })));
      setAdmins(userResult.users.filter((user) => user.role === 'admin' && typeof user.shop_id === 'string'));
      setNotice(null);
      return true;
    } catch (error) {
      setShops([]);
      setAdmins([]);
      setNotice({ text: error instanceof Error ? error.message : 'Could not load shops.', error: true });
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const createShop = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    const signature = JSON.stringify(form);
    const operationId = provisionOperation.current?.signature === signature
      ? provisionOperation.current.id
      : crypto.randomUUID();
    provisionOperation.current = { signature, id: operationId };
    try {
      const result = await invokePlatformAction<{ message: string }>({
        action: 'provision_shop',
        operation_id: operationId,
        ...form,
      });
      provisionOperation.current = null;
      setForm(EMPTY_FORM);
      setCreateFormOpen(false);
      const refreshed = await refresh();
      setNotice({
        text: refreshed ? result.message : 'Shop created, but the directory could not be refreshed. Use Refresh to check it.',
        error: !refreshed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not provision the shop.';
      if (message.includes('Start a new operation')) provisionOperation.current = null;
      setNotice({ text: message, error: true });
    } finally {
      setSaving(false);
    }
  };

  const updateShop = async (
    shop: ShopRecord,
    draft: ShopDraft,
    logoFile: File | null = null,
    status: ShopRecord['status'] = shop.status,
  ) => {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    let uploadedLogoPath: string | null = null;
    try {
      let logoPath = draft.logo_path.trim();
      if (logoFile) {
        const fileError = shopLogoFileError(logoFile);
        if (fileError) throw new Error(fileError);
        if (!supabase) throw new Error('Supabase is not configured.');
        const extension = shopLogoFileExtension(logoFile.type);
        if (!extension) throw new Error('Choose a PNG, JPEG, or WebP image.');
        const newLogoPath = `${shop.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(SHOP_LOGO_BUCKET)
          .upload(newLogoPath, logoFile, {
            cacheControl: '3600',
            contentType: logoFile.type,
            upsert: false,
          });
        if (uploadError) throw new Error(`Logo upload failed: ${uploadError.message}`);
        uploadedLogoPath = newLogoPath;
        logoPath = supabase.storage.from(SHOP_LOGO_BUCKET).getPublicUrl(uploadedLogoPath).data.publicUrl;
      }

      await invokePlatformAction<{ message: string }>({
        action: 'update_shop',
        id: shop.id,
        name: draft.name,
        phone: draft.phone,
        address: draft.address,
        logo_path: logoPath,
        status,
        admin_limit: draft.admin_limit,
        staff_limit: draft.staff_limit,
      });

      let cleanupNotice: string | null = null;
      if (supabase && shop.logo_path !== logoPath) {
        const previousLogoPath = shopLogoStoragePath(shop.logo_path, supabaseUrl, shop.id);
        if (previousLogoPath && previousLogoPath !== uploadedLogoPath) {
          try {
            const { error: removeError } = await supabase.storage.from(SHOP_LOGO_BUCKET).remove([previousLogoPath]);
            if (removeError) cleanupNotice = `Shop saved, but the previous logo could not be removed: ${removeError.message}`;
          } catch (error) {
            cleanupNotice = `Shop saved, but the previous logo could not be removed: ${error instanceof Error ? error.message : 'Unknown storage error.'}`;
          }
        }
      }
      const refreshed = await refresh();
      setNotice({
        text: cleanupNotice
          ?? (refreshed ? 'Shop details saved.' : 'Shop saved, but the directory could not be refreshed. Use Refresh to check it.'),
        error: cleanupNotice !== null || !refreshed,
      });
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Could not update shop.';
      if (uploadedLogoPath && supabase) {
        try {
          const { error: cleanupError } = await supabase.storage.from(SHOP_LOGO_BUCKET).remove([uploadedLogoPath]);
          if (cleanupError) message += ` The uploaded logo could not be cleaned up: ${cleanupError.message}`;
        } catch (cleanupError) {
          message += ` The uploaded logo could not be cleaned up: ${cleanupError instanceof Error ? cleanupError.message : 'Unknown storage error.'}`;
        }
      }
      setNotice({ text: message, error: true });
    } finally {
      setSaving(false);
    }
  };

  const updateAdminPermissions = async (admin: ManagedAdmin, permissions: PermissionKey[]) => {
    if (saving) return;
    if (!admin.shop_id || !admin.full_name || !admin.username || !admin.email) {
      setNotice({ text: 'The shop Admin profile is incomplete and cannot be updated.', error: true });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await invokePlatformAction<{ message: string }>({
        action: 'update',
        id: admin.id,
        full_name: admin.full_name,
        username: admin.username,
        email: admin.email,
        role: 'admin',
        permissions,
        is_active: admin.is_active === true,
        shop_id: admin.shop_id,
      });
      const refreshed = await refresh();
      setNotice({
        text: refreshed
          ? `Page access saved for ${admin.full_name}.`
          : 'Page access saved, but the directory could not be refreshed. Use Refresh to verify it.',
        error: !refreshed,
      });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not update Admin page access.', error: true });
    } finally {
      setSaving(false);
    }
  };

  const updatePlatformSettings = async (
    shop: ShopRecord,
    settings: ShopOperationalSettings,
    receiptQrSettings: ReceiptQrSettings,
  ) => {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await invokePlatformAction<{ message: string }>({
        action: 'update_shop_settings',
        id: shop.id,
        settings: toShopSettingsRpcPayload(settings),
        receipt_qr_settings: parseReceiptQrSettings(receiptQrSettings),
      });
      const refreshed = await refresh();
      setNotice({
        text: refreshed
          ? `Settings saved for ${shop.name}.`
          : 'Settings were saved, but the directory could not be refreshed. Use Refresh to verify them.',
        error: !refreshed,
      });
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : `Could not update ${shop.name} settings.`,
        error: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const changeShopStatus = async (shop: ShopRecord) => {
    const nextStatus: ShopRecord['status'] = shop.status === 'active' ? 'suspended' : 'active';
    await updateShop(shop, {
      name: shop.name,
      phone: shop.phone,
      address: shop.address,
      logo_path: shop.logo_path ?? '',
      admin_limit: shop.admin_limit,
      staff_limit: shop.staff_limit,
    }, null, nextStatus);
  };

  const updatePermission = (permission: ModuleKey, checked: boolean) => {
    setForm((current) => ({
      ...current,
      admin_permissions: setModulePermission(current.admin_permissions, permission, checked),
    }));
  };

  const updateSettingsSection = (permission: typeof SETTINGS_SECTION_PERMISSIONS[number]['key'], checked: boolean) => {
    setForm((current) => ({
      ...current,
      admin_permissions: setSettingsSectionPermission(current.admin_permissions, permission, checked),
    }));
  };

  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-text">Shops</h2>
          <p className="mt-1 text-sm text-muted">Platform administration only. This screen shows shop and account configuration, never shop business data.</p>
        </div>
        <button
          type="button"
          aria-expanded={createFormOpen}
          aria-controls="create-shop-form"
          onClick={() => setCreateFormOpen((open) => !open)}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus size={16} /> Add new shop and first Admin
        </button>
      </header>

      {notice && <p role={notice.error ? 'alert' : 'status'} className={`rounded-control border px-4 py-3 text-sm ${notice.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-primary/30 bg-surface text-text'}`}>{notice.text}</p>}

      {createFormOpen && <section className="space-y-4 rounded-card border border-border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-text">Create shop and first Admin</h3>
          <button
            type="button"
            aria-label="Close create shop form"
            onClick={() => setCreateFormOpen(false)}
            disabled={saving}
            className="rounded-control p-2 text-muted hover:bg-surface hover:text-text disabled:opacity-50"
          >
            <X size={17} />
          </button>
        </div>
        <form id="create-shop-form" onSubmit={(event) => void createShop(event)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-semibold text-text">Shop name *
              <input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-text">Phone
              <input maxLength={40} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-text sm:col-span-2">Address
              <input maxLength={240} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-semibold text-text">First Admin full name *
              <input required maxLength={120} value={form.admin_full_name} onChange={(event) => setForm({ ...form, admin_full_name: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-text">Username *
              <input required maxLength={80} value={form.admin_username} onChange={(event) => setForm({ ...form, admin_username: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-text">Admin email *
              <input required type="email" maxLength={254} value={form.admin_email} onChange={(event) => setForm({ ...form, admin_email: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
            </label>
            <label className="space-y-1 text-sm font-semibold text-text">Admin password *
              <input required type="password" autoComplete="new-password" minLength={8} value={form.admin_password} onChange={(event) => setForm({ ...form, admin_password: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 font-normal" />
            </label>
          </div>
          <fieldset className="space-y-2 rounded-card border border-border p-3">
            <legend className="px-1 text-sm font-bold text-text">First Admin page grants</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODULES.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={form.admin_permissions.includes(key)} onChange={(event) => updatePermission(key, event.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
            {form.admin_permissions.includes('settings') && (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-bold text-text">Settings sections this Admin may edit</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {SETTINGS_SECTION_PERMISSIONS.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.admin_permissions.includes(key)}
                        onChange={(event) => updateSettingsSection(key, event.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted">Grants are explicit; no business pages are enabled automatically.</p>
          </fieldset>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            <Building2 size={16} /> {saving ? 'Provisioning…' : 'Create Shop and Admin'}
          </button>
        </form>
      </section>}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-text">Shop directory</h3>
          <button
            type="button"
            aria-label="Refresh shops"
            title="Refresh shops"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-control border border-border p-2 text-muted hover:bg-white hover:text-text disabled:opacity-50"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        {loading && <p role="status" className="rounded-card border border-border bg-white p-5 text-sm text-muted">Loading shops…</p>}
        {!loading && shops.length === 0 && <p className="rounded-card border border-border bg-white p-5 text-sm text-muted">No shops found.</p>}
        {shops.map((shop) => (
          <ShopRow
            key={shop.id}
            shop={shop}
            admins={admins.filter((admin) => admin.shop_id === shop.id)}
            saving={saving}
            editing={editingShopId === shop.id}
            onToggleEdit={() => setEditingShopId((current) => current === shop.id ? null : shop.id)}
            onSave={updateShop}
            onSaveSettings={updatePlatformSettings}
            onSaveAdminPermissions={updateAdminPermissions}
            onChangeStatus={changeShopStatus}
          />
        ))}
      </section>
    </section>
  );
}

function shopDraft(shop: ShopRecord): ShopDraft {
  return {
    name: shop.name,
    phone: shop.phone,
    address: shop.address,
    logo_path: shop.logo_path ?? '',
    admin_limit: shop.admin_limit,
    staff_limit: shop.staff_limit,
  };
}

function ShopRow({
  shop,
  admins,
  saving,
  editing,
  onToggleEdit,
  onSave,
  onSaveSettings,
  onSaveAdminPermissions,
  onChangeStatus,
}: {
  shop: ShopRecord;
  admins: ManagedAdmin[];
  saving: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  onSave: (shop: ShopRecord, draft: ShopDraft, logoFile?: File | null) => Promise<void>;
  onSaveSettings: (
    shop: ShopRecord,
    settings: ShopOperationalSettings,
    receiptQrSettings: ReceiptQrSettings,
  ) => Promise<void>;
  onSaveAdminPermissions: (admin: ManagedAdmin, permissions: PermissionKey[]) => Promise<void>;
  onChangeStatus: (shop: ShopRecord) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => shopDraft(shop));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<PermissionKey[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<ShopOperationalSettings>(shop.operational_settings);
  const [receiptQrDraft, setReceiptQrDraft] = useState<ReceiptQrSettings>(shop.receipt_qr_settings);
  const [selectedAdminId, setSelectedAdminId] = useState('');
  const editable = shop.status !== 'deleted' && shop.status !== 'provisioning';
  const selectedAdmin = admins.find((admin) => admin.id === selectedAdminId) ?? null;

  useEffect(() => {
    setDraft(shopDraft(shop));
    setLogoFile(null);
    setSettingsDraft(shop.operational_settings);
    setReceiptQrDraft(shop.receipt_qr_settings);
  }, [shop]);

  useEffect(() => {
    setSelectedAdminId((current) =>
      admins.some((admin) => admin.id === current) ? current : admins[0]?.id ?? '',
    );
  }, [admins]);

  useEffect(() => {
    setPermissionDraft(selectedAdmin?.permissions ?? []);
  }, [selectedAdmin?.id, selectedAdmin?.permissions]);

  const updatePermission = (permission: typeof MODULES[number]['key'], enabled: boolean) => {
    setPermissionDraft((current) => setModulePermission(current, permission, enabled));
  };

  const updatePrintPermission = (permission: typeof POS_PRINT_PERMISSION_KEYS[number], enabled: boolean) => {
    setPermissionDraft((current) => setPosPrintPermission(current, permission, enabled));
  };

  const updateSettingsSection = (
    permission: typeof SETTINGS_SECTION_PERMISSIONS[number]['key'],
    enabled: boolean,
  ) => {
    setPermissionDraft((current) => setSettingsSectionPermission(current, permission, enabled));
  };

  const updateMemoSettings = (patch: Partial<ShopOperationalSettings['memo']>) => {
    setSettingsDraft((current) => ({ ...current, memo: { ...current.memo, ...patch } }));
  };

  const updateMemoNote = (index: number, value: string) => {
    const notes = [...settingsDraft.memo.notes] as [string, string, string];
    notes[index] = value;
    updateMemoSettings({ notes });
  };

  const updateDiscountCap = (
    role: keyof ShopOperationalSettings['roleDiscountPercentCap'],
    value: number,
  ) => {
    setSettingsDraft((current) => ({
      ...current,
      roleDiscountPercentCap: { ...current.roleDiscountPercentCap, [role]: value },
    }));
  };

  const shopSummary = [shop.phone, shop.address].filter(Boolean).join(' · ');
  const statusLabel = shop.status === 'suspended'
    ? 'Suspended · access blocked'
    : shop.status === 'provisioning'
      ? 'Provisioning'
      : shop.status === 'deleted'
        ? 'Deleted'
        : 'Active';

  return (
    <article className="overflow-hidden rounded-card border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          {shop.logo_path
            ? <img src={shop.logo_path} alt="" className="h-10 w-10 shrink-0 rounded-control border border-border object-contain p-1" />
            : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface text-muted"><Store size={18} /></span>}
          <div className="min-w-0">
            <h4 className="truncate font-bold text-text">{shop.name}</h4>
            <p className="truncate text-xs text-muted">{statusLabel}{shopSummary ? ` · ${shopSummary}` : ''}</p>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={editing}
          onClick={onToggleEdit}
          className="inline-flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-semibold text-text hover:bg-surface"
        >
          {editing ? <><ChevronUp size={15} /> Close</> : <><Pencil size={15} /> Edit</>}
        </button>
      </div>

      {editing && (
        <div className="space-y-5 border-t border-border bg-surface/40 p-4">
          {shop.status === 'suspended' && (
            <p className="flex items-start gap-2 rounded-control bg-warning/15 p-3 text-xs text-text">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              Shop users cannot sign in or perform business operations while the shop is suspended.
            </p>
          )}

          <form onSubmit={(event) => { event.preventDefault(); void onSave(shop, draft, logoFile); }} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="font-bold text-text">Shop details</h5>
              {(shop.status === 'active' || shop.status === 'suspended') && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onChangeStatus(shop)}
                  className="rounded-control border border-border px-3 py-2 text-sm font-semibold text-text disabled:opacity-50"
                >
                  {shop.status === 'active' ? 'Suspend shop' : 'Reactivate shop'}
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1 text-xs font-semibold text-text">Shop name
                <input required value={draft.name} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">Phone
                <input value={draft.phone} maxLength={40} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text lg:col-span-1">Address
                <input value={draft.address} maxLength={240} onChange={(event) => setDraft({ ...draft, address: event.target.value })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text sm:col-span-2">Logo URL or app path
                <input value={draft.logo_path} maxLength={4096} onChange={(event) => { setDraft({ ...draft, logo_path: event.target.value }); setLogoFile(null); }} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">
                Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    setLogoFile(file);
                    event.currentTarget.value = '';
                  }}
                  className="block w-full rounded-control border border-border bg-white px-3 py-1.5 text-xs font-normal"
                />
                <span className="block font-normal text-muted">PNG, JPEG, or WebP; maximum 2 MB.</span>
              </label>
              {logoFile && (
                <p className="flex items-center gap-2 self-end text-xs text-muted">
                  <ImagePlus size={15} /> Selected: {logoFile.name}
                  <button type="button" onClick={() => setLogoFile(null)} aria-label="Remove selected logo file" className="rounded p-1 hover:bg-surface">
                    <X size={14} />
                  </button>
                </p>
              )}
              {draft.logo_path && (
                <button type="button" onClick={() => { setDraft({ ...draft, logo_path: '' }); setLogoFile(null); }} className="justify-self-start text-xs font-semibold text-primary hover:underline">
                  Remove current logo
                </button>
              )}
              <label className="space-y-1 text-xs font-semibold text-text">Admin limit
                <input type="number" min={1} max={50} value={draft.admin_limit} onChange={(event) => setDraft({ ...draft, admin_limit: Number(event.target.value) })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">Staff limit
                <input type="number" min={1} max={500} value={draft.staff_limit} onChange={(event) => setDraft({ ...draft, staff_limit: Number(event.target.value) })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={saving || !editable} className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                <Save size={15} /> {saving ? 'Saving…' : 'Save shop details'}
              </button>
              {editable && <button type="button" onClick={onToggleEdit} className="rounded-control border border-border px-4 py-2 text-sm font-semibold text-text">Cancel</button>}
            </div>
          </form>

          <section className="space-y-4 border-t border-border pt-4">
            <div>
              <h5 className="font-bold text-text">Shop settings</h5>
              <p className="text-xs text-muted">Super Admin platform changes apply to this shop and are recorded in the audit log.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1 text-xs font-semibold text-text">Billing template
                <select value={settingsDraft.template} onChange={(event) => setSettingsDraft({
                  ...settingsDraft,
                  template: event.target.value as ShopOperationalSettings['template'],
                })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal">
                  {['simple', 'classic', 'professional', 'modern', 'pharmacy-memo'].map((template) => (
                    <option key={template} value={template}>{template}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">Receipt paper
                <select value={settingsDraft.format} onChange={(event) => setSettingsDraft({
                  ...settingsDraft,
                  format: event.target.value as ShopOperationalSettings['format'],
                })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal">
                  <option value="thermal58">58 mm</option>
                  <option value="thermal80">80 mm</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">Maximum discount (Rs)
                <input type="number" min={0} max={200} step={0.01} value={settingsDraft.maxDiscountPaisa / 100} onChange={(event) => setSettingsDraft({
                  ...settingsDraft,
                  maxDiscountPaisa: Math.round(Number(event.target.value) * 100),
                })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
              </label>
              <label className="space-y-1 text-xs font-semibold text-text">Expiry warning (days)
                <input type="number" min={1} max={365} step={1} value={settingsDraft.expiryWarningDays} onChange={(event) => setSettingsDraft({
                  ...settingsDraft,
                  expiryWarningDays: Number(event.target.value),
                })} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal" />
              </label>
              {(['admin', 'manager', 'cashier', 'accountant'] as const).map((role) => (
                <label key={role} className="space-y-1 text-xs font-semibold capitalize text-text">{role} discount cap (%)
                  <input type="number" disabled={role === 'accountant'} min={0} max={role === 'admin' ? 30 : role === 'manager' ? 15 : role === 'cashier' ? 10 : 0} step={0.1} value={settingsDraft.roleDiscountPercentCap[role]} onChange={(event) => updateDiscountCap(role, Number(event.target.value))} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal disabled:opacity-60" />
                </label>
              ))}
            </div>

            <fieldset className="space-y-3 rounded-card border border-border bg-white p-3">
              <legend className="px-1 text-xs font-bold text-text">Pharmacy Memo</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-semibold text-text">Terminal name
                  <input value={settingsDraft.memo.terminalName} maxLength={80} onChange={(event) => updateMemoSettings({ terminalName: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 text-sm font-normal" />
                </label>
                <label className="space-y-1 text-xs font-semibold text-text">Net rounding
                  <select value={settingsDraft.memo.roundNet} onChange={(event) => updateMemoSettings({ roundNet: event.target.value as ShopOperationalSettings['memo']['roundNet'] })} className="w-full rounded-control border border-border px-3 py-2 text-sm font-normal">
                    <option value="none">None</option><option value="1">Rs 1</option><option value="5">Rs 5</option><option value="10">Rs 10</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs font-semibold text-text">Memo number digits
                  <input type="number" min={1} max={20} step={1} value={settingsDraft.memo.numberDigits} onChange={(event) => updateMemoSettings({ numberDigits: Number(event.target.value) })} className="w-full rounded-control border border-border px-3 py-2 text-sm font-normal" />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['showBatchNumber', 'Print Batch No.'],
                  ['showExpiryDate', 'Print Expiry'],
                  ['printTax', 'Print tax row'],
                  ['printLogo', 'Print shop logo'],
                  ['duplicateLabel', 'Mark duplicate receipts'],
                  ['autoPrint', 'Auto-print receipts'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs font-medium text-text">
                    <input type="checkbox" checked={settingsDraft.memo[key]} onChange={(event) => updateMemoSettings({ [key]: event.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="grid gap-2">
                {settingsDraft.memo.notes.map((note, index) => (
                  <label key={index} className="space-y-1 text-xs font-semibold text-text">Memo note {index + 1}
                    <input value={note} maxLength={200} onChange={(event) => updateMemoNote(index, event.target.value)} className="w-full rounded-control border border-border px-3 py-2 text-sm font-normal" />
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-card border border-border bg-white p-3">
              <legend className="px-1 text-xs font-bold text-text">Receipt QR</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-semibold text-text sm:col-span-2">Public app URL (HTTPS origin only)
                  <input type="url" maxLength={255} value={receiptQrDraft.qrBaseUrl} onChange={(event) => setReceiptQrDraft({ ...receiptQrDraft, qrBaseUrl: event.target.value })} className="w-full rounded-control border border-border px-3 py-2 text-sm font-normal" />
                </label>
                <label className="space-y-1 text-xs font-semibold text-text">Link lifetime (days)
                  <input type="number" min={1} max={3650} step={1} value={receiptQrDraft.linkLifetimeDays} onChange={(event) => setReceiptQrDraft({ ...receiptQrDraft, linkLifetimeDays: Number(event.target.value) })} className="w-full rounded-control border border-border px-3 py-2 text-sm font-normal" />
                </label>
                <label className="space-y-1 text-xs font-semibold text-text">QR placement
                  <select value={receiptQrDraft.qrPlacement} onChange={(event) => setReceiptQrDraft({ ...receiptQrDraft, qrPlacement: event.target.value as ReceiptQrSettings['qrPlacement'] })} className="w-full rounded-control border border-border px-3 py-2 text-sm font-normal">
                    <option value="footer">Above footer line</option>
                    <option value="after_totals">After totals</option>
                    <option value="below_header">Below shop header</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-text">
                  <input type="checkbox" checked={receiptQrDraft.publicReceiptsEnabled} onChange={(event) => setReceiptQrDraft({ ...receiptQrDraft, publicReceiptsEnabled: event.target.checked })} />
                  Enable public receipt links
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-text">
                  <input type="checkbox" checked={receiptQrDraft.showMedicineNames} onChange={(event) => setReceiptQrDraft({ ...receiptQrDraft, showMedicineNames: event.target.checked })} />
                  Show medicine names
                </label>
              </div>
              <p className="text-xs text-muted">Public QR receipts include allocated Batch No. and Expiry. Anyone holding a link can view them until expiry, revocation, or shop suspension.</p>
            </fieldset>
            <button type="button" disabled={saving || !editable} onClick={() => void onSaveSettings(shop, settingsDraft, receiptQrDraft)} className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              <Save size={15} /> {saving ? 'Saving…' : 'Save shop settings'}
            </button>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <div>
              <h5 className="font-bold text-text">Admin page access</h5>
              <p className="text-xs text-muted">Choose which pages this shop’s Admin can use.</p>
            </div>
            {admins.length === 0 && <p role="status" className="rounded-control border border-border bg-white p-3 text-sm text-muted">No Admin account is assigned to this shop.</p>}
            {admins.length > 1 && (
              <label className="block max-w-md space-y-1 text-xs font-semibold text-text">Shop Admin
                <select value={selectedAdminId} onChange={(event) => setSelectedAdminId(event.target.value)} className="w-full rounded-control border border-border bg-white px-3 py-2 text-sm font-normal">
                  {admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.full_name || admin.username || admin.email || admin.id}</option>)}
                </select>
              </label>
            )}
            {selectedAdmin && (
              <>
                <p className="text-sm text-text">
                  {selectedAdmin.full_name || selectedAdmin.username || selectedAdmin.email}
                  {selectedAdmin.is_active === false && <span className="ml-2 text-xs text-muted">(inactive)</span>}
                </p>
                <fieldset disabled={saving} className="grid gap-2 rounded-card border border-border bg-white p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {MODULES.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-text">
                      <input type="checkbox" checked={permissionDraft.includes(key)} onChange={(event) => updatePermission(key, event.target.checked)} />
                      {label}
                    </label>
                  ))}
                  {hasPosPrintToggles(permissionDraft) && POS_PRINT_PERMISSION_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-text">
                      <input type="checkbox" checked={permissionDraft.includes(key)} onChange={(event) => updatePrintPermission(key, event.target.checked)} />
                      {key === 'pos_print_sale' ? 'Print sale receipts' : 'Print payment receipts'}
                    </label>
                  ))}
                  {permissionDraft.includes('settings') && (
                    <div className="space-y-2 border-t border-border pt-3 sm:col-span-2 lg:col-span-3">
                      <p className="text-xs font-bold text-text">Settings sections this Admin may edit</p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {SETTINGS_SECTION_PERMISSIONS.map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-2 text-sm text-text">
                            <input
                              type="checkbox"
                              checked={permissionDraft.includes(key)}
                              onChange={(event) => updateSettingsSection(key, event.target.checked)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </fieldset>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onSaveAdminPermissions(selectedAdmin, permissionDraft)}
                  className="inline-flex items-center gap-2 rounded-control border border-primary px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50"
                >
                  <Check size={15} /> {saving ? 'Saving…' : 'Save page access'}
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </article>
  );
}
