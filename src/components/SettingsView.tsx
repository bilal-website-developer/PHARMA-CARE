import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Eye,
  Save,
  Printer,
  Sparkles,
  FileText,
  ScrollText,
  ClipboardList,
  Database,
  Store,
  Trash2,
  CheckCircle2,
  MessageSquare,
  QrCode,
} from 'lucide-react';
import {
  BillingTemplate,
  PHARMACY_MEMO_TEST_FIXTURE,
  PharmacyMemoSettings,
  ReceiptFormat,
  renderPharmacyMemo,
  renderReceipt,
  withReceiptTheme,
} from '../utils/receipt';
import { buildPrintSnapshot, PrintReceiptHandler } from '../utils/printWorkflow';
import {
  getPharmacyMemoSettingsValidationMessage,
} from '../utils/storeSettings';
import { checkDemoDataStatus, loadDemoData, removeDemoData } from '../data/demoDataManager';
import type { DemoDataStatus } from '../data/demoMasterData';
import type { ShopProfile } from '../utils/auth';
import {
  removeCurrentShopLogo,
  uploadCurrentShopLogo,
} from '../data/shopProfile';
import type { ShopProfileUpdate } from '../data/shopProfile';
import { shopLogoFileError } from '../utils/shopLogo';
import {
  getReceiptQrSettings,
  normalizeReceiptBaseUrl,
  regenerateReceiptQrForInvoice,
  updateReceiptQrSettings,
  type ReceiptQrLink,
  type ReceiptQrSettings,
} from '../utils/receiptLinks';
import type { ShopOperationalSettings } from '../utils/shopSettings';

const SETTINGS_STORAGE_KEY = 'pharma-care.shopProfile';
type OperationalLimits = Pick<
  ShopOperationalSettings,
  'maxDiscountPaisa' | 'roleDiscountPercentCap' | 'expiryWarningDays'
>;
const DEFAULT_DEBT_TEMPLATE =
  'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!';

interface SavedShopProfile {
  urduFooter: string;
  debtTemplate: string;
}

function readSavedShopProfile(): SavedShopProfile {
  const defaults = {
    urduFooter: 'شکریہ! دوبارہ تشریف لائیں',
    debtTemplate: DEFAULT_DEBT_TEMPLATE,
  };
  try {
    const saved = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return defaults;
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const values = parsed as Partial<SavedShopProfile>;
    return {
      urduFooter: typeof values.urduFooter === 'string' ? values.urduFooter : defaults.urduFooter,
      debtTemplate: typeof values.debtTemplate === 'string' ? values.debtTemplate : defaults.debtTemplate,
    };
  } catch {
    return defaults;
  }
}

interface SettingsViewProps {
  companyName: string;
  shopProfile: ShopProfile | null;
  onUpdateShopProfile: (profile: ShopProfileUpdate) => Promise<ShopProfile>;
  activeTemplate: BillingTemplate;
  canEditShopProfile: boolean;
  isShopAdmin: boolean;
  canManageDemoData: boolean;
  canLoadDemoData: boolean;
  canEditOperationalSettings: boolean;
  canEditOperationalLimits: boolean;
  operationalLimits: OperationalLimits | null;
  onOperationalLimitsChange: (limits: OperationalLimits) => Promise<boolean>;
  canEditReceiptQrSettings: boolean;
  canEditWhatsAppTemplates: boolean;
  canRegenerateReceiptQr: boolean;
  operationalSettingsError: string;
  onTemplateChange: (template: BillingTemplate) => void;
  onOpenTemplatePreview: (template: BillingTemplate) => void;
  memoSettings: PharmacyMemoSettings;
  onMemoSettingsChange: (settings: PharmacyMemoSettings) => Promise<boolean>;
  memoFormat: ReceiptFormat;
  onMemoFormatChange: (format: ReceiptFormat) => void;
  onPrintReceipt: PrintReceiptHandler;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  companyName,
  shopProfile,
  onUpdateShopProfile,
  activeTemplate,
  canEditShopProfile,
  isShopAdmin,
  canManageDemoData,
  canLoadDemoData,
  canEditOperationalSettings,
  canEditOperationalLimits,
  operationalLimits,
  onOperationalLimitsChange,
  canEditReceiptQrSettings,
  canEditWhatsAppTemplates,
  canRegenerateReceiptQr,
  operationalSettingsError,
  onTemplateChange,
  onOpenTemplatePreview,
  memoSettings: savedMemoSettings,
  onMemoSettingsChange,
  memoFormat,
  onMemoFormatChange,
  onPrintReceipt,
}) => {
  const [savedShopProfile, setSavedShopProfile] = useState(readSavedShopProfile);
  const [shopName, setShopName] = useState(companyName);
  const [phone, setPhone] = useState(shopProfile?.phone ?? '');
  const [city, setCity] = useState(shopProfile?.address ?? '');
  const [urduFooter, setUrduFooter] = useState(savedShopProfile.urduFooter);
  const [debtTemplate, setDebtTemplate] = useState(savedShopProfile.debtTemplate);
  const [logoUrl, setLogoUrl] = useState<string>(() => shopProfile?.logoPath ?? '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [memoSettings, setMemoSettings] = useState<PharmacyMemoSettings>(savedMemoSettings);
  const [memoPreviewOpen, setMemoPreviewOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [operationalLimitsDraft, setOperationalLimitsDraft] = useState<OperationalLimits>(
    operationalLimits ?? {
      maxDiscountPaisa: 20000,
      roleDiscountPercentCap: { admin: 30, manager: 15, cashier: 10, accountant: 0 },
      expiryWarningDays: 90,
    },
  );
  const [receiptQrSettings, setReceiptQrSettings] = useState<ReceiptQrSettings | null>(null);
  const [receiptQrError, setReceiptQrError] = useState('');
  const [receiptQrBusy, setReceiptQrBusy] = useState(false);
  const [receiptInvoice, setReceiptInvoice] = useState('');
  const [regeneratedReceiptLink, setRegeneratedReceiptLink] = useState<ReceiptQrLink | null>(null);

  // Demo Data State
  const [demoStatus, setDemoStatus] = useState<DemoDataStatus>({
    loaded: false,
    count: 0,
    supplierActive: false,
  });
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoNotice, setDemoNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  useEffect(() => {
    setMemoSettings(savedMemoSettings);
  }, [savedMemoSettings]);

  useEffect(() => {
    if (operationalLimits) setOperationalLimitsDraft(operationalLimits);
  }, [operationalLimits]);

  useEffect(() => {
    if (!canEditReceiptQrSettings) return;
    let active = true;
    void getReceiptQrSettings().then((settings) => {
      if (active) {
        setReceiptQrSettings(settings);
        setReceiptQrError('');
      }
    }).catch((error: unknown) => {
      if (active) setReceiptQrError(error instanceof Error ? error.message : 'Could not load receipt QR settings.');
    });
    return () => { active = false; };
  }, [canEditReceiptQrSettings]);

  useEffect(() => {
    if (!shopProfile) return;
    setShopName(shopProfile.name || companyName);
    setPhone(shopProfile.phone);
    setCity(shopProfile.address);
    setLogoUrl(shopProfile.logoPath);
    setLogoFile(null);
    setMemoSettings((current) => ({
      ...current,
      storeName: shopProfile.name,
      address: shopProfile.address,
      phone: shopProfile.phone,
      logoUrl: shopProfile.logoPath,
    }));
  }, [companyName, shopProfile?.address, shopProfile?.logoPath, shopProfile?.name, shopProfile?.phone]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl('');
      return;
    }
    const previewUrl = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [logoFile]);

  useEffect(() => {
    if (!isShopAdmin || !canManageDemoData) return undefined;
    let active = true;
    void checkDemoDataStatus()
      .then((status) => {
        if (active) setDemoStatus(status);
      })
      .catch((error: unknown) => {
        if (active) {
          setDemoNotice({
            text: error instanceof Error ? error.message : 'Could not check demo data status.',
            error: true,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [canManageDemoData, isShopAdmin]);

  const handleLoadDemoData = async () => {
    if (!canManageDemoData || !canLoadDemoData) return;
    setDemoBusy(true);
    setDemoNotice(null);
    try {
      const result = await loadDemoData();
      let statusError = '';
      try {
        setDemoStatus(await checkDemoDataStatus());
      } catch (error) {
        statusError = error instanceof Error ? error.message : 'Could not refresh demo-data status.';
      }
      if (result.success) {
        setDemoNotice({
          text: `Demo data loaded successfully! ${result.count} popular medicines, batches, and 1 distributor supplier are ready for showcase.${statusError ? ` Status refresh failed: ${statusError}` : ''}`,
          error: Boolean(statusError),
        });
      } else {
        setDemoNotice({
          text: `${result.error || 'Failed to load demo data.'}${statusError ? ` Status refresh failed: ${statusError}` : ''}`,
          error: true,
        });
      }
    } catch (e) {
      setDemoNotice({ text: e instanceof Error ? e.message : 'Could not load demo data.', error: true });
    } finally {
      setDemoBusy(false);
    }
  };

  const handleSaveReceiptQrSettings = async () => {
    if (!receiptQrSettings) return;
    setReceiptQrBusy(true);
    setReceiptQrError('');
    try {
      const baseUrl = receiptQrSettings.qrBaseUrl.trim();
      if (receiptQrSettings.publicReceiptsEnabled) normalizeReceiptBaseUrl(baseUrl);
      const saved = await updateReceiptQrSettings({ ...receiptQrSettings, qrBaseUrl: baseUrl });
      setReceiptQrSettings(saved);
      setReceiptQrError('Receipt QR settings saved.');
    } catch (error) {
      setReceiptQrError(error instanceof Error ? error.message : 'Could not save receipt QR settings.');
    } finally {
      setReceiptQrBusy(false);
    }
  };

  const handleRegenerateReceiptQr = async () => {
    if (!receiptInvoice.trim()) return;
    setReceiptQrBusy(true);
    setReceiptQrError('');
    setRegeneratedReceiptLink(null);
    try {
      const link = await regenerateReceiptQrForInvoice(receiptInvoice);
      setRegeneratedReceiptLink(link);
      setReceiptQrError(`A new QR link was created. The previous link is revoked. Expires ${new Date(link.expiresAt).toLocaleDateString()}.`);
    } catch (error) {
      setReceiptQrError(error instanceof Error ? error.message : 'Could not regenerate this receipt QR.');
    } finally {
      setReceiptQrBusy(false);
    }
  };

  const handleRemoveDemoData = async () => {
    setDemoBusy(true);
    setDemoNotice(null);
    try {
      const result = await removeDemoData();
      if (result.success) {
        setDemoStatus({ loaded: false, count: 0, supplierActive: false });
        setConfirmRemoveOpen(false);
        setDemoNotice({
          text: `Demo data removed successfully (${result.deletedCount} medicines deactivated). Existing sales and purchase history are preserved.`,
          error: false,
        });
      } else {
        setDemoNotice({ text: result.error || 'Failed to remove demo data.', error: true });
      }
    } catch (e) {
      setDemoNotice({ text: e instanceof Error ? e.message : 'Could not remove demo data.', error: true });
    } finally {
      setDemoBusy(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileError = shopLogoFileError(file);
    if (fileError) {
      setSaveNotice({ text: fileError, error: true });
      return;
    }
    setLogoFile(file);
    setSaveNotice(null);
  };

  const handleRemoveLogo = () => {
    setLogoUrl('');
    setLogoFile(null);
    setMemoSettings((current) => ({ ...current, logoUrl: '' }));
  };
  const displayedLogoUrl = logoPreviewUrl || logoUrl;

  const memoPreview = useMemo(() => {
    try {
      return {
        html: withReceiptTheme(renderPharmacyMemo(
          { ...PHARMACY_MEMO_TEST_FIXTURE, customerName: 'احمد' },
          {
            ...memoSettings,
            storeName: memoSettings.storeName || shopName,
            logoUrl: displayedLogoUrl,
            printLogo: memoSettings.printLogo !== false,
          },
          memoFormat
        )),
        warning: '',
      };
    } catch (error) {
      return {
        html: withReceiptTheme(renderReceipt('classic', memoFormat, {
          storeName: shopName,
          invoiceNo: PHARMACY_MEMO_TEST_FIXTURE.memoNo,
          dateTime: PHARMACY_MEMO_TEST_FIXTURE.dateTime,
          cashierName: 'Sample Cashier',
          customerName: 'احمد',
          paymentMode: 'CASH',
          status: 'PAID',
          logoUrl: displayedLogoUrl,
          items: PHARMACY_MEMO_TEST_FIXTURE.lines.map((line) => ({
            name: line.name,
            batchNo: line.batch ?? '',
            expiry: line.expiry ?? '',
            qty: line.qty,
            unit: '',
            unitPrice: line.ratePaisa,
            lineTotal: line.qty * line.ratePaisa,
          })),
          subtotal: 53116,
          discount: 3116,
          total: 50000,
          paid: 50000,
          change: 0,
          balanceDue: 0,
          footerEnglish: 'Thank you for your business.',
          footerUrdu: 'شکریہ! دوبارہ تشریف لائیں',
        })),
        warning: `Pharmacy Memo preview failed; showing the existing Classic receipt instead. ${error instanceof Error ? error.message : ''}`,
      };
    }
  },
    [displayedLogoUrl, memoFormat, memoSettings, shopName]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedShopName = shopName.trim();
    if (canEditShopProfile && !normalizedShopName) {
      setSavedSuccess(false);
      setSaveNotice({ text: 'Enter a shop name before updating the profile.', error: true });
      return;
    }
    let memoSettingsToSave: PharmacyMemoSettings = {
      ...memoSettings,
      storeName: canEditShopProfile ? normalizedShopName : memoSettings.storeName.trim(),
      logoUrl: canEditShopProfile ? displayedLogoUrl : memoSettings.logoUrl,
      printLogo: memoSettings.printLogo !== false,
    };
    const memoValidationMessage = canEditOperationalSettings
      ? getPharmacyMemoSettingsValidationMessage(memoSettingsToSave)
      : null;
    if (memoValidationMessage) {
      setSavedSuccess(false);
      setSaveNotice({ text: memoValidationMessage, error: true });
      return;
    }

    setSettingsSaving(true);
    let uploadedLogoUrl = '';
    try {
      if (canEditShopProfile) {
        if (logoFile) uploadedLogoUrl = await uploadCurrentShopLogo(logoFile);
        const savedProfile = await onUpdateShopProfile({
          name: normalizedShopName,
          phone: phone.trim(),
          address: city.trim(),
          logoPath: logoFile ? uploadedLogoUrl : logoUrl,
        });

        setShopName(savedProfile.name);
        setPhone(savedProfile.phone);
        setCity(savedProfile.address);
        setLogoUrl(savedProfile.logoPath);
        setLogoFile(null);
        setSavedShopProfile({ urduFooter, debtTemplate });
        memoSettingsToSave = {
          ...memoSettingsToSave,
          storeName: savedProfile.name,
          address: savedProfile.address,
          phone: savedProfile.phone,
          logoUrl: savedProfile.logoPath,
        };
        if (shopProfile?.logoPath && shopProfile.logoPath !== savedProfile.logoPath) {
          try {
            await removeCurrentShopLogo(shopProfile.logoPath);
          } catch (cleanupError) {
            const cleanupMessage = cleanupError instanceof Error
              ? cleanupError.message
              : 'The previous logo could not be removed from Storage.';
            setSaveNotice({ text: `Shop profile was saved, but ${cleanupMessage}`, error: true });
            setSavedSuccess(false);
            return;
          }
        }
      }
      if (canEditShopProfile || canEditWhatsAppTemplates) {
        const nextSavedShopProfile = {
          urduFooter: canEditShopProfile ? urduFooter : savedShopProfile.urduFooter,
          debtTemplate: canEditWhatsAppTemplates ? debtTemplate : savedShopProfile.debtTemplate,
        };
        try {
          globalThis.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSavedShopProfile));
        } catch {
          setSavedSuccess(false);
          setSaveNotice({
            text: 'Server settings were saved, but browser-local settings could not be saved on this device.',
            error: true,
          });
          return;
        }
        setSavedShopProfile(nextSavedShopProfile);
      }
      if (canEditOperationalSettings && !await onMemoSettingsChange(memoSettingsToSave)) {
        setSavedSuccess(false);
        setSaveNotice({
          text: 'Shop profile was saved, but shared shop settings could not be saved. Review the error and try again.',
          error: true,
        });
        return;
      }
      setMemoSettings(memoSettingsToSave);
      setSaveNotice(null);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Could not save the shop profile.';
      if (uploadedLogoUrl) {
        try {
          await removeCurrentShopLogo(uploadedLogoUrl);
        } catch (cleanupError) {
          message += ` The newly uploaded logo could not be removed: ${cleanupError instanceof Error ? cleanupError.message : 'Storage cleanup failed.'}`;
        }
      }
      setSavedSuccess(false);
      setSaveNotice({ text: message, error: true });
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSaveMemoSettings = async () => {
    const nextMemoSettings = {
      ...memoSettings,
      storeName: canEditShopProfile ? shopName.trim() : memoSettings.storeName.trim(),
      logoUrl: canEditShopProfile ? logoUrl : memoSettings.logoUrl,
      printLogo: memoSettings.printLogo !== false,
    };

    const validationMessage = getPharmacyMemoSettingsValidationMessage(nextMemoSettings);
    if (validationMessage) {
      setSaveNotice({ text: validationMessage, error: true });
      return;
    }

    setSettingsSaving(true);
    try {
      if (!await onMemoSettingsChange(nextMemoSettings)) {
        setSaveNotice({ text: 'Shared shop settings could not be saved. Review the error and try again.', error: true });
        return;
      }
      setMemoSettings(nextMemoSettings);
      setSaveNotice(null);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSaveOperationalLimits = async () => {
    if (!operationalLimits || !canEditOperationalLimits) return;
    const { maxDiscountPaisa, expiryWarningDays, roleDiscountPercentCap } = operationalLimitsDraft;
    if (!Number.isInteger(maxDiscountPaisa) || maxDiscountPaisa < 0 || maxDiscountPaisa > 20000
      || !Number.isInteger(expiryWarningDays) || expiryWarningDays < 1 || expiryWarningDays > 365
      || !Number.isFinite(roleDiscountPercentCap.admin) || roleDiscountPercentCap.admin < 0 || roleDiscountPercentCap.admin > 30
      || !Number.isFinite(roleDiscountPercentCap.manager) || roleDiscountPercentCap.manager < 0 || roleDiscountPercentCap.manager > 15
      || !Number.isFinite(roleDiscountPercentCap.cashier) || roleDiscountPercentCap.cashier < 0 || roleDiscountPercentCap.cashier > 10
      || roleDiscountPercentCap.accountant !== 0) {
      setSaveNotice({ text: 'Operational limits are outside the allowed ranges.', error: true });
      setSavedSuccess(false);
      return;
    }

    setSettingsSaving(true);
    try {
      if (!await onOperationalLimitsChange(operationalLimitsDraft)) {
        setSaveNotice({ text: 'Operational limits could not be saved. Review the error and try again.', error: true });
        setSavedSuccess(false);
        return;
      }
      setSaveNotice(null);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl mx-auto pb-8">
      {operationalSettingsError && (
        <p role="alert" className="rounded-control border border-warning bg-warning/15 px-3 py-2 text-sm font-semibold text-text">
          {operationalSettingsError}
        </p>
      )}
      {/* ── Shop Profile ─────────────────────────────────────────────────── */}
      <div className="space-y-4 rounded-card border border-border bg-white p-6 shadow-xs">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-text">
            <Store size={16} className="text-primary" /> Shop Profile
          </h2>
          <p className="text-xs text-muted">This information will appear on your prints and invoices.</p>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-text">Store / Shop Name</label>
              {!canEditShopProfile && (
                <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  Shop Admin Only
                </span>
              )}
            </div>
            <input
              type="text"
              value={shopName}
              disabled={!canEditShopProfile}
              onChange={(e) => {
                setShopName(e.target.value);
                setMemoSettings((current) => ({ ...current, storeName: e.target.value }));
              }}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 font-medium text-text disabled:opacity-60 disabled:cursor-not-allowed"
            />
            {!canEditShopProfile && (
              <p className="mt-1 text-[11px] text-muted">Only the Shop Admin can edit the shop name.</p>
            )}
          </div>

          {/* Shop Logo upload */}
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-text">Shop Logo</label>
              {!canEditShopProfile && (
                <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  Shop Admin Only
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-32 items-center justify-center rounded-lg border border-dashed border-border bg-surface p-1">
                {displayedLogoUrl ? (
                  <img src={displayedLogoUrl} alt="Shop Logo Preview" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted">No custom logo</span>
                )}
              </div>
              {canEditShopProfile ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-control border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface">
                      <span>{displayedLogoUrl ? 'Change Logo' : 'Upload Logo'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleLogoUpload}
                      />
                    </label>
                    {displayedLogoUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="rounded-control border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Remove Logo
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted">
                    Supports PNG, JPG, and WebP (max 2MB). Appears in the top header and on printed slips.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  Only the Shop Admin can edit the shop profile and logo.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="mb-1 block font-semibold text-text">Contact Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={!canEditShopProfile}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 font-medium text-text disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-text">Location / City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={!canEditShopProfile}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 font-medium text-text disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Invoice Footer & Urdu Text (Matching Screenshot 50) ────────────── */}
      <div className="space-y-3 rounded-card border border-border bg-white p-6 shadow-xs">
        <h3 className="text-sm font-black text-text">Invoice Footers &amp; Urdu Greeting</h3>
        <div>
          <label className="mb-1 block text-xs font-semibold text-text">
            Invoice Footer (Urdu/English)
          </label>
          <input
            type="text"
            value={urduFooter}
            onChange={(e) => setUrduFooter(e.target.value)}
            disabled={!canEditShopProfile}
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-right font-serif text-sm text-text disabled:cursor-not-allowed disabled:opacity-60"
            dir="rtl"
          />
        </div>
      </div>

      {/* ── Billing Template Selection (Matching Screenshot 54, 55, 67, 75) ── */}
      <div className="bg-white p-5 sm:p-6 rounded-card border border-border shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h3 className="text-sm font-black text-text">Billing Template</h3>
            <p className="mt-1 text-xs text-muted">
              Choose how your receipts and invoices look when printed. Works for 58mm and 80mm thermal and A4.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenTemplatePreview(activeTemplate)}
            className="flex items-center gap-1.5 rounded-control border border-border px-3 py-2 text-xs font-bold text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Sparkles className="h-3.5 w-3.5" /> Quick View Template Preview
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 xl:grid-cols-5">
          {[
            {
              id: 'simple' as const,
              desc: 'Minimal & clean with a compact logo and spacing. Fast to print.',
              icon: FileText,
            },
            {
              id: 'classic' as const,
              desc: 'Standard receipt style with logo, dashed lines and item table. Recommended.',
              icon: ScrollText,
            },
            {
              id: 'professional' as const,
              desc: 'Full invoice look: letterhead, invoice number box, PAID stamp, signature line.',
              icon: ClipboardList,
            },
            {
              id: 'modern' as const,
              desc: 'Elegant & spacious. Clean sans-serif font, thin borders, cards for totals.',
              icon: Sparkles,
            },
            {
              id: 'pharmacy-memo' as const,
              desc: 'Cash-memo slip layout for 58mm and 80mm thermal paper.',
              icon: ScrollText,
            },
          ].map((tmpl) => (
            <div
              key={tmpl.id}
              className={`flex min-w-0 flex-col justify-between rounded-card border p-4 shadow-xs transition ${
                activeTemplate === tmpl.id
                  ? 'border-2 border-primary bg-surface'
                  : 'border-border bg-white'
              }`}
            >
              <div>
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-control bg-surface text-primary">
                  <tmpl.icon size={18} aria-hidden="true" />
                </span>
                <span className="flex min-h-6 flex-wrap items-center gap-2 font-bold capitalize text-text">
                  {tmpl.id}
                  {activeTemplate === tmpl.id && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase text-white">
                      Active
                    </span>
                  )}
                </span>
                <p className="mt-2 min-h-16 text-[11px] leading-relaxed text-muted">
                  {tmpl.desc}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => onTemplateChange(tmpl.id)}
                  disabled={!canEditOperationalSettings}
                  className={`min-w-20 flex-1 rounded-control px-2 py-2 text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    activeTemplate === tmpl.id
                      ? 'bg-primary text-white'
                      : 'border border-border bg-white text-text hover:bg-surface'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {activeTemplate === tmpl.id ? 'Selected' : 'Select'}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenTemplatePreview(tmpl.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-control border border-border px-2 py-2 text-[10px] font-semibold text-text hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  title="Preview"
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <section className="space-y-4 rounded-card border border-border bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-black text-text">Pharmacy Memo slip</h3>
            <p className="mt-1 text-xs text-muted">Configure the shared cash-memo header, notes, and print behavior for this shop.</p>
          </div>
          <button type="button" onClick={() => onOpenTemplatePreview('pharmacy-memo')} className="rounded-control border border-border px-3 py-2 text-xs font-bold text-primary hover:bg-surface">
            <Eye className="mr-1 inline h-3.5 w-3.5" /> Open full preview
          </button>
        </div>
        {!canEditOperationalSettings && <p role="status" className="rounded-control bg-surface px-3 py-2 text-xs text-muted">Shared settings are unavailable until they load, or your account does not have the Receipt and Memo section grant.</p>}
        <fieldset disabled={!canEditOperationalSettings || settingsSaving} className="space-y-4 disabled:opacity-70">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-text">Memo store name
              <input className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={memoSettings.storeName} onChange={(event) => setMemoSettings({ ...memoSettings, storeName: event.target.value })} />
            </label>
            <label className="text-xs font-semibold text-text">Terminal name
              <input className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={memoSettings.terminalName} onChange={(event) => setMemoSettings({ ...memoSettings, terminalName: event.target.value })} />
            </label>
            <label className="text-xs font-semibold text-text">Address
              <input className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={memoSettings.address} onChange={(event) => setMemoSettings({ ...memoSettings, address: event.target.value })} />
            </label>
            <label className="text-xs font-semibold text-text">Phone
              <input className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={memoSettings.phone} onChange={(event) => setMemoSettings({ ...memoSettings, phone: event.target.value })} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-text">Round net to nearest
              <select className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={memoSettings.roundNet} onChange={(event) => setMemoSettings({ ...memoSettings, roundNet: event.target.value as PharmacyMemoSettings['roundNet'] })}>
                <option value="none">No rounding</option><option value="1">Rs 1</option><option value="5">Rs 5</option><option value="10">Rs 10</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-text">Memo number digits
              <input type="number" min="1" max="20" step="1" className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={memoSettings.numberDigits} onChange={(event) => setMemoSettings({ ...memoSettings, numberDigits: Number(event.target.value) })} />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ['printLogo', 'Print shop logo on slips'],
              ['showBatchNumber', 'Print batch number'],
              ['showExpiryDate', 'Print expiry date'],
              ['printTax', 'Print sales tax row'],
              ['duplicateLabel', 'Label reprints as DUPLICATE'],
              ['autoPrint', 'Auto-print after completing a sale'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs font-semibold text-text">
                <input
                  type="checkbox"
                  checked={Boolean(key === 'printLogo' ? memoSettings.printLogo !== false : memoSettings[key as keyof PharmacyMemoSettings])}
                  onChange={(event) => setMemoSettings({ ...memoSettings, [key]: event.target.checked })}
                  className="accent-[var(--primary)]"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-text">Memo notes (three printed lines)</h4>
            {memoSettings.notes.map((note, index) => (
              <label key={index} className="block text-xs font-semibold text-text">Note {index + 1}
                <input className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={note} onChange={(event) => {
                  const notes = [...memoSettings.notes] as PharmacyMemoSettings['notes'];
                  notes[index] = event.target.value;
                  setMemoSettings({ ...memoSettings, notes });
                }} />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <label className="text-xs font-semibold text-text">Test print format
            <select disabled={!canEditOperationalSettings} className="ml-2 rounded-control border border-border bg-surface px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60" value={memoFormat} onChange={(event) => onMemoFormatChange(event.target.value as ReceiptFormat)}>
              <option value="thermal58">Thermal 58mm</option><option value="thermal80">Thermal 80mm</option><option value="a4">A4</option>
            </select>
          </label>
          <button type="button" onClick={() => setMemoPreviewOpen((open) => !open)} className="rounded-control border border-border px-3 py-2 text-xs font-bold text-text hover:bg-surface">
            {memoPreviewOpen ? 'Hide live preview' : 'Show live preview'}
          </button>
          <button type="button" disabled={!canEditOperationalSettings || settingsSaving} onClick={() => { void handleSaveMemoSettings(); }} className="rounded-control bg-primary px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            <Save className="mr-1 inline h-3.5 w-3.5" /> Save memo settings
          </button>
          <button type="button" onClick={() => {
            void onPrintReceipt('sale', buildPrintSnapshot(
              PHARMACY_MEMO_TEST_FIXTURE,
              {
                ...memoSettings,
                storeName: memoSettings.storeName || shopName,
                logoUrl,
                printLogo: memoSettings.printLogo !== false,
              },
              memoFormat,
              'pharmacy-memo',
            )).catch((error: unknown) => {
              window.alert(`Test slip printing failed. ${error instanceof Error ? error.message : 'The print document could not be opened.'}`);
            });
          }} className="rounded-control border border-primary/30 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10">
            <Printer className="mr-1 inline h-3.5 w-3.5" /> Print test slip
          </button>
        </div>
        <p className="text-[11px] text-muted">Printer notes: select the thermal printer, set the matching 58mm or 80mm roll, margins None, scale 100%, and turn headers and footers off.</p>
        {memoPreviewOpen && <>
          {memoPreview.warning && <p role="status" className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text">{memoPreview.warning}</p>}
          <iframe title="Live Pharmacy Memo preview" srcDoc={memoPreview.html} className="h-[520px] w-full rounded-control border border-border bg-white" />
        </>}
      </section>

      <section className="space-y-4 rounded-card border border-border bg-white p-5 shadow-xs sm:p-6">
        <div className="border-b border-border pb-3">
          <h3 className="text-sm font-black text-text">Operational limits</h3>
          <p className="mt-1 text-xs text-muted">Control discount limits by role and the stock expiry warning period.</p>
        </div>
        {!operationalLimits ? (
          <p role="status" className="rounded-control bg-surface px-3 py-2 text-xs text-muted">
            Shared operational limits are still loading or unavailable.
          </p>
        ) : !canEditOperationalLimits ? (
          <p role="status" className="rounded-control bg-surface px-3 py-2 text-xs text-muted">
            You do not have the Operational Limits section grant.
          </p>
        ) : null}
        <fieldset disabled={!canEditOperationalLimits || !operationalLimits || settingsSaving} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 disabled:opacity-70">
          <label className="text-xs font-semibold text-text">Maximum discount (Rs)
            <input type="number" min={0} max={200} step={0.01} className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={operationalLimitsDraft.maxDiscountPaisa / 100} onChange={(event) => setOperationalLimitsDraft((current) => ({ ...current, maxDiscountPaisa: Math.round(Number(event.target.value) * 100) }))} />
          </label>
          <label className="text-xs font-semibold text-text">Expiry warning (days)
            <input type="number" min={1} max={365} step={1} className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm" value={operationalLimitsDraft.expiryWarningDays} onChange={(event) => setOperationalLimitsDraft((current) => ({ ...current, expiryWarningDays: Number(event.target.value) }))} />
          </label>
          {(['admin', 'manager', 'cashier', 'accountant'] as const).map((role) => (
            <label key={role} className="text-xs font-semibold capitalize text-text">{role} discount cap (%)
              <input type="number" disabled={role === 'accountant'} min={0} max={role === 'admin' ? 30 : role === 'manager' ? 15 : role === 'cashier' ? 10 : 0} step={0.1} className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm disabled:opacity-60" value={operationalLimitsDraft.roleDiscountPercentCap[role]} onChange={(event) => setOperationalLimitsDraft((current) => ({
                ...current,
                roleDiscountPercentCap: { ...current.roleDiscountPercentCap, [role]: Number(event.target.value) },
              }))} />
            </label>
          ))}
        </fieldset>
        <button type="button" disabled={!canEditOperationalLimits || !operationalLimits || settingsSaving} onClick={() => void handleSaveOperationalLimits()} className="rounded-control bg-primary px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Save className="mr-1 inline h-3.5 w-3.5" /> Save operational limits
        </button>
      </section>

      <section className="space-y-4 rounded-card border border-border bg-white p-5 shadow-xs sm:p-6">
        <div className="flex items-start gap-3 border-b border-border pb-3">
          <QrCode className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-black text-text">Receipt QR codes</h3>
            <p className="mt-1 text-xs text-muted">
              Public links are off by default. Anyone with an enabled link can view the receipt, including allocated Batch No. and Expiry, until it expires or is revoked.
            </p>
          </div>
        </div>
        {!canEditReceiptQrSettings && (
          <p role="status" className="rounded-control bg-surface px-3 py-2 text-xs text-muted">
            Managers with Settings access and Admins granted the Receipt QR section can edit these settings.
          </p>
        )}
        {canEditReceiptQrSettings && !receiptQrSettings && !receiptQrError && (
          <p role="status" className="text-xs text-muted">Loading receipt QR settings…</p>
        )}
        {receiptQrError && (
          <p role="status" className="rounded-control border border-border bg-surface px-3 py-2 text-xs text-text">
            {receiptQrError}
          </p>
        )}
        {canEditReceiptQrSettings && receiptQrSettings && (
          <>
            <fieldset disabled={receiptQrBusy} className="grid gap-3 sm:grid-cols-2 disabled:opacity-70">
              <label className="flex items-center gap-2 text-xs font-semibold text-text sm:col-span-2">
                <input
                  type="checkbox"
                  checked={receiptQrSettings.publicReceiptsEnabled}
                  onChange={(event) => setReceiptQrSettings({
                    ...receiptQrSettings,
                    publicReceiptsEnabled: event.target.checked,
                  })}
                  className="accent-[var(--primary)]"
                />
                Enable public receipt links for this shop
              </label>
              <label className="text-xs font-semibold text-text">
                Public app URL (HTTPS origin)
                <input
                  type="url"
                  maxLength={255}
                  value={receiptQrSettings.qrBaseUrl}
                  placeholder="https://your-pharmacy-app.example"
                  onChange={(event) => setReceiptQrSettings({
                    ...receiptQrSettings,
                    qrBaseUrl: event.target.value,
                  })}
                  className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-semibold text-text">
                Link lifetime (days)
                <input
                  type="number"
                  min="1"
                  max="3650"
                  step="1"
                  value={receiptQrSettings.linkLifetimeDays}
                  onChange={(event) => setReceiptQrSettings({
                    ...receiptQrSettings,
                    linkLifetimeDays: Number(event.target.value),
                  })}
                  className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-semibold text-text">
                QR placement
                <select
                  value={receiptQrSettings.qrPlacement}
                  onChange={(event) => setReceiptQrSettings({
                    ...receiptQrSettings,
                    qrPlacement: event.target.value as ReceiptQrSettings['qrPlacement'],
                  })}
                  className="mt-1 w-full rounded-control border border-border bg-surface px-3 py-2 text-sm"
                >
                  <option value="footer">Above footer line (recommended)</option>
                  <option value="after_totals">After totals</option>
                  <option value="below_header">Below shop header</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-text sm:col-span-2">
                <input
                  type="checkbox"
                  checked={receiptQrSettings.showMedicineNames}
                  onChange={(event) => setReceiptQrSettings({
                    ...receiptQrSettings,
                    showMedicineNames: event.target.checked,
                  })}
                  className="accent-[var(--primary)]"
                />
                Show medicine names on public receipts
              </label>
            </fieldset>
            <button
              type="button"
              disabled={receiptQrBusy}
              onClick={() => { void handleSaveReceiptQrSettings(); }}
              className="rounded-control bg-primary px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="mr-1 inline h-3.5 w-3.5" /> Save receipt QR settings
            </button>
          </>
        )}
        {canRegenerateReceiptQr && (
          <div className="space-y-2 border-t border-border pt-3">
            <h4 className="text-xs font-bold text-text">Regenerate a receipt QR</h4>
            <p className="text-xs text-muted">Enter the invoice number. The old QR link will stop working immediately.</p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={receiptInvoice}
                onChange={(event) => setReceiptInvoice(event.target.value)}
                placeholder="Invoice number"
                className="min-w-52 flex-1 rounded-control border border-border bg-surface px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={receiptQrBusy || !receiptInvoice.trim()}
                onClick={() => { void handleRegenerateReceiptQr(); }}
                className="rounded-control border border-primary px-3 py-2 text-xs font-bold text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <QrCode className="mr-1 inline h-3.5 w-3.5" /> Regenerate QR
              </button>
            </div>
            {regeneratedReceiptLink && (
              <p className="break-all rounded-control bg-surface px-3 py-2 text-xs text-text">
                New receipt link: <a className="text-primary underline" href={regeneratedReceiptLink.publicUrl}>{regeneratedReceiptLink.publicUrl}</a>
              </p>
            )}
          </div>
        )}
      </section>


      {/* ── WhatsApp Messaging Templates (Matching Screenshot 51 & 52) ────── */}
      <div className="space-y-3 rounded-card border border-border bg-white p-6 shadow-xs">
        <h3 className="flex items-center gap-2 text-sm font-black text-text">
          <MessageSquare size={16} className="text-primary" />
          <span>WhatsApp Messaging Templates</span>
        </h3>
        <p className="text-xs text-muted">
          Variables: <code>[Name]</code>, <code>[Shop Name]</code>, <code>[Amount]</code>, <code>[ID]</code>
        </p>

        <div className="text-xs space-y-2">
          <label className="block font-semibold text-text">Debt Reminder Template</label>
          <textarea
            rows={3}
            value={debtTemplate}
            onChange={(e) => setDebtTemplate(e.target.value)}
            disabled={!canEditWhatsAppTemplates}
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-text disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </div>

      {/* ── Demo Data & Client Showcase (Load / Remove) ────────────────────── */}
      {isShopAdmin && <div className="space-y-4 rounded-card border border-border bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black text-text">
              <Database className="h-4 w-4 text-primary" />
              Demo Data & Client Showcase
            </h3>
            <p className="mt-1 text-xs text-muted">
              Add 12 popular Pakistani retail medicines (Panadol, Augmentin, Risek, Brufen, Arinac, Flagyl, Disprin, etc.) with real prices, barcodes, stock batches, and 1 distributor supplier for client demonstrations.
            </p>
          </div>
          <div>
            {demoStatus.loaded ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {demoStatus.count > 0
                  ? `Demo Data Active (${demoStatus.count} medicines${demoStatus.supplierActive ? ' + supplier' : ''})`
                  : 'Partial Demo Data Active (supplier only)'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 border border-slate-200">
                No Demo Data Loaded
              </span>
            )}
          </div>
        </div>

        {!canManageDemoData && (
          <p role="status" className="rounded-control bg-surface px-3 py-2 text-xs text-muted">
            Grant this Admin the Products, Suppliers, and Purchases pages to load or remove shared demo data.
          </p>
        )}
        {canManageDemoData && !canLoadDemoData && (
          <p role="status" className="rounded-control bg-surface px-3 py-2 text-xs text-muted">
            Grant this Admin the Categories page to load demo data. Loading creates or activates the required shop categories and manufacturers.
          </p>
        )}

        {demoNotice && (
          <div
            role={demoNotice.error ? 'alert' : 'status'}
            className={`rounded-control border px-4 py-2.5 text-xs font-semibold ${
              demoNotice.error
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {demoNotice.text}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
          <button
            type="button"
            disabled={demoBusy || !canManageDemoData || !canLoadDemoData}
            onClick={handleLoadDemoData}
            className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {demoBusy ? 'Loading Demo Data…' : 'Load Demo Data (12 Medicines + Supplier)'}
          </button>

          {canManageDemoData && (
            <button
              type="button"
              disabled={demoBusy}
              onClick={() => setConfirmRemoveOpen(true)}
              className="inline-flex items-center gap-2 rounded-control border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Remove / Clean Up Demo Data
            </button>
          )}
        </div>

        {confirmRemoveOpen && (
          <div className="rounded-control border border-red-200 bg-red-50/70 p-4 space-y-3">
            <p className="text-xs font-bold text-red-900">
              Are you sure you want to remove all demo medicines and suppliers?
            </p>
            <p className="text-[11px] text-red-700">
              Demo medicines will be deactivated so they disappear from Products and POS. Related purchase and sales history is preserved; real products are not changed. Any categories and manufacturers added for the demo remain as reusable shop master data.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={demoBusy || !canManageDemoData}
                onClick={handleRemoveDemoData}
                className="rounded-control bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Yes, Remove Demo Data
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemoveOpen(false)}
                className="rounded-control border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>}

      {/* ── Bottom Save Strip ──────────────────────────────────────────────── */}
      <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-card border border-border bg-white p-4 shadow-sm">
        <div className="text-xs text-muted">
          {saveNotice ? (
            <span role={saveNotice.error ? 'alert' : 'status'} className={saveNotice.error ? 'font-semibold text-red-700' : 'font-bold text-primary'}>
              {saveNotice.text}
            </span>
          ) : savedSuccess ? (
            <span className="flex items-center gap-1 font-bold text-primary">
              <Check className="w-4 h-4" />
              {canEditOperationalSettings || canEditOperationalLimits
                ? 'Shared settings saved successfully.'
                : canEditShopProfile
                  ? 'Shop profile saved successfully.'
                  : 'Browser-local settings saved.'}
            </span>
          ) : (
            'Make changes and click Update Profile.'
          )}
        </div>

        <button
          type="submit"
          disabled={settingsSaving || (!canEditShopProfile && !canEditOperationalSettings && !canEditWhatsAppTemplates)}
          className="flex items-center gap-1.5 rounded-control bg-primary px-6 py-2.5 text-xs font-black text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> Update Profile
        </button>
      </div>
    </form>
  );
};
