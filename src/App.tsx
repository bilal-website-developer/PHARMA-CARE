import React, { Component, useState, useEffect } from 'react';
import {
  Product,
  Customer,
  ControlledDrugLog,
  CashTransaction,
  CompletedSale,
  UserRole,
  PaymentMethod,
} from './types/pharmacy';
import {
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_LEDGER_ENTRIES,
  INITIAL_CONTROLLED_LOGS,
  INITIAL_CASH_TRANSACTIONS,
} from './data/mockPharmacyData';
import { Sidebar, NavItemKey } from './components/Sidebar';
import { TopNav } from './components/TopNav';
import { DashboardView } from './components/DashboardView';
import { POSBillingView } from './components/POSBillingView';
import { TemplatePreviewModal } from './components/TemplatePreviewModal';
import { EndOfDayModal } from './components/EndOfDayModal';
import { SettingsView } from './components/SettingsView';
import { MasterDataView } from './components/MasterDataView';
import { WhatsAppRemindersView } from './components/WhatsAppRemindersView';
import { CustomerLedgerScreen } from './components/CustomerLedgerScreen';
import { ControlledDrugScreen } from './components/ControlledDrugScreen';
import { CashBookScreen } from './components/CashBookScreen';
import { ReportsScreen } from './components/ReportsScreen';
import { InventoryScreen } from './components/InventoryScreen';
import { RepositoryReviewView } from './components/RepositoryReviewView';
import { AuthSession, isAuthSession, LoginView } from './components/LoginView';

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [demoConfigChecked, setDemoConfigChecked] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    if (window.location.pathname !== '/' && window.location.pathname !== '/login') {
      window.history.replaceState({}, '', '/');
    }

    fetch('/api/auth/session', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        const result = (await response.json()) as { user?: unknown };
        return isAuthSession(result.user) ? result.user : null;
      })
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setSessionChecked(true));

    fetch('/api/auth/config')
      .then(async (response) => {
        if (!response.ok) return false;
        const result: unknown = await response.json();
        if (typeof result !== 'object' || result === null) return false;
        return (result as Record<string, unknown>).demoMode === true;
      })
      .then(setDemoMode)
      .catch(() => setDemoMode(false))
      .finally(() => setDemoConfigChecked(true));
  }, []);

  useEffect(() => {
    if (!session) return;
    let timeoutId: number;
    const expireSession = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
          .then((response) => {
            if (!response.ok) throw new Error('Session could not be ended.');
            setSession(null);
            window.history.replaceState({}, '', '/login');
          })
          .catch(() => {
            window.alert('Could not end the server session. Please contact your administrator.');
            expireSession();
          });
      }, 30 * 60 * 1000);
    };
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'mousemove', 'touchstart'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, expireSession));
    expireSession();
    return () => {
      window.clearTimeout(timeoutId);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, expireSession));
    };
  }, [session]);

  const handleLogin = (authenticatedSession: AuthSession) => {
    setSession(authenticatedSession);
    window.history.replaceState({}, '', '/');
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Logout request failed.');
      setSession(null);
      window.history.replaceState({}, '', '/login');
    } catch {
      window.alert('Could not end the server session. Please try again.');
    }
  };

  if (!sessionChecked || (!session && !demoConfigChecked)) {
    return <div className="flex min-h-screen items-center justify-center bg-surface text-muted">Loading…</div>;
  }

  if (!session) {
    if (window.location.pathname !== '/login') {
      window.history.replaceState({}, '', '/login');
    }
    return <LoginView demoEnabled={demoMode} onLogin={handleLogin} />;
  }

  if (window.location.pathname === '/login') {
    window.history.replaceState({}, '', '/');
  }

  return (
    <AppErrorBoundary>
      <PharmacyApp
        key={session.userId}
        session={session}
        onLogout={handleLogout}
        demoMode={demoMode}
      />
    </AppErrorBoundary>
  );
}

function PharmacyApp({
  session,
  onLogout,
  demoMode,
}: {
  session: AuthSession;
  onLogout: () => void;
  demoMode: boolean;
}) {
  const [activeItem, setActiveItem] = useState<NavItemKey>(
    session.role === UserRole.CASHIER ? 'pos' : 'dashboard'
  );

  const currentRole = session.role;
  const currentUserName = session.displayName;

  // Main Datasets
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [ledgerEntries, setLedgerEntries] = useState(INITIAL_LEDGER_ENTRIES);
  const [controlledLogs, setControlledLogs] = useState<ControlledDrugLog[]>(INITIAL_CONTROLLED_LOGS);
  const [transactions, setTransactions] = useState<CashTransaction[]>(INITIAL_CASH_TRANSACTIONS);
  const [completedSales, setCompletedSales] = useState<CompletedSale[]>([
    {
      id: 'demo-sale-1',
      invoiceNumber: 'INV-87654321',
      timestamp: '06/10/2026, 11:54:23 pm',
      cashierName: 'd',
      customerName: 'Ahmed Tariq',
      customerPhone: '0300-1234567',
      items: [
        {
          productId: 'prod-1',
          productName: 'Wireless Optical Mouse 2.4G (Logitech)',
          genericName: 'RET-MOU-01',
          batchId: 'b-1',
          batchNumber: 'LOT-99',
          expiryDate: '2028-01-01',
          drugClass: 'OTC' as any,
          unitName: 'Piece',
          conversionFactor: 1,
          quantityInUnit: 1,
          mrpPaisaPerUnit: 185000,
          costPaisaPerUnit: 140000,
          discountPercent: 0,
          lineTotalPaisa: 185000,
        },
        {
          productId: 'prod-2',
          productName: 'Executive Hardcover Notebook A5 (Deli)',
          genericName: 'RET-NTB-A5',
          batchId: 'b-2',
          batchNumber: 'LOT-98',
          expiryDate: '2028-01-01',
          drugClass: 'OTC' as any,
          unitName: 'Piece',
          conversionFactor: 1,
          quantityInUnit: 2,
          mrpPaisaPerUnit: 45000,
          costPaisaPerUnit: 35000,
          discountPercent: 0,
          lineTotalPaisa: 90000,
        },
        {
          productId: 'prod-3',
          productName: 'Ballpoint Pen Box (Pack of 10) (Piano)',
          genericName: 'RET-PEN-10',
          batchId: 'b-3',
          batchNumber: 'LOT-97',
          expiryDate: '2028-01-01',
          drugClass: 'OTC' as any,
          unitName: 'Pack',
          conversionFactor: 1,
          quantityInUnit: 1,
          mrpPaisaPerUnit: 30000,
          costPaisaPerUnit: 22000,
          discountPercent: 0,
          lineTotalPaisa: 30000,
        },
      ],
      subtotalPaisa: 305000,
      discountPaisa: 20000,
      totalPaisa: 285000,
      paymentMethod: PaymentMethod.CASH,
      amountTenderedPaisa: 285000,
      changePaisa: 0,
    },
  ]);

  // Global Modals
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [showCloseDayModal, setShowCloseDayModal] = useState(false);

  // Keyboard shortcut F1 for POS Billing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setActiveItem('pos');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSaleComplete = (sale: CompletedSale) => {
    setCompletedSales((prev) => [sale, ...prev]);

    setProducts((prev) =>
      prev.map((product) => {
        const saleAllocations = sale.items.flatMap((item) =>
          item.productId === product.id ? item.batchAllocations ?? [] : []
        );
        return saleAllocations.length === 0
          ? product
          : {
              ...product,
              batches: product.batches.map((batch) => {
                const soldQuantity = saleAllocations
                  .filter((allocation) => allocation.batchId === batch.id)
                  .reduce((sum, allocation) => sum + allocation.quantitySmallestUnit, 0);
                return { ...batch, quantitySmallestUnit: batch.quantitySmallestUnit - soldQuantity };
              }),
            };
      })
    );

    if (sale.paymentMethod === PaymentMethod.CASH) {
      const tx: CashTransaction = {
        id: `tx-${Date.now()}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'SALE',
        description: `POS Bill ${sale.invoiceNumber}`,
        amountPaisa: sale.totalPaisa,
        isOutflow: false,
        handledBy: currentUserName,
      };
      setTransactions((prev) => [tx, ...prev]);
    }

    if (sale.paymentMethod === PaymentMethod.CREDIT && sale.customerName) {
      const customer = customers.find((c) => c.name === sale.customerName);
      if (customer) {
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === customer.id
              ? { ...c, currentBalancePaisa: c.currentBalancePaisa + sale.totalPaisa }
              : c
          )
        );

        const newLedgerItem = {
          id: `led-${Date.now()}`,
          date: new Date().toISOString().split('T')[0],
          type: 'INVOICE' as const,
          referenceNo: sale.invoiceNumber,
          description: `POS Credit Sale (${sale.items.length} items)`,
          debitPaisa: sale.totalPaisa,
          creditPaisa: 0,
          runningBalancePaisa: customer.currentBalancePaisa + sale.totalPaisa,
        };

        setLedgerEntries((prev) => ({
          ...prev,
          [customer.id]: [newLedgerItem, ...(prev[customer.id] || [])],
        }));
      }
    }
  };

  const handleRecordPayment = (customerId: string, amountPaisa: number, note: string) => {
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId
          ? { ...c, currentBalancePaisa: Math.max(0, c.currentBalancePaisa - amountPaisa) }
          : c
      )
    );

    const customer = customers.find((c) => c.id === customerId);
    const newBal = Math.max(0, (customer?.currentBalancePaisa || 0) - amountPaisa);

    const newLedgerItem = {
      id: `led-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      type: 'PAYMENT' as const,
      referenceNo: `RCP-${Math.floor(1000 + Math.random() * 9000)}`,
      description: note || 'Counter Payment Received',
      debitPaisa: 0,
      creditPaisa: amountPaisa,
      runningBalancePaisa: newBal,
    };

    setLedgerEntries((prev) => ({
      ...prev,
      [customerId]: [newLedgerItem, ...(prev[customerId] || [])],
    }));

    const tx: CashTransaction = {
      id: `tx-${Date.now()}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'CREDIT_RECOVERY',
      description: `Payment from ${customer?.name || 'Customer'}`,
      amountPaisa,
      isOutflow: false,
      handledBy: currentUserName,
    };
    setTransactions((prev) => [tx, ...prev]);
  };

  // Calculations for End of Day modal
  const cashSalesPKR =
    completedSales
      .filter((s) => s.paymentMethod === 'CASH')
      .reduce((sum, s) => sum + s.totalPaisa, 0) / 100;

  const creditSalesPKR =
    completedSales
      .filter((s) => s.paymentMethod === 'CREDIT')
      .reduce((sum, s) => sum + s.totalPaisa, 0) / 100;

  const totalSalesPKR = completedSales.reduce((sum, s) => sum + s.totalPaisa, 0) / 100;

  const expensesPKR =
    transactions
      .filter((t) => t.isOutflow)
      .reduce((sum, t) => sum + t.amountPaisa, 0) / 100;

  const totalCostPKR =
    completedSales.reduce((sum, s) => {
      return (
        sum +
        s.items.reduce((itemSum, item) => itemSum + item.costPaisaPerUnit * item.quantityInUnit, 0)
      );
    }, 0) / 100;

  const grossProfitPKR = Math.max(0, totalSalesPKR - totalCostPKR);
  const netCashInHandPKR = Math.max(0, cashSalesPKR - expensesPKR);

  const getPageTitle = (key: NavItemKey): string => {
    switch (key) {
      case 'dashboard':
        return 'DASHBOARD';
      case 'pos':
        return 'POS BILLING';
      case 'products':
        return 'PRODUCTS';
      case 'master-data':
        return 'MASTER DATA';
      case 'stock-inventory':
        return 'STOCK INVENTORY';
      case 'customers':
        return 'CUSTOMERS';
      case 'customer-ledger':
        return 'CUSTOMER LEDGER';
      case 'whatsapp-reminders':
        return 'WHATSAPP REMINDERS';
      case 'sales-history':
        return 'SALES HISTORY';
      case 'suppliers':
        return 'SUPPLIERS';
      case 'purchases':
        return 'PURCHASES';
      case 'purchase-history':
        return 'PURCHASE HISTORY';
      case 'expenses':
        return 'EXPENSES';
      case 'reports':
        return 'BUSINESS ANALYTICS';
      case 'manage-users':
        return 'MANAGE USERS';
      case 'settings':
        return 'SETTINGS';
      case 'trash-bin':
        return 'TRASH BIN';
      case 'help-support':
        return 'HELP & SUPPORT';
      default:
        return 'DEMO STORE';
    }
  };

  return (
    <div className="flex min-h-screen bg-surface font-inter text-text antialiased">
      {/* ── Fixed Pharmacy Green Sidebar ───────────────────────────────────── */}
      <Sidebar
        activeItem={activeItem}
        onSelectItem={(item) => setActiveItem(item)}
        currentRole={currentRole}
      />

      {/* ── Main Workspace Content Pane ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Strip */}
        <TopNav
          currentRole={currentRole}
          onLogout={onLogout}
          currentUserName={currentUserName}
          activeTitle={getPageTitle(activeItem)}
          onOpenCloseDay={() => setShowCloseDayModal(true)}
        />

        {demoMode && (
          <div
            role="status"
            className="border-b border-warning bg-warning/15 px-4 py-2 text-center text-xs font-semibold text-text sm:text-sm"
          >
            DEMO MODE: sample data only
          </div>
        )}

        {/* Dynamic Screen View */}
        <main className="p-4 sm:p-6 flex-1 overflow-y-auto">
          {activeItem === 'dashboard' && (
            <DashboardView
              sales={completedSales}
              products={products}
              customers={customers}
              currentRole={currentRole}
              currentUserName={currentUserName}
              onNavigate={(tab) => setActiveItem(tab)}
              onOpenCloseDay={() => setShowCloseDayModal(true)}
            />
          )}

          {activeItem === 'pos' && (
            <POSBillingView
              products={products}
              customers={customers}
              currentRole={currentRole}
              currentUserName={currentUserName}
              onSaleComplete={handleSaleComplete}
              onOpenTemplatePreview={() => setShowTemplatePreview(true)}
            />
          )}

          {activeItem === 'products' && (
            <InventoryScreen
              products={products}
              currentRole={currentRole}
              onAddProduct={(prod) => setProducts((prev) => [prod, ...prev])}
            />
          )}

          {activeItem === 'master-data' && <MasterDataView />}

          {activeItem === 'stock-inventory' && (
            <InventoryScreen
              products={products}
              currentRole={currentRole}
              onAddProduct={(prod) => setProducts((prev) => [prod, ...prev])}
            />
          )}

          {activeItem === 'customers' && (
            <CustomerLedgerScreen
              customers={customers}
              ledgerEntries={ledgerEntries}
              onRecordPayment={handleRecordPayment}
              onAddCustomer={(c) => {
                setCustomers((prev) => [...prev, c]);
                setLedgerEntries((prev) => ({ ...prev, [c.id]: [] }));
              }}
            />
          )}

          {activeItem === 'customer-ledger' && (
            <CustomerLedgerScreen
              customers={customers}
              ledgerEntries={ledgerEntries}
              onRecordPayment={handleRecordPayment}
              onAddCustomer={(c) => {
                setCustomers((prev) => [...prev, c]);
                setLedgerEntries((prev) => ({ ...prev, [c.id]: [] }));
              }}
            />
          )}

          {activeItem === 'whatsapp-reminders' && (
            <WhatsAppRemindersView customers={customers} />
          )}

          {activeItem === 'sales-history' && (
            <ReportsScreen sales={completedSales} currentRole={currentRole} />
          )}

          {activeItem === 'expenses' && (
            <CashBookScreen
              transactions={transactions}
              onAddTransaction={(tx) => setTransactions((prev) => [tx, ...prev])}
            />
          )}

          {activeItem === 'reports' && (
            <ReportsScreen sales={completedSales} currentRole={currentRole} />
          )}

          {activeItem === 'settings' && (
            <SettingsView onOpenTemplatePreview={() => setShowTemplatePreview(true)} />
          )}

          {activeItem === 'suppliers' && (
            <EmptyModulePage
              title="Suppliers"
              message="No suppliers yet. Add your first supplier."
              detail="Supplier management needs the server API and database, which are not included in this frontend-only project."
            />
          )}
          {activeItem === 'purchases' && (
            <EmptyModulePage
              title="Purchase Entry"
              message="No purchase entries yet."
              detail="Purchase posting and stock movements require a server API and database."
            />
          )}
          {activeItem === 'purchase-history' && (
            <EmptyModulePage
              title="Purchase History"
              message="No purchases have been recorded yet."
              detail="Purchase history requires persisted purchase records from a server API."
            />
          )}

          {activeItem === 'help-support' && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs max-w-xl mx-auto space-y-4">
              <h3 className="text-base font-black text-slate-900">🎧 Help & Direct Support</h3>
              <p className="text-xs text-slate-600">
                Ticket submit karein ya direct WhatsApp / Call par helpline se rabta karein.
              </p>
              <div className="p-4 bg-blue-600 text-white rounded-xl space-y-1 shadow-md">
                <div className="text-[10px] uppercase font-bold text-blue-200">URGENT / DIRECT SUPPORT</div>
                <div className="text-lg font-black font-mono">Babar Joya: 0301-2616367</div>
                <div className="text-[11px] text-blue-100">Zabardast mushkil ho to seedha call karein.</div>
              </div>
            </div>
          )}

          {activeItem === 'trash-bin' && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 max-w-2xl mx-auto">
              <div className="flex items-center justify-between pb-3 border-b">
                <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
                  <span>🗑️</span> Trash Bin
                </h3>
                <span className="text-xs text-slate-500 font-mono">All Types (0)</span>
              </div>
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                <span className="font-bold block">Deletion Order Guide — Kya pehle delete karein?</span>
                <p className="text-[11px] text-amber-800">
                  Step 1: Sale Items & Purchase Items • Step 2: Sales & Purchases • Step 3: Products / Customers / Suppliers.
                </p>
              </div>
              <div className="py-12 text-center text-slate-400 text-xs">
                Trash is empty! No deleted items found.
              </div>
            </div>
          )}

          {activeItem === 'manage-users' && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 max-w-2xl mx-auto">
              <div className="flex items-center justify-between pb-3 border-b">
                <div>
                  <h3 className="font-black text-base text-slate-900">Manage Users</h3>
                  <p className="text-xs text-slate-500">Shop Limit: 2 / 99 users</p>
                </div>
              </div>
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="p-2.5">USER INFO</th>
                    <th className="p-2.5">ROLE</th>
                    <th className="p-2.5">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="p-2.5 font-bold">bilal (You)</td>
                    <td className="p-2.5 font-mono text-blue-600 font-bold">admin</td>
                    <td className="p-2.5 font-semibold text-emerald-600">Active</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold">cashier1</td>
                    <td className="p-2.5 font-mono text-purple-600 font-bold">cashier</td>
                    <td className="p-2.5 font-semibold text-emerald-600">Active</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {/* ── Global Template Preview Modal (Screenshots 1-4, 68-80) ─────────── */}
      {showTemplatePreview && (
        <TemplatePreviewModal onClose={() => setShowTemplatePreview(false)} />
      )}

      {/* ── End of Day Summary Modal (Screenshot 5) ─────────────────────────── */}
      {showCloseDayModal && (
        <EndOfDayModal
          onClose={() => setShowCloseDayModal(false)}
          cashSalesPKR={cashSalesPKR}
          creditSalesPKR={creditSalesPKR}
          totalSalesPKR={totalSalesPKR}
          expensesPKR={expensesPKR}
          purchasesPKR={0}
          grossProfitPKR={grossProfitPKR}
          netCashInHandPKR={netCashInHandPKR}
        />
      )}
    </div>
  );
}

function EmptyModulePage({
  title,
  message,
  detail,
}: {
  title: string;
  message: string;
  detail: string;
}) {
  return (
    <section className="mx-auto max-w-3xl rounded-card border border-border bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-bold text-text">{title}</h2>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <p className="mt-4 text-xs text-warning">{detail}</p>
    </section>
  );
}

class AppErrorBoundary extends Component<
  React.PropsWithChildren,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-surface p-6 text-text">
          <section className="max-w-md rounded-card border border-border bg-white p-7 text-center shadow-lg">
            <h1 className="text-lg font-bold">This page could not be displayed.</h1>
            <p className="mt-2 text-sm text-muted">Reload the app to try again.</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Reload
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
