import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  FlaskConical,
  LogOut,
  Package,
  RotateCcw,
  ShieldAlert,
  ShoppingBag,
  Store,
  Truck,
  Users,
} from 'lucide-react';
import {
  BatchStatus,
  ROLE_LABELS,
  UserRole,
  type CashTransaction,
  type Customer,
} from '../types/pharmacy';
import { SIDEBAR_CATEGORIES } from './sidebarPages';
import {
  getDemoAccountName,
  getDemoRolePermissions,
  getDemoRolePages,
  isDemoPreviewPageKey,
  type DemoPreviewPageKey,
} from '../utils/demoPreview';
import {
  addRoleDemoCustomer,
  appendRoleDemoCustomer,
  createRoleDemoState,
  postRoleDemoPurchase,
  postRoleDemoCheckout,
  readRoleDemoState,
  recordRoleDemoPayment,
  returnRoleDemoSale,
  writeRoleDemoState,
  type DemoPurchaseInput,
  type RoleDemoState,
} from '../utils/roleDemoSandbox';
import { clearRoleDemoSession, ROLE_DEMO_ROLE_KEY } from '../utils/roleDemoStorage';
import { availableSmallestUnits } from '../utils/fefo';
import { initialProductsToPosCatalog } from '../data/posCatalogLogic';
import { DashboardView } from './DashboardView';
import { CashBookScreen } from './CashBookScreen';
import { CustomerLedgerScreen } from './CustomerLedgerScreen';
import { POSBillingView } from './POSBillingView';
import { ReportsScreen } from './ReportsScreen';
import { SalesHistoryView } from './SalesHistoryView';
import { DEFAULT_PHARMACY_MEMO_SETTINGS } from '../utils/receipt';
import type { PrintReceiptHandler } from '../utils/printWorkflow';
import type { NavItemKey } from './Sidebar';
import PharmaLogo from './PharmaLogo';

interface DemoWorkspaceProps {
  role: UserRole;
  onSignOut: () => void;
}

const DEMO_MEMO_SETTINGS = {
  ...DEFAULT_PHARMACY_MEMO_SETTINGS,
  storeName: 'Demo Pharmacy',
};

const simulatePrint: PrintReceiptHandler = async () => 'printed';

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function formatMoney(amountPaisa: number): string {
  return `Rs ${(amountPaisa / 100).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getProductStock(product: RoleDemoState['products'][number]): number {
  return availableSmallestUnits(product.batches);
}

function DemoPanel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-card border border-border bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}

function DemoNotice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={`rounded-control border px-3 py-2 text-sm ${
        error ? 'border-danger/40 bg-danger/10 text-text' : 'border-primary/30 bg-primary/5 text-text'
      }`}
    >
      {children}
    </p>
  );
}

function DemoInventory({ sandbox, stockOnly = false }: { sandbox: RoleDemoState; stockOnly?: boolean }) {
  const [query, setQuery] = useState('');
  const products = sandbox.products.filter((product) =>
    `${product.brandName} ${product.genericName} ${product.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <header>
        <h2 className="flex items-center gap-2 text-xl font-black text-text"><Package size={21} className="text-primary" /> {stockOnly ? 'Stock Inventory' : 'Products'}</h2>
        <p className="mt-1 text-sm text-muted">Demo catalog, batch expiry, and current sellable stock.</p>
      </header>
      <DemoPanel>
        <label className="block text-xs font-semibold text-muted">
          Search products
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 block w-full max-w-sm rounded-control border border-border px-3 py-2 text-sm text-text" placeholder="Product, generic, or category" />
        </label>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-muted"><tr><th className="py-2">Product</th><th>Category</th><th>Batch / expiry</th><th className="text-right">Sellable stock</th><th className="text-right">Reorder at</th></tr></thead>
            <tbody className="divide-y divide-border">
              {products.map((product) => (
                <React.Fragment key={product.id}>
                  <tr>
                    <td className="py-3"><strong className="block text-text">{product.brandName}</strong><span className="text-xs text-muted">{product.genericName}</span></td>
                    <td>{product.category}</td>
                    <td>{product.batches.filter((batch) => batch.status !== BatchStatus.EXPIRED).map((batch) => (
                      <span key={batch.id} className="block text-xs">{batch.batchNumber} · {batch.expiryDate}</span>
                    ))}</td>
                    <td className="text-right font-bold">{getProductStock(product)}</td>
                    <td className="text-right">{product.minStockAlert}</td>
                  </tr>
                  {!stockOnly && product.batches.some((batch) => batch.status === BatchStatus.EXPIRED) && (
                    <tr><td colSpan={5} className="pb-3 text-xs text-danger">{product.batches.filter((batch) => batch.status === BatchStatus.EXPIRED).map((batch) => `Expired ${batch.batchNumber}: ${batch.quantitySmallestUnit} units`).join(' · ')}</td></tr>
                  )}
                </React.Fragment>
              ))}
              {products.length === 0 && <tr><td colSpan={5} className="py-5 text-center text-muted">No demo products match that search.</td></tr>}
            </tbody>
          </table>
        </div>
      </DemoPanel>
    </div>
  );
}

function DemoPurchases({
  sandbox,
  onPurchase,
}: {
  sandbox: RoleDemoState;
  onPurchase: (input: DemoPurchaseInput) => void;
}) {
  const [productId, setProductId] = useState(sandbox.products[0]?.id ?? '');
  const [quantity, setQuantity] = useState(10);
  const [cost, setCost] = useState('28.00');
  const [mrp, setMrp] = useState('35.00');
  const [supplierName, setSupplierName] = useState(sandbox.suppliers[0]?.name ?? '');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onPurchase({
        productId,
        quantity,
        costPaisaPerUnit: Math.round(Number(cost) * 100),
        mrpPaisaPerUnit: Math.round(Number(mrp) * 100),
        supplierName,
      });
      setNotice('Demo purchase posted. A new stock batch and purchase-history record were created.');
      setError('');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The demo purchase could not be posted.');
      setNotice('');
    }
  };

  return (
    <div className="space-y-4">
      <header><h2 className="flex items-center gap-2 text-xl font-black text-text"><ShoppingBag size={21} className="text-primary" /> New Purchase</h2><p className="mt-1 text-sm text-muted">Post a sample supplier purchase to add stock without contacting the live database.</p></header>
      <DemoPanel>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-text">Product<select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 block w-full rounded-control border border-border bg-white px-3 py-2 font-normal">{sandbox.products.map((product) => <option key={product.id} value={product.id}>{product.brandName}</option>)}</select></label>
          <label className="text-sm font-semibold text-text">Supplier<select value={supplierName} onChange={(event) => setSupplierName(event.target.value)} className="mt-1 block w-full rounded-control border border-border bg-white px-3 py-2 font-normal">{sandbox.suppliers.map((supplier) => <option key={supplier.id} value={supplier.name}>{supplier.name}</option>)}</select></label>
          <label className="text-sm font-semibold text-text">Quantity<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-1 block w-full rounded-control border border-border px-3 py-2 font-normal" required /></label>
          <label className="text-sm font-semibold text-text">Cost per pack (Rs)<input type="number" min="0.01" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} className="mt-1 block w-full rounded-control border border-border px-3 py-2 font-normal" required /></label>
          <label className="text-sm font-semibold text-text">Selling price per pack (Rs)<input type="number" min="0.01" step="0.01" value={mrp} onChange={(event) => setMrp(event.target.value)} className="mt-1 block w-full rounded-control border border-border px-3 py-2 font-normal" required /></label>
          <div className="flex items-end justify-end"><button type="submit" className="rounded-control bg-primary px-4 py-2 text-sm font-bold text-white">Post demo purchase</button></div>
        </form>
      </DemoPanel>
      {error && <DemoNotice error>{error}</DemoNotice>}
      {notice && <DemoNotice>{notice}</DemoNotice>}
      <PurchaseHistory sandbox={sandbox} />
    </div>
  );
}

function PurchaseHistory({ sandbox }: { sandbox: RoleDemoState }) {
  return (
    <DemoPanel>
      <h3 className="font-bold text-text">Purchase History</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="text-xs uppercase text-muted"><tr><th className="py-2">Reference</th><th>Date</th><th>Supplier</th><th>Product / qty</th><th className="text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-border">
            {sandbox.purchases.map((purchase) => <tr key={purchase.id}><td className="py-2 font-semibold">{purchase.reference}</td><td>{new Date(purchase.timestamp).toLocaleDateString()}</td><td>{purchase.supplierName}</td><td>{purchase.productName} · {purchase.quantity}</td><td className="text-right">{formatMoney(purchase.totalPaisa)}</td></tr>)}
            {sandbox.purchases.length === 0 && <tr><td colSpan={5} className="py-5 text-center text-muted">No demo purchases yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </DemoPanel>
  );
}

function DemoReturns({
  sandbox,
  role,
  onReturn,
}: {
  sandbox: RoleDemoState;
  role: UserRole;
  onReturn: (saleId: string, productId: string, quantity: number) => void;
}) {
  const [saleId, setSaleId] = useState(sandbox.sales[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const sale = sandbox.sales.find(({ id }) => id === saleId);
  const item = sale?.items[0];
  const canApprove = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sale || !item) return;
    try {
      onReturn(sale.id, item.productId, quantity);
      setNotice('Demo return recorded. Batch stock and the appropriate cash/credit balance were updated.');
      setError('');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The demo return could not be recorded.');
      setNotice('');
    }
  };

  return (
    <DemoPanel className="space-y-3">
      <h3 className="font-bold text-text">Process a sample return</h3>
      {!canApprove ? (
        <p className="text-sm text-muted">Cashier return approvals are disabled in this demo. Switch to an Admin or Manager demo role to simulate approval.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
          <label className="text-xs font-semibold text-muted">Sale<select value={saleId} onChange={(event) => setSaleId(event.target.value)} className="mt-1 block w-full rounded-control border border-border bg-white px-3 py-2 text-sm text-text">{sandbox.sales.map((entry) => <option key={entry.id} value={entry.id}>{entry.invoiceNumber} · {entry.items[0]?.productName}</option>)}</select></label>
          <label className="text-xs font-semibold text-muted">Quantity<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-1 block w-full rounded-control border border-border px-3 py-2 text-sm text-text" /></label>
          <button type="submit" disabled={!sale || !item} className="rounded-control bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Approve demo return</button>
        </form>
      )}
      {error && <DemoNotice error>{error}</DemoNotice>}
      {notice && <DemoNotice>{notice}</DemoNotice>}
      <ul className="divide-y divide-border text-sm">
        {sandbox.returns.slice(0, 5).map((entry) => <li key={entry.id} className="py-2">{entry.invoiceNumber} · {entry.productName} × {entry.quantity} · {formatMoney(entry.refundPaisa)}</li>)}
        {sandbox.returns.length === 0 && <li className="py-2 text-muted">No demo returns yet.</li>}
      </ul>
    </DemoPanel>
  );
}

function DemoReferencePage({
  page,
  sandbox,
  role,
  onAddSupplier,
}: {
  page: DemoPreviewPageKey;
  sandbox: RoleDemoState;
  role: UserRole;
  onAddSupplier: (name: string, phone: string) => void;
}) {
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [notice, setNotice] = useState('');
  const [reminderCustomer, setReminderCustomer] = useState('');
  const categories = [...new Set(sandbox.products.map(({ category }) => category))];

  if (page === 'master-data') {
    return <div className="space-y-4"><header><h2 className="text-xl font-black text-text">Categories & Manufacturers</h2><p className="mt-1 text-sm text-muted">Sample master data referenced by the demo product catalog.</p></header><DemoPanel><div className="grid gap-4 sm:grid-cols-2"><div><h3 className="font-bold text-text">Categories</h3><ul className="mt-2 space-y-2 text-sm">{categories.map((category) => <li key={category} className="rounded-control bg-surface px-3 py-2">{category}</li>)}</ul></div><div><h3 className="font-bold text-text">Manufacturers</h3><ul className="mt-2 space-y-2 text-sm">{[...new Set(sandbox.products.map(({ company }) => company))].map((company) => <li key={company} className="rounded-control bg-surface px-3 py-2">{company}</li>)}</ul></div></div></DemoPanel></div>;
  }
  if (page === 'suppliers') {
    return <div className="space-y-4"><header><h2 className="flex items-center gap-2 text-xl font-black text-text"><Truck size={21} className="text-primary" /> Suppliers</h2><p className="mt-1 text-sm text-muted">Supplier records are local to this demo session.</p></header><DemoPanel><ul className="divide-y divide-border">{sandbox.suppliers.map((supplier) => <li key={supplier.id} className="flex justify-between gap-3 py-3"><span className="font-semibold">{supplier.name}</span><span className="text-muted">{supplier.phone}</span></li>)}</ul></DemoPanel><DemoPanel><form onSubmit={(event) => { event.preventDefault(); if (!supplierName.trim()) { setNotice('Enter a supplier name.'); return; } onAddSupplier(supplierName, supplierPhone); setNotice(`Demo supplier ${supplierName.trim()} added.`); setSupplierName(''); setSupplierPhone(''); }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs font-semibold text-muted">Supplier name<input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} className="mt-1 block w-full rounded-control border border-border px-3 py-2 text-sm" required /></label><label className="text-xs font-semibold text-muted">Phone<input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} className="mt-1 block w-full rounded-control border border-border px-3 py-2 text-sm" /></label><button className="rounded-control bg-primary px-4 py-2 text-sm font-bold text-white">Add demo supplier</button></form>{notice && <p role="status" className="mt-3 text-sm text-primary">{notice}</p>}</DemoPanel></div>;
  }
  if (page === 'whatsapp-reminders') {
    const dueCustomers = sandbox.customers.filter(({ currentBalancePaisa }) => currentBalancePaisa > 0);
    return <div className="space-y-4"><header><h2 className="text-xl font-black text-text">WhatsApp Reminders</h2><p className="mt-1 text-sm text-muted">Preview a reminder without opening WhatsApp or sending a message.</p></header><DemoPanel><ul className="divide-y divide-border">{dueCustomers.map((customer) => <li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span><strong className="block">{customer.name}</strong><span className="text-xs text-muted">Balance {formatMoney(customer.currentBalancePaisa)}</span></span><button type="button" onClick={() => { setReminderCustomer(customer.name); setNotice(`Reminder preview shown for ${customer.name}. No WhatsApp message was sent.`); }} className="rounded-control border border-border px-3 py-2 text-xs font-bold">Preview reminder</button></li>)}</ul>{dueCustomers.length === 0 && <p className="py-3 text-sm text-muted">No customers currently have a balance.</p>}{notice && <p role="status" className="mt-3 rounded-control bg-primary/5 p-3 text-sm">{notice}{reminderCustomer && <span className="mt-2 block">Assalam-o-Alaikum {reminderCustomer}, your pharmacy account balance is ready for review.</span>}</p>}</DemoPanel></div>;
  }
  if (page === 'manage-users') {
    return <div className="space-y-4"><header><h2 className="flex items-center gap-2 text-xl font-black text-text"><Users size={21} className="text-primary" /> Manage Users</h2><p className="mt-1 text-sm text-muted">Sample role directory. Account creation, password changes, and access changes are simulated and disabled.</p></header><DemoPanel><div className="divide-y divide-border">{[UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER, UserRole.ACCOUNTANT].map((demoRole) => <div key={demoRole} className="flex items-center justify-between py-3"><span className="font-semibold">{getDemoAccountName(demoRole)}</span><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{ROLE_LABELS[demoRole]}</span></div>)}</div><button type="button" disabled className="mt-4 rounded-control border border-border px-3 py-2 text-sm text-muted">Account changes disabled in demo</button></DemoPanel></div>;
  }
  if (page === 'shops') {
    return <div className="space-y-4"><header><h2 className="flex items-center gap-2 text-xl font-black text-text"><Store size={21} className="text-primary" /> Platform Shops</h2><p className="mt-1 text-sm text-muted">Super Admin platform preview. Tenant business records are not shown here.</p></header><DemoPanel><div className="flex items-start gap-3"><span className="rounded-control bg-primary/10 p-3 text-primary"><Store size={22} /></span><div><h3 className="font-bold">Demo Pharmacy</h3><p className="text-sm text-muted">Sample shop · active · isolated</p><p className="mt-2 text-xs text-muted">The shop picker and account actions do not connect to Supabase in Role Demo.</p></div></div><button type="button" disabled className="mt-4 rounded-control border border-border px-3 py-2 text-sm text-muted">Shop administration disabled in demo</button></DemoPanel></div>;
  }
  if (page === 'settings') {
    return <div className="space-y-4"><header><h2 className="text-xl font-black text-text">Settings</h2><p className="mt-1 text-sm text-muted">Safe settings preview. No profile, receipt, or tenant settings are changed.</p></header><DemoPanel><div className="grid gap-3 sm:grid-cols-2"><article className="rounded-control bg-surface p-4"><p className="text-xs text-muted">Receipt format</p><p className="mt-1 font-bold">Pharmacy Memo · 80mm</p></article><article className="rounded-control bg-surface p-4"><p className="text-xs text-muted">Expiry warning</p><p className="mt-1 font-bold">90 days</p></article><article className="rounded-control bg-surface p-4"><p className="text-xs text-muted">Shop profile</p><p className="mt-1 font-bold">Demo Pharmacy</p></article><article className="rounded-control bg-surface p-4"><p className="text-xs text-muted">Storage</p><p className="mt-1 font-bold">This browser tab session only</p></article></div></DemoPanel></div>;
  }
  if (page === 'trash-bin') {
    return <div className="space-y-4"><header><h2 className="text-xl font-black text-text">Trash Bin</h2><p className="mt-1 text-sm text-muted">Permanent deletion is disabled in this sandbox.</p></header><DemoPanel><p className="text-sm text-muted">No deleted demo records are waiting to be restored.</p><button disabled className="mt-4 rounded-control border border-border px-3 py-2 text-sm text-muted">Delete/restore actions disabled</button></DemoPanel></div>;
  }
  if (page === 'my-print-requests' || page === 'print-requests') {
    return <div className="space-y-4"><header><h2 className="text-xl font-black text-text">{page === 'my-print-requests' ? 'My Print Requests' : 'Print Requests'}</h2><p className="mt-1 text-sm text-muted">Print approval workflow preview; no real request is created or sent.</p></header><DemoPanel><div className="flex items-start gap-3"><FlaskConical className="mt-0.5 text-primary" /><p className="text-sm text-text">A sample receipt request is available for demonstration. Print approval actions are simulated only.</p></div><button disabled className="mt-4 rounded-control border border-border px-3 py-2 text-sm text-muted">Live print request disabled</button></DemoPanel></div>;
  }
  if (page === 'help-support') {
    return <div className="space-y-4"><header><h2 className="text-xl font-black text-text">Help & Support</h2><p className="mt-1 text-sm text-muted">A guide to exploring the isolated Role Demo.</p></header><DemoPanel><ol className="list-decimal space-y-2 pl-5 text-sm text-text"><li>Make a sale in POS to reduce eligible stock.</li><li>Post a purchase to add a new stock batch.</li><li>Review the sale in Sales History and Business Analytics.</li><li>Record a customer payment or cash expense to update the ledger/cash book.</li><li>Use Reset Demo to return to the original 30-day sample.</li></ol></DemoPanel></div>;
  }
  return <div className="space-y-4"><header><h2 className="text-xl font-black text-text">{getDemoRolePages(role).find(({ key }) => key === page)?.label ?? 'Demo page'}</h2><p className="mt-1 text-sm text-muted">This page is safely previewed with sample information.</p></header><DemoPanel><p className="text-sm text-muted">This feature preview contains no live account, messaging, print, or database actions.</p></DemoPanel></div>;
}

function DemoPlatformDashboard({ role }: { role: UserRole }) {
  return (
    <div className="space-y-5">
      <header><p className="text-xs font-bold uppercase tracking-wide text-muted">Welcome back, {getDemoAccountName(role)}</p><h1 className="mt-1 text-2xl font-black text-text">Platform Overview</h1><p className="mt-1 text-sm text-muted">Super Admin preview · platform data only</p></header>
      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-card border border-border bg-white p-4 shadow-sm"><p className="text-xs text-muted">Demo shops</p><p className="mt-1 text-2xl font-black text-text">1</p></article>
        <article className="rounded-card border border-border bg-white p-4 shadow-sm"><p className="text-xs text-muted">Sample roles</p><p className="mt-1 text-2xl font-black text-text">4</p></article>
        <article className="rounded-card border border-border bg-white p-4 shadow-sm"><p className="text-xs text-muted">Tenant data access</p><p className="mt-1 font-bold text-primary">Not available</p></article>
      </section>
    </div>
  );
}

export function DemoWorkspace({ role, onSignOut }: DemoWorkspaceProps) {
  const [activePage, setActivePage] = useState<DemoPreviewPageKey>('dashboard');
  const [initialLoad] = useState(() => {
    const storage = getSessionStorage();
    return storage
      ? readRoleDemoState(storage)
      : { state: createRoleDemoState(), warning: 'Session storage is unavailable; demo changes will not survive a refresh.' };
  });
  const [sandbox, setSandbox] = useState(initialLoad.state);
  const [storageWarning, setStorageWarning] = useState(initialLoad.warning);
  const [actionNotice, setActionNotice] = useState('');
  const pages = useMemo(() => getDemoRolePages(role), [role]);
  const activePageDefinition = pages.find((page) => page.key === activePage);
  const accountName = getDemoAccountName(role);
  const allowedPageKeys = useMemo(() => new Set(pages.map(({ key }) => key)), [pages]);
  const demoCatalog = useMemo(() => initialProductsToPosCatalog(sandbox.products), [sandbox.products]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const storage = getSessionStorage();
    if (!storage) {
      setStorageWarning('Session storage is unavailable; demo changes will not survive a refresh.');
      return;
    }
    try {
      storage.setItem(ROLE_DEMO_ROLE_KEY, role);
    } catch (error) {
      setStorageWarning(`Demo role could not be saved for this browser session. ${error instanceof Error ? error.message : ''}`.trim());
    }
    const warning = writeRoleDemoState(storage, sandbox);
    if (warning) setStorageWarning(warning);
  }, [role, sandbox]);

  const handlePurchase = (input: DemoPurchaseInput) => {
    const next = postRoleDemoPurchase(sandbox, input);
    setSandbox(next);
  };

  const handlePayment = async (customerId: string, amountPaisa: number, note: string) => {
    const payment = recordRoleDemoPayment(sandbox, customerId, amountPaisa, note);
    setSandbox(payment.state);
    return {
      referenceNo: payment.referenceNo,
      dateTime: payment.dateTime,
      balanceAfterPaisa: payment.balanceAfterPaisa,
    };
  };

  const handleAddCustomer = async (input: {
    name: string;
    phone: string;
    cnic: string;
    address: string;
    creditLimitPaisa: number;
  }): Promise<Customer> => {
    const customer = addRoleDemoCustomer(sandbox, input);
    setSandbox(appendRoleDemoCustomer(sandbox, customer));
    return customer;
  };

  const handleAddExpense = (transaction: CashTransaction) => {
    const amountPaisa = Math.round(transaction.amountPaisa);
    if (!Number.isSafeInteger(amountPaisa) || amountPaisa <= 0) {
      setActionNotice('Enter a valid expense amount in rupees.');
      return;
    }
    setSandbox((current) => ({
      ...current,
      transactions: [{ ...transaction, amountPaisa }, ...current.transactions],
    }));
  };

  const resetDemo = () => {
    setSandbox(createRoleDemoState());
    setActionNotice('Demo data reset to the original 30-day sample.');
  };

  const exitDemo = () => {
    const storage = getSessionStorage();
    if (!storage) {
      onSignOut();
      return;
    }
    const warning = clearRoleDemoSession(storage);
    if (warning) {
      setStorageWarning(warning);
      return;
    }
    onSignOut();
  };

  const renderActivePage = () => {
    if (activePage === 'dashboard' && role === UserRole.SUPER_ADMIN) return <DemoPlatformDashboard role={role} />;
    if (activePage === 'dashboard') {
      return <DashboardView
        sales={sandbox.sales}
        products={sandbox.products}
        customers={sandbox.customers}
        currentRole={role}
        currentUserName={accountName}
        onNavigate={(tab: NavItemKey) => { if (isDemoPreviewPageKey(tab) && allowedPageKeys.has(tab)) setActivePage(tab); }}
        onOpenCloseDay={() => setActionNotice('End-of-day close is a preview only; no live shop totals were changed.')}
      />;
    }
    if (activePage === 'pos') return <POSBillingView
      customers={sandbox.customers}
      currentUserId={`role-demo-${role}`}
      currentRole={role}
      permissions={getDemoRolePermissions(role)}
      currentUserName={accountName}
      companyName="Demo Pharmacy"
      billingTemplate="pharmacy-memo"
      receiptFormat="thermal80"
      memoSettings={DEMO_MEMO_SETTINGS}
      onPrintReceipt={simulatePrint}
      onSaleComplete={() => undefined}
      demoCatalog={demoCatalog}
      onPostSale={async (input) => {
        const result = postRoleDemoCheckout(sandbox, input);
        setSandbox(result.state);
        return result.sale;
      }}
      disableCustomerDisplay
      disablePersistentHeldBills
      disableLiveReturns
    />;
    if (activePage === 'products') return <DemoInventory sandbox={sandbox} />;
    if (activePage === 'stock-inventory') return <DemoInventory sandbox={sandbox} stockOnly />;
    if (activePage === 'purchases') return <DemoPurchases sandbox={sandbox} onPurchase={handlePurchase} />;
    if (activePage === 'purchase-history') return <PurchaseHistory sandbox={sandbox} />;
    if (activePage === 'customers' || activePage === 'customer-ledger') {
      return <CustomerLedgerScreen
        customers={sandbox.customers}
        ledgerEntries={sandbox.ledgerEntries}
        onRecordPayment={handlePayment}
        onAddCustomer={handleAddCustomer}
        memoSettings={DEMO_MEMO_SETTINGS}
        memoFormat="thermal80"
        currentUserName={accountName}
        currentRole={role}
        onPrintReceipt={simulatePrint}
        externalActionsDisabled
      />;
    }
    if (activePage === 'sales-history') {
      return <div className="space-y-4">
        <SalesHistoryView sales={sandbox.sales} currentRole={role} storeName="Demo Pharmacy" generatedBy={accountName} />
        <DemoReturns sandbox={sandbox} role={role} onReturn={(saleId, productId, quantity) => {
          const next = returnRoleDemoSale(sandbox, saleId, productId, quantity);
          setSandbox(next);
        }} />
      </div>;
    }
    if (activePage === 'expenses') {
      return <CashBookScreen transactions={sandbox.transactions} onAddTransaction={handleAddExpense} />;
    }
    if (activePage === 'reports') {
      return <ReportsScreen
        sales={sandbox.sales}
        currentRole={role}
        storeName="Demo Pharmacy"
        generatedBy={accountName}
        onLoadCustomSales={async (from, toExclusive) => sandbox.sales.filter((sale) => {
          const timestamp = new Date(sale.timestamp);
          return timestamp >= from && timestamp < toExclusive;
        })}
      />;
    }
    return <DemoReferencePage page={activePage} sandbox={sandbox} role={role} onAddSupplier={(name, phone) => {
      if (!name.trim()) {
        setActionNotice('Enter a supplier name.');
        return;
      }
      setSandbox((current) => ({
        ...current,
        suppliers: [...current.suppliers, {
          id: `demo-supplier-${current.nextEntityNumber}`,
          name: name.trim(),
          phone: phone.trim(),
        }],
        nextEntityNumber: current.nextEntityNumber + 1,
      }));
    }} />;
  };

  return (
    <div className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-surface font-inter text-text">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border bg-white px-4 py-2.5 shadow-xs sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <PharmaLogo size={2.5} layout="inline" className="shrink-0" />
          <span className="hidden h-8 border-l border-border sm:block" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-text">Demo Pharmacy</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Isolated interactive sandbox</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden text-right sm:block"><p className="text-sm font-bold text-text">{accountName}</p><p className="text-[10px] font-semibold uppercase text-muted">{ROLE_LABELS[role]} · Demo account</p></div>
          {role !== UserRole.SUPER_ADMIN && <button type="button" onClick={resetDemo} className="inline-flex items-center gap-2 rounded-control border border-border bg-white px-3 py-2 text-xs font-bold text-text hover:bg-surface"><RotateCcw size={14} /><span>Reset demo</span></button>}
          <button type="button" onClick={exitDemo} className="inline-flex items-center gap-2 rounded-control border border-border bg-white px-3 py-2 text-xs font-bold text-text hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <LogOut size={15} /><span>Exit demo</span>
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-white lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 border-b border-border p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{accountName.charAt(0)}</span>
            <div className="min-w-0"><p className="truncate text-sm font-bold text-text">{accountName}</p><p className="text-xs text-muted">{ROLE_LABELS[role]} sample permissions</p></div>
          </div>
          <nav aria-label={`${ROLE_LABELS[role]} demo pages`} className="min-h-0 flex-1 overflow-y-auto p-3">
            {SIDEBAR_CATEGORIES.map((category) => {
              const categoryPages = pages.filter((page) => page.category === category);
              if (!categoryPages.length) return null;
              return <section key={category} className="mb-4 last:mb-0"><h2 className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted">{category}</h2><div className="space-y-1">
                {categoryPages.map((page) => {
                  const Icon = page.icon;
                  return <button key={page.key} type="button" aria-current={activePage === page.key ? 'page' : undefined} onClick={() => { if (isDemoPreviewPageKey(page.key)) setActivePage(page.key); }} className={`flex w-full items-center gap-2.5 rounded-control px-3 py-2.5 text-left text-sm font-semibold transition ${activePage === page.key ? 'bg-primary text-white' : 'text-text hover:bg-surface'}`}><Icon size={17} className="shrink-0" /><span className="truncate">{page.label}</span></button>;
                })}
              </div></section>;
            })}
          </nav>
          <div className="border-t border-border p-3"><div role="note" className="flex items-start gap-2 rounded-control bg-surface p-3 text-[11px] leading-relaxed text-muted"><FlaskConical size={15} className="mt-0.5 shrink-0 text-primary" /><p>{pages.length} pages · 30-day sample · changes isolated to this browser session.</p></div></div>
        </aside>

        <main className={`min-h-0 ${activePage === 'pos' ? 'overflow-y-auto p-2 lg:overflow-hidden' : 'overflow-y-auto p-4 sm:p-6 lg:p-8'}`}>
          <div className={`mx-auto ${activePage === 'pos' ? 'h-full min-h-0 max-w-none space-y-2' : 'max-w-6xl space-y-5'}`}>
            {activePage !== 'pos' && <div role="note" className="flex items-start gap-3 rounded-control border border-warning/40 bg-warning/10 p-4 text-sm text-text"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" /><p>Role Demo is separate from your active shop. Business actions update only the isolated sandbox; external messages, user changes, and live database writes are disabled.</p></div>}
            {storageWarning && <DemoNotice error>{storageWarning}</DemoNotice>}
            {actionNotice && <DemoNotice>{actionNotice}</DemoNotice>}
            {activePage !== 'dashboard' && activePage !== 'pos' && <header><p className="text-xs font-bold uppercase tracking-wide text-muted">{ROLE_LABELS[role]} demo workspace</p><h1 className="mt-1 text-2xl font-black text-text">{activePageDefinition?.label ?? 'Demo page'}</h1></header>}
            {renderActivePage()}
            {activePage !== 'pos' && <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted"><span>Demo data is not synchronized to Supabase.</span><span className="inline-flex items-center gap-1"><ArrowUpRight size={13} />{sandbox.sales.length} sales · {sandbox.products.length} products · {sandbox.purchases.length} purchases</span></footer>}
          </div>
        </main>
      </div>
    </div>
  );
}
