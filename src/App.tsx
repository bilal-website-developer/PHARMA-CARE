import React, { Component, useState, useEffect } from 'react';
import {
  Product,
  Customer,
  ControlledDrugLog,
  CashTransaction,
  CompletedSale,
  DrugClass,
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
import type { ProductFilter } from './components/InventoryScreen';
import { SuppliersView } from './components/SuppliersView';
import { RepositoryReviewView } from './components/RepositoryReviewView';
import { LoginView } from './components/LoginView';
import { ChangePasswordModal, DeletedUsersView, ManageUsersView } from './components/ManageUsersView';
import { AuthSession, loadAuthSession } from './utils/auth';
import { supabase } from './utils/supabase';
import { isAdminRole, PermissionsProvider, usePermissions } from './permissions';
import {
  BillingPreferences,
  BillingTemplate,
  ReceiptFormat,
  readBillingPreferences,
  saveBillingPreferences,
} from './utils/receipt';
import { readCompanyName, saveCompanyName } from './utils/storeSettings';
import PharmaLogo from './components/PharmaLogo';
import { HelpSupportView } from './components/HelpSupportView';
import { StockPurchaseView } from './components/StockPurchaseView';
import { PurchaseHistoryView } from './components/PurchaseHistoryView';

const NAV_PATHS: Record<NavItemKey, string> = {
  dashboard: '/',
  pos: '/pos',
  products: '/products',
  'master-data': '/categories',
  'stock-inventory': '/stock-inventory',
  customers: '/customers',
  'customer-ledger': '/customer-ledger',
  'whatsapp-reminders': '/whatsapp-reminders',
  'sales-history': '/sales-history',
  suppliers: '/suppliers',
  purchases: '/purchases',
  'purchase-history': '/purchase-history',
  expenses: '/expenses',
  reports: '/reports',
  'manage-users': '/users',
  settings: '/settings',
  'trash-bin': '/trash-bin',
  'help-support': '/help',
};

function routeToNavItem(pathname: string): NavItemKey | null {
  const match = Object.entries(NAV_PATHS).find(([, path]) => path === pathname);
  return match ? (match[0] as NavItemKey) : null;
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setSessionChecked(true);
      return;
    }
    let disposed = false;
    const restoreSession = async () => {
      try {
        const { data: authData, error: authError } = await client.auth.getSession();
        if (authError) throw authError;
        if (!authData.session) {
          if (!disposed) setSession(null);
          return;
        }
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError) throw userError;
        if (!userData.user) throw new Error('Your session is no longer valid. Sign in again.');
        const profile = await loadAuthSession(userData.user.id, userData.user.email);
        if (!disposed) setSession(profile);
      } catch (error) {
        if (!disposed) {
          setSession(null);
          setAuthMessage(error instanceof Error ? error.message : 'Could not restore your session.');
        }
      } finally {
        if (!disposed) setSessionChecked(true);
      }
    };
    void restoreSession();
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && !disposed) {
        setSession(null);
        setSessionChecked(true);
      }
    });
    return () => {
      disposed = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const refreshProfile = async () => {
      try {
        if (!supabase) throw new Error('Supabase is not configured.');
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data.user) throw new Error('Your session is no longer valid. Sign in again.');
        const updated = await loadAuthSession(data.user.id, data.user.email);
        setSession(updated);
        setAuthMessage('');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not verify your account.';
        setAuthMessage(message);
        if (
          (error instanceof Error && error.name === 'ProfileLoadError') ||
          message.startsWith('Your account is disabled') ||
          message.startsWith('No profile exists') ||
          message.startsWith('Your profile has an invalid role') ||
          message.startsWith('Your session is no longer valid')
        ) {
          setSession(null);
          await supabase?.auth.signOut();
        }
      }
    };
    const intervalId = window.setInterval(() => void refreshProfile(), 2 * 60 * 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [session?.userId]);

  useEffect(() => {
    if (!session) return;
    let timeoutId: number;
    const expireSession = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void (async () => {
          const { error } = await supabase?.auth.signOut() ?? { error: new Error('Supabase is not configured.') };
          if (error) {
            window.alert('Could not end the inactive session. Please contact your administrator.');
            expireSession();
            return;
          }
          setSession(null);
          window.history.replaceState({}, '', '/login');
        })();
      }, 30 * 60 * 1000);
    };
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'mousemove', 'touchstart'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, expireSession));
    expireSession();
    return () => {
      window.clearTimeout(timeoutId);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, expireSession));
    };
  }, [session?.userId]);

  const handleLogin = async (userId: string, email: string) => {
    setAuthMessage('');
    try {
      const authenticatedSession = await loadAuthSession(userId, email);
      setSession(authenticatedSession);
      window.history.replaceState({}, '', '/');
    } catch (error) {
      await supabase?.auth.signOut();
      throw error;
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      window.alert(`Could not end the session: ${error.message}`);
      return;
    }
    setSession(null);
    window.history.replaceState({}, '', '/login');
  };

  if (!sessionChecked) {
    return <div className="app-loading flex min-h-screen items-center justify-center bg-surface"><PharmaLogo size={12} /></div>;
  }

  if (!session) {
    if (window.location.pathname !== '/login') window.history.replaceState({}, '', '/login');
    return (
      <LoginView
        onLogin={handleLogin}
        initialError={authMessage}
      />
    );
  }

  return (
    <AppErrorBoundary>
      <PharmacyApp
        key={session.userId}
        session={session}
        onLogout={handleLogout}
        authMessage={authMessage}
      />
    </AppErrorBoundary>
  );
}

function PharmacyApp({
  session,
  onLogout,
  authMessage,
}: {
  session: AuthSession;
  onLogout: () => void;
  authMessage: string;
}) {
  return (
    <PermissionsProvider role={session.role} permissions={session.permissions}>
      <PharmacyWorkspace session={session} onLogout={onLogout} authMessage={authMessage} />
    </PermissionsProvider>
  );
}

function PharmacyWorkspace({
  session,
  onLogout,
  authMessage,
}: {
  session: AuthSession;
  onLogout: () => void;
  authMessage: string;
}) {
  const { canPage } = usePermissions();
  const initialPath = window.location.pathname;
  const [activeItem, setActiveItem] = useState<NavItemKey>(
    routeToNavItem(initialPath) ?? 'dashboard'
  );
  const [isPageNotFound, setIsPageNotFound] = useState(
    initialPath !== '/' && initialPath !== '/login' && routeToNavItem(initialPath) === null
  );
  const [accessMessage, setAccessMessage] = useState('');
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  const currentRole = session.role;
  const currentUserName = session.displayName;
  const [billingPreferences, setBillingPreferences] = useState<BillingPreferences>(() =>
    readBillingPreferences()
  );
  const [previewTemplate, setPreviewTemplate] = useState<BillingTemplate>(
    billingPreferences.template
  );
  const [companyName, setCompanyName] = useState(readCompanyName);

  useEffect(() => {
    const syncRoute = () => {
      const requested = routeToNavItem(window.location.pathname);
      if (!requested) {
        if (window.location.pathname === '/login') {
          window.history.replaceState({}, '', '/');
          setIsPageNotFound(false);
          setActiveItem('dashboard');
          return;
        }
        setIsPageNotFound(true);
        setAccessMessage('');
        return;
      }
      setIsPageNotFound(false);
      if (!canPage(requested)) {
        setAccessMessage('No access. Your account does not have permission to open that page.');
        setActiveItem('dashboard');
        window.history.replaceState({}, '', '/');
        return;
      }
      setAccessMessage('');
      setActiveItem(requested);
    };
    syncRoute();
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, [canPage]);

  const navigateTo = React.useCallback((item: NavItemKey) => {
    if (!canPage(item)) {
      setAccessMessage('No access. Your account does not have permission to open that page.');
      setActiveItem('dashboard');
      window.history.replaceState({}, '', '/');
      return;
    }
    setAccessMessage('');
    setIsPageNotFound(false);
    setActiveItem(item);
    window.history.pushState({}, '', NAV_PATHS[item]);
  }, [canPage]);

  const [productFilter, setProductFilter] = React.useState<ProductFilter>(null);
  const viewFilteredProducts = React.useCallback((filter: Exclude<ProductFilter, null>) => {
    setProductFilter(filter);
    navigateTo('products');
  }, [navigateTo]);

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
      cashierName: 'Bilal Cashier (POS 1)',
      customerName: 'Walk-in Customer',
      customerPhone: '',
      items: [
        {
          productId: 'prod-1',
          productName: 'Panadol Extra 500mg/65mg',
          genericName: 'Paracetamol + Caffeine',
          batchId: 'b-101',
          batchNumber: 'PE-2401',
          expiryDate: '2026-12-31',
          drugClass: DrugClass.OTC,
          unitName: 'Strip (10 Tabs)',
          conversionFactor: 10,
          quantityInUnit: 1,
          mrpPaisaPerUnit: 6500,
          costPaisaPerUnit: 4800,
          discountPercent: 0,
          lineTotalPaisa: 6500,
        },
        {
          productId: 'prod-2',
          productName: 'Augmentin 625mg',
          genericName: 'Amoxicillin + Clavulanic Acid',
          batchId: 'b-201',
          batchNumber: 'AUG-889',
          expiryDate: '2026-11-15',
          drugClass: DrugClass.RX,
          unitName: 'Pack (14 Tabs)',
          conversionFactor: 14,
          quantityInUnit: 1,
          mrpPaisaPerUnit: 48000,
          costPaisaPerUnit: 38000,
          discountPercent: 0,
          lineTotalPaisa: 48000,
        },
        {
          productId: 'prod-6',
          productName: 'Mixtard 30 HM 100IU (Insulin 70/30)',
          genericName: 'Biphasic Isophane Insulin Human',
          batchId: 'b-601',
          batchNumber: 'NN-MIX-304',
          expiryDate: '2027-03-31',
          drugClass: DrugClass.RX,
          unitName: 'Vial (10ml)',
          conversionFactor: 1,
          quantityInUnit: 1,
          mrpPaisaPerUnit: 145000,
          costPaisaPerUnit: 122000,
          discountPercent: 0,
          lineTotalPaisa: 145000,
        },
      ],
      subtotalPaisa: 199500,
      discountPaisa: 0,
      totalPaisa: 199500,
      paymentMethod: PaymentMethod.CASH,
      amountTenderedPaisa: 199500,
      changePaisa: 0,
    },
  ]);

  // Global Modals
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [showCloseDayModal, setShowCloseDayModal] = useState(false);

  const updateBillingPreferences = (preferences: BillingPreferences) => {
    setBillingPreferences(preferences);
    if (!saveBillingPreferences(preferences)) {
      window.alert('Template preference could not be saved in this browser.');
    }
  };

  const updateCompanyName = (name: string): boolean => {
    if (!saveCompanyName(name)) return false;
    setCompanyName(name.trim());
    return true;
  };

  const openTemplatePreview = (template: BillingTemplate) => {
    setPreviewTemplate(template);
    setShowTemplatePreview(true);
  };

  // Keyboard shortcut F1 for POS Billing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        navigateTo('pos');
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
        onSelectItem={navigateTo}
        username={currentUserName}
      />

      {/* ── Main Workspace Content Pane ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {authMessage && <p role="alert" className="border-b border-warning bg-warning/15 px-4 py-2 text-sm font-semibold text-text">{authMessage}</p>}
        {/* Top Header Strip */}
        <TopNav
          currentRole={currentRole}
          username={currentUserName}
          activeTitle={isPageNotFound ? 'PAGE NOT FOUND' : getPageTitle(activeItem)}
          onChangePassword={() => setShowPasswordDialog(true)}
          onLogout={onLogout}
        />

        {/* Dynamic Screen View */}
        <main className="pharmacy-page p-4 sm:p-6 flex-1 overflow-y-auto">
          {accessMessage && <p role="status" className="visual-toast mb-4 rounded-control border border-warning bg-warning/15 px-4 py-3 text-sm font-semibold text-text">{accessMessage}</p>}
          {isPageNotFound ? (
            <section className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 text-center">
              <h1 className="text-2xl font-black text-text">Page not found</h1>
              <p className="text-sm text-muted">The page you requested does not exist.</p>
              <button
                type="button"
                onClick={() => navigateTo('dashboard')}
                className="rounded-control bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Back to Dashboard
              </button>
            </section>
          ) : !canPage(activeItem) ? (
            <p role="alert" className="rounded-control border border-warning bg-warning/15 px-4 py-3 text-sm font-semibold text-text">No access. Redirecting to Dashboard.</p>
          ) : (
          <>
          {activeItem === 'dashboard' && (
            <DashboardView
              sales={completedSales}
              products={products}
              customers={customers}
              currentRole={currentRole}
              currentUserName={currentUserName}
              onNavigate={navigateTo}
              onOpenCloseDay={() => setShowCloseDayModal(true)}
            />
          )}

          {activeItem === 'pos' && (
            <POSBillingView
              products={products}
              customers={customers}
              currentRole={currentRole}
              currentUserName={currentUserName}
              companyName={companyName}
              billingTemplate={billingPreferences.template}
              receiptFormat={billingPreferences.format}
              onSaleComplete={handleSaleComplete}
              onOpenTemplatePreview={() => openTemplatePreview(billingPreferences.template)}
            />
          )}

          {activeItem === 'products' && (
            <InventoryScreen
              mode="products"
              currentRole={currentRole}
              initialFilter={productFilter}
              onFilterApplied={() => setProductFilter(null)}
            />
          )}

          {activeItem === 'master-data' && <MasterDataView onViewProducts={viewFilteredProducts} />}

          {activeItem === 'stock-inventory' && (
            <InventoryScreen
              mode="stock"
              currentRole={currentRole}
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
            <SettingsView
              sales={completedSales}
              currentRole={currentRole}
              currentUserName={currentUserName}
              activeTemplate={billingPreferences.template}
              canEditBilling={isAdminRole(currentRole)}
              onTemplateChange={(template: BillingTemplate) =>
                updateBillingPreferences({ ...billingPreferences, template })
              }
              companyName={companyName}
              onSaveCompanyName={updateCompanyName}
              onOpenTemplatePreview={openTemplatePreview}
            />
          )}

          {activeItem === 'suppliers' && <SuppliersView />}
          {activeItem === 'purchases' && (
            <StockPurchaseView userId={session.userId} onViewHistory={() => navigateTo('purchase-history')} />
          )}
          {activeItem === 'purchase-history' && <PurchaseHistoryView currentRole={currentRole} />}

          {activeItem === 'help-support' && <HelpSupportView username={currentUserName} role={currentRole} />}

          {activeItem === 'trash-bin' && <DeletedUsersView currentRole={currentRole} />}

          {activeItem === 'manage-users' && <ManageUsersView currentUserId={session.userId} currentRole={currentRole} onChangePassword={() => setShowPasswordDialog(true)} />}
          </>
          )}
        </main>
      </div>

      {/* ── Global Template Preview Modal (Screenshots 1-4, 68-80) ─────────── */}
      {showTemplatePreview && (
        <TemplatePreviewModal
          companyName={companyName}
          initialTemplate={previewTemplate}
          initialFormat={billingPreferences.format}
          canApply={isAdminRole(currentRole)}
          onApply={(template: BillingTemplate, format: ReceiptFormat) => {
            updateBillingPreferences({ template, format });
            setShowTemplatePreview(false);
          }}
          onClose={() => setShowTemplatePreview(false)}
        />
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
      {showPasswordDialog && <ChangePasswordModal email={session.email} onClose={() => setShowPasswordDialog(false)} />}
    </div>
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
