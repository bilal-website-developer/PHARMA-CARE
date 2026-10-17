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
  Trash2,
  CheckCircle2,
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
import { readShopLogo, saveShopLogo } from '../utils/storeSettings';
import { checkDemoDataStatus, loadDemoData, removeDemoData } from '../data/demoDataManager';

const SETTINGS_STORAGE_KEY = 'pharma-care.shopProfile';
const DEFAULT_DEBT_TEMPLATE =
  'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!';

interface SavedShopProfile {
  phone: string;
  city: string;
  urduFooter: string;
  debtTemplate: string;
  logoUrl?: string;
}

function readSavedShopProfile(): SavedShopProfile {
  const fallbackLogo = readShopLogo();
  const defaults = {
    phone: '',
    city: '',
    urduFooter: 'شکریہ! دوبارہ تشریف لائیں',
    debtTemplate: DEFAULT_DEBT_TEMPLATE,
    logoUrl: fallbackLogo,
  };
  try {
    const saved = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return defaults;
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const values = parsed as Partial<SavedShopProfile>;
    return {
      phone: typeof values.phone === 'string' ? values.phone : defaults.phone,
      city: typeof values.city === 'string' ? values.city : defaults.city,
      urduFooter: typeof values.urduFooter === 'string' ? values.urduFooter : defaults.urduFooter,
      debtTemplate: typeof values.debtTemplate === 'string' ? values.debtTemplate : defaults.debtTemplate,
      logoUrl: typeof values.logoUrl === 'string' ? values.logoUrl : fallbackLogo,
    };
  } catch {
    return defaults;
  }
}

interface SettingsViewProps {
  companyName: string;
  onSaveCompanyName: (companyName: string) => boolean;
  activeTemplate: BillingTemplate;
  canEditBilling: boolean;
  onTemplateChange: (template: BillingTemplate) => void;
  onOpenTemplatePreview: (template: BillingTemplate) => void;
  memoSettings: PharmacyMemoSettings;
  onMemoSettingsChange: (settings: PharmacyMemoSettings) => boolean;
  memoFormat: ReceiptFormat;
  onMemoFormatChange: (format: ReceiptFormat) => void;
  onPrintReceipt: PrintReceiptHandler;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  companyName,
  onSaveCompanyName,
  activeTemplate,
  canEditBilling,
  onTemplateChange,
  onOpenTemplatePreview,
  memoSettings: savedMemoSettings,
  onMemoSettingsChange,
  memoFormat,
  onMemoFormatChange,
  onPrintReceipt,
}) => {
  const [savedShopProfile] = useState(readSavedShopProfile);
  const [shopName, setShopName] = useState(companyName);
  const [phone, setPhone] = useState(savedShopProfile.phone);
  const [city, setCity] = useState(savedShopProfile.city);
  const [urduFooter, setUrduFooter] = useState(savedShopProfile.urduFooter);
  const [debtTemplate, setDebtTemplate] = useState(savedShopProfile.debtTemplate);
  const [logoUrl, setLogoUrl] = useState<string>(() => savedShopProfile.logoUrl || readShopLogo());
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [memoSettings, setMemoSettings] = useState<PharmacyMemoSettings>(savedMemoSettings);
  const [memoPreviewOpen, setMemoPreviewOpen] = useState(false);

  // Demo Data State
  const [demoStatus, setDemoStatus] = useState<{ loaded: boolean; count: number }>({ loaded: false, count: 0 });
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoNotice, setDemoNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  useEffect(() => {
    void checkDemoDataStatus().then(setDemoStatus);
  }, []);

  const handleLoadDemoData = async () => {
    setDemoBusy(true);
    setDemoNotice(null);
    try {
      const result = await loadDemoData();
      if (result.success) {
        setDemoStatus({ loaded: true, count: result.count });
        setDemoNotice({
          text: `Demo data loaded successfully! ${result.count} popular medicines, batches, and 1 distributor supplier are ready for showcase.`,
          error: false,
        });
      } else {
        setDemoNotice({ text: result.error || 'Failed to load demo data.', error: true });
      }
    } catch (e) {
      setDemoNotice({ text: e instanceof Error ? e.message : 'Could not load demo data.', error: true });
    } finally {
      setDemoBusy(false);
    }
  };

  const handleRemoveDemoData = async () => {
    setDemoBusy(true);
    setDemoNotice(null);
    try {
      const result = await removeDemoData();
      if (result.success) {
        setDemoStatus({ loaded: false, count: 0 });
        setConfirmRemoveOpen(false);
        setDemoNotice({
          text: `Demo data removed successfully (${result.deletedCount} items cleared). Your workspace is clean.`,
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
    if (file.size > 2 * 1024 * 1024) {
      window.alert('Logo file must be smaller than 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') {
        setLogoUrl(result);
        setMemoSettings((current) => ({ ...current, logoUrl: result }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoUrl('');
    setMemoSettings((current) => ({ ...current, logoUrl: '' }));
  };

  const memoPreview = useMemo(() => {
    try {
      return {
        html: withReceiptTheme(renderPharmacyMemo(
          { ...PHARMACY_MEMO_TEST_FIXTURE, customerName: 'احمد' },
          {
            ...memoSettings,
            storeName: memoSettings.storeName || shopName,
            logoUrl,
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
          logoUrl,
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
    [memoFormat, memoSettings, shopName, logoUrl]
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      globalThis.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        phone,
        city,
        urduFooter,
        debtTemplate,
        logoUrl: canEditBilling ? logoUrl : savedShopProfile.logoUrl,
      }));
      if (canEditBilling) {
        saveShopLogo(logoUrl);
      }
    } catch {
      window.alert('Contact phone, location, invoice footer, and reminder template could not be saved in this browser.');
      return;
    }
    if (canEditBilling && !onSaveCompanyName(shopName)) {
      setSavedSuccess(false);
      window.alert('Contact phone, location, invoice footer, and reminder template were saved, but the shop name could not be saved.');
      return;
    }
    if (!onMemoSettingsChange({
      ...memoSettings,
      storeName: canEditBilling ? (memoSettings.storeName.trim() || shopName) : memoSettings.storeName,
      logoUrl: canEditBilling ? logoUrl : memoSettings.logoUrl,
      printLogo: memoSettings.printLogo !== false,
    })) {
      window.alert('Shop details were saved, but Pharmacy Memo settings could not be saved. Check the required fields and browser storage.');
      return;
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl mx-auto pb-8">
      {/* ── Shop Profile ─────────────────────────────────────────────────── */}
      <div className="space-y-4 rounded-card border border-border bg-white p-6 shadow-xs">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-text">
            <span>⚙️</span> Shop Profile
          </h2>
          <p className="text-xs text-muted">This information will appear on your prints and invoices.</p>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-text">Store / Shop Name</label>
              {!canEditBilling && (
                <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  Admin Only
                </span>
              )}
            </div>
            <input
              type="text"
              value={shopName}
              disabled={!canEditBilling}
              onChange={(e) => setShopName(e.target.value)}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 font-medium text-text disabled:opacity-60 disabled:cursor-not-allowed"
            />
            {!canEditBilling && (
              <p className="mt-1 text-[11px] text-muted">Only Admin and Super Admin can edit the shop name.</p>
            )}
          </div>

          {/* Shop Logo upload */}
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-text">Shop Logo</label>
              {!canEditBilling && (
                <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  Admin Only
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-32 items-center justify-center rounded-lg border border-dashed border-border bg-surface p-1">
                {logoUrl ? (
                  <img src={logoUrl} alt="Shop Logo Preview" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted">No custom logo</span>
                )}
              </div>
              {canEditBilling ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-control border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface">
                      <span>{logoUrl ? 'Change Logo' : 'Upload Logo'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        className="hidden"
                        onChange={handleLogoUpload}
                      />
                    </label>
                    {logoUrl && (
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
                    Supports PNG, JPG, SVG, WebP (max 2MB). Appears in the top header and on printed slips.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  Only Admin and Super Admin can upload or change the shop logo.
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
                className="w-full rounded-control border border-border bg-surface px-3 py-2 font-medium text-text"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-text">Location / City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-control border border-border bg-surface px-3 py-2 font-medium text-text"
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
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-right font-serif text-sm text-text"
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
                  disabled={!canEditBilling}
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
            <p className="mt-1 text-xs text-muted">Configure the cash-memo header, notes, and print behavior for this browser.</p>
          </div>
          <button type="button" onClick={() => onOpenTemplatePreview('pharmacy-memo')} className="rounded-control border border-border px-3 py-2 text-xs font-bold text-primary hover:bg-surface">
            <Eye className="mr-1 inline h-3.5 w-3.5" /> Open full preview
          </button>
        </div>
        {!canEditBilling && <p role="status" className="rounded-control bg-surface px-3 py-2 text-xs text-muted">Only Admin can change these settings. You can still view the preview.</p>}
        <fieldset disabled={!canEditBilling} className="space-y-4 disabled:opacity-70">
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
              ['showBatchExpiry', 'Print batch and expiry'],
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
            <select className="ml-2 rounded-control border border-border bg-surface px-2 py-1.5" value={memoFormat} onChange={(event) => onMemoFormatChange(event.target.value as ReceiptFormat)}>
              <option value="thermal58">Thermal 58mm</option><option value="thermal80">Thermal 80mm</option><option value="a4">A4</option>
            </select>
          </label>
          <button type="button" onClick={() => setMemoPreviewOpen((open) => !open)} className="rounded-control border border-border px-3 py-2 text-xs font-bold text-text hover:bg-surface">
            {memoPreviewOpen ? 'Hide live preview' : 'Show live preview'}
          </button>
          <button type="button" disabled={!canEditBilling} onClick={() => {
            if (!onMemoSettingsChange({
              ...memoSettings,
              storeName: memoSettings.storeName.trim() || shopName,
              logoUrl,
              printLogo: memoSettings.printLogo !== false,
            })) {
              window.alert('Could not save Pharmacy Memo settings. Check that the store name, terminal, notes, and digit count are valid.');
              return;
            }
            saveShopLogo(logoUrl);
            setSavedSuccess(true);
            setTimeout(() => setSavedSuccess(false), 2500);
          }} className="rounded-control bg-primary px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
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


      {/* ── WhatsApp Messaging Templates (Matching Screenshot 51 & 52) ────── */}
      <div className="space-y-3 rounded-card border border-border bg-white p-6 shadow-xs">
        <h3 className="flex items-center gap-2 text-sm font-black text-text">
          <span>💬</span> WhatsApp Messaging Templates
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
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-text"
          />
        </div>
      </div>

      {/* ── Demo Data & Client Showcase (Load / Remove) ────────────────────── */}
      <div className="space-y-4 rounded-card border border-border bg-white p-6 shadow-xs">
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
                Demo Data Active ({demoStatus.count} items)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 border border-slate-200">
                No Demo Data Loaded
              </span>
            )}
          </div>
        </div>

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
            disabled={demoBusy}
            onClick={handleLoadDemoData}
            className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {demoBusy ? 'Loading Demo Data…' : 'Load Demo Data (12 Medicines + Supplier)'}
          </button>

          {demoStatus.loaded && (
            <button
              type="button"
              disabled={demoBusy}
              onClick={() => setConfirmRemoveOpen(true)}
              className="inline-flex items-center gap-2 rounded-control border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Remove Demo Data
            </button>
          )}
        </div>

        {confirmRemoveOpen && (
          <div className="rounded-control border border-red-200 bg-red-50/70 p-4 space-y-3">
            <p className="text-xs font-bold text-red-900">
              Are you sure you want to remove all demo medicines and suppliers?
            </p>
            <p className="text-[11px] text-red-700">
              All demo medicines (Panadol, Augmentin, etc.) and demo batches will be permanently removed. Your real pharmacy products and actual sales will remain completely untouched.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={demoBusy}
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
      </div>

      {/* ── Bottom Save Strip ──────────────────────────────────────────────── */}
      <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-card border border-border bg-white p-4 shadow-sm">
        <div className="text-xs text-muted">
          {savedSuccess ? (
            <span className="flex items-center gap-1 font-bold text-primary">
              <Check className="w-4 h-4" /> Shop name, contact phone, location, invoice footer, and reminder template saved in this browser.
            </span>
          ) : (
            'Make changes and click Update Profile.'
          )}
        </div>

        <button
          type="submit"
          className="flex items-center gap-1.5 rounded-control bg-primary px-6 py-2.5 text-xs font-black text-white shadow-md transition hover:opacity-90"
        >
          <Save className="w-4 h-4" /> Update Profile
        </button>
      </div>
    </form>
  );
};
