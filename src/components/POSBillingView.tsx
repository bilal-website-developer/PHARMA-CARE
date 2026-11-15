
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Printer,
  AlertTriangle,
  CheckCircle2,
  Package,
  Barcode,
  Archive,
  Clock3,
  Monitor,
  Trash2,
  X,
  Zap,
  Pause,
  ArrowLeftRight,
} from 'lucide-react';
import {
  PaymentMethod,
  CartItem,
  UserRole,
  Customer,
  CompletedSale,
  MAX_DISCOUNT_PAISA,
  ROLE_MAX_DISCOUNT,
  type SaleCustomerType,
} from '../types/pharmacy';
import { allocateFefo, availableSmallestUnits, localIsoDate } from '../utils/fefo';
import {
  BillingTemplate,
  PharmacyMemoSettings,
  ReceiptFormat,
  buildMemoData,
} from '../utils/receipt';
import {
  buildPrintSnapshot,
  canPrintReceipt,
  PrintReceiptHandler,
} from '../utils/printWorkflow';
import { APP_NAME } from '../constants/brand';
import { DiscountBox } from './DiscountBox';
import { computeDiscount, DiscountMode, formatDiscountLimit } from '../utils/discount';
import { findProductByScan, normalizeScannedValue, useBarcodeScanner } from '../utils/useBarcodeScanner';
import { loadPosCatalog } from '../data/posCatalog';
import { getRequiredSmallestUnits, type PosCatalogProduct } from '../data/posCatalogLogic';
import { STOCK_CHANGED_EVENT } from '../utils/stockAlertsEvents';
import { DEMO_DATA_CHANGED_EVENT } from '../data/demoDataManager';
import { postSale, type PostSaleInput } from '../data/sales';
import { SaleReturnsPanel } from './returns/SaleReturnsPanel';
import { PaymentProviderSelect } from './PaymentProviderSelect';
import { isValidOptionalPhone, resolvePosCustomerName } from '../utils/posCustomer';
import { readHeldBills, writeHeldBills, type HeldBill } from '../utils/heldBills';
import { getSplitPaymentSummary, parsePaisaAmount } from '../utils/splitPayments';
import {
  getPaymentMethodForProvider,
  type PaymentProviderId,
} from '../data/paymentProviders';
import {
  buildCustomerDisplayOptionsMessage,
  buildCustomerDisplayPayment,
  buildCustomerDisplaySnapshot,
  buildSameMedicineOptions,
  canAccessCustomerDisplay,
  getCustomerDisplayChannelId,
  parseCustomerDisplayMessage,
  readCustomerDisplayAlternatives,
  subscribeCustomerDisplayAlternatives,
  type CustomerDisplayMessage,
  type CustomerDisplayOptionCandidate,
} from '../utils/customerDisplay';

const emptyCustomerDetails = () => ({
  phone: '',
  whatsapp: '',
  sameWhatsappAsPhone: true,
  address: '',
  notes: '',
});
const customerPhoneValidationError = (details: ReturnType<typeof emptyCustomerDetails>) => {
  if (!isValidOptionalPhone(details.phone) || !isValidOptionalPhone(details.whatsapp)) {
    return 'Use digits with an optional leading +, or leave the number empty.';
  }
  return '';
};

interface SplitPaymentDraft {
  id: string;
  providerId: PaymentProviderId;
  amount: string;
  reference: string;
}

interface POSBillingViewProps {
  customers: Customer[];
  currentUserId: string;
  currentRole: UserRole;
  permissions: readonly string[];
  currentUserName: string;
  companyName: string;
  billingTemplate: BillingTemplate;
  receiptFormat: ReceiptFormat;
  memoSettings: PharmacyMemoSettings;
  onPrintReceipt: PrintReceiptHandler;
  onSaleComplete: (sale: CompletedSale) => void;
}

export const POSBillingView: React.FC<POSBillingViewProps> = ({
  customers,
  currentUserId,
  currentRole,
  permissions,
  companyName,
  billingTemplate,
  receiptFormat,
  memoSettings,
  onPrintReceipt,
  onSaleComplete,
}) => {
  const [products, setProducts] = useState<PosCatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0);
  // Top Tabs
  const [activeTopTab, setActiveTopTab] = useState<'sale' | 'barcode'>('sale');
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [heldBillsUserId, setHeldBillsUserId] = useState('');
  const [heldBillsError, setHeldBillsError] = useState('');
  const [showHeldBills, setShowHeldBills] = useState(false);
  const [heldBillsNow, setHeldBillsNow] = useState(Date.now);
  const heldBillsPanelRef = useRef<HTMLDivElement>(null);
  const holdCurrentCartRef = useRef<() => void>(() => undefined);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedBrand, setSelectedBrand] = useState<string>('ALL');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const chargeButtonRef = useRef<HTMLButtonElement>(null);
  const productGridRef = useRef<HTMLDivElement>(null);
  const tenderedInputRef = useRef<HTMLInputElement>(null);
  const completeSaleButtonRef = useRef<HTMLButtonElement>(null);
  const splitDoneButtonRef = useRef<HTMLButtonElement>(null);
  const isPostingSaleRef = useRef(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [quantityWarnings, setQuantityWarnings] = useState<Record<string, string>>({});
  const cartItemsListRef = useRef<HTMLDivElement>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [walkInName, setWalkInName] = useState('');
  const [customerType, setCustomerType] = useState<SaleCustomerType>('WALK_IN');
  const [customerDetails, setCustomerDetails] = useState(emptyCustomerDetails);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const [customerPhoneError, setCustomerPhoneError] = useState('');
  const customerDetailsRef = useRef<HTMLDivElement>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);
  const customerPhoneRef = useRef<HTMLInputElement>(null);
  const [displayChannel, setDisplayChannel] = useState<{ userId: string; id: string } | null>(null);
  const [displayNotice, setDisplayNotice] = useState('');
  const [displayThankYou, setDisplayThankYou] = useState(false);
  const [showDisplayAlternatives, setShowDisplayAlternatives] = useState(() =>
    readCustomerDisplayAlternatives(currentUserId)
  );
  const [activeOptions, setActiveOptions] = useState<{
    lineIndex: number;
    productName: string;
    strength: string | null;
    candidates: CustomerDisplayOptionCandidate[];
  } | null>(null);
  const displayChannelRef = useRef<BroadcastChannel | null>(null);
  const activeOptionsRef = useRef(activeOptions);
  const swapOptionRef = useRef<(option: CustomerDisplayOptionCandidate) => void>(() => undefined);

  useEffect(() => {
    if (cart.length !== 0) return;
    setSelectedCustomerId('');
    setWalkInName('');
    setCustomerType('WALK_IN');
    setCustomerDetails(emptyCustomerDetails());
    setShowCustomerDetails(false);
    setCustomerPhoneError('');
  }, [cart.length]);

  useEffect(() => {
    setHeldBills([]);
    setHeldBillsUserId('');
    setHeldBillsError('');
    setShowHeldBills(false);
    try {
      setHeldBills(readHeldBills(currentUserId));
      setHeldBillsUserId(currentUserId);
    } catch (error) {
      setHeldBillsError(error instanceof Error ? error.message : 'Could not load held bills.');
      setHeldBillsUserId(currentUserId);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!showHeldBills || heldBills.length === 0) return;
    const timer = window.setInterval(() => setHeldBillsNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [showHeldBills, heldBills.length]);

  useEffect(() => {
    if (!showHeldBills) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!heldBillsPanelRef.current?.contains(event.target as Node)) {
        setShowHeldBills(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowHeldBills(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showHeldBills]);

  useEffect(() => {
    if (!showCustomerDetails) return;
    customerPhoneRef.current?.focus();

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!customerDetailsRef.current?.contains(event.target as Node)) {
        setShowCustomerDetails(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowCustomerDetails(false);
      customerNameRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showCustomerDetails]);

  useEffect(() => {
    setShowDisplayAlternatives(readCustomerDisplayAlternatives(currentUserId));
    return subscribeCustomerDisplayAlternatives(currentUserId, setShowDisplayAlternatives);
  }, [currentUserId]);

  useEffect(() => {
    activeOptionsRef.current = activeOptions;
  }, [activeOptions]);

  // Checkout & Cash Tendered
  const [discount, setDiscount] = useState<{ mode: DiscountMode; value: string }>({ mode: 'amount', value: '' });
  const [discountNotice, setDiscountNotice] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ONLINE' | 'CREDIT' | 'SPLIT'>('CASH');
  const [tenderedAmountPKR, setTenderedAmountPKR] = useState<number | null>(null);
  const [onlineProviderId, setOnlineProviderId] = useState<PaymentProviderId>('easypaisa');
  const [onlinePaymentReference, setOnlinePaymentReference] = useState('');
  const [splitRows, setSplitRows] = useState<SplitPaymentDraft[]>([]);
  const [savedSplitRows, setSavedSplitRows] = useState<SplitPaymentDraft[]>([]);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitPaymentConfirmed, setSplitPaymentConfirmed] = useState(false);
  const [splitTouched, setSplitTouched] = useState(false);
  const [splitError, setSplitError] = useState('');
  const [showClearCartConfirm, setShowClearCartConfirm] = useState(false);
  const [isPostingSale, setIsPostingSale] = useState(false);
  const [saleError, setSaleError] = useState('');
  const [printNotice, setPrintNotice] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const { lastScanned, resetScan } = useBarcodeScanner({ enabled: activeTopTab === 'barcode' });

  // Modals — declared here so the effects below can reference showCheckoutModal
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [saleCompleteModal, setSaleCompleteModal] = useState<CompletedSale | null>(null);

  useEffect(() => {
    if (showCheckoutModal) setActiveOptions(null);
  }, [showCheckoutModal]);

  useEffect(() => { setHighlightedIndex(-1); }, [searchQuery, selectedCategory, selectedBrand]);

  // Scroll highlighted card into view
  useEffect(() => {
    if (highlightedIndex < 0 || !productGridRef.current) return;
    const cards = productGridRef.current.querySelectorAll<HTMLButtonElement>('.pos-product-card');
    cards[highlightedIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightedIndex]);

  // Global POS keyboard shortcuts
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      // F2 — focus search bar (always)
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      // F3 — focus tendered amount in checkout, otherwise toggle held bills
      if (e.key === 'F3') {
        e.preventDefault();
        if (showCheckoutModal) {
          tenderedInputRef.current?.focus();
          tenderedInputRef.current?.select();
        } else {
          setHeldBillsNow(Date.now());
          setShowHeldBills((isOpen) => !isOpen);
        }
        return;
      }
      // F6 — hold the current bill
      if (e.key === 'F6') {
        e.preventDefault();
        if (!e.repeat) holdCurrentCartRef.current();
        return;
      }
      // F4 — when modal closed: open checkout; when modal open: complete sale
      if (e.key === 'F4') {
        e.preventDefault();
        if (e.repeat || isPostingSale || isPostingSaleRef.current || showSplitModal) return;
        if (showCheckoutModal) {
          completeSaleButtonRef.current?.click();
        } else {
          chargeButtonRef.current?.click();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [showCheckoutModal, showSplitModal, isPostingSale]);

  useEffect(() => {
    let active = true;
    let requestSequence = 0;
    const refreshCatalog = () => {
      const requestId = ++requestSequence;
      setCatalogLoading(true);
      setCatalogError('');
      void loadPosCatalog()
        .then((catalog) => {
          if (active && requestId === requestSequence) setProducts(catalog);
        })
        .catch((error: unknown) => {
          if (active && requestId === requestSequence) {
            setProducts([]);
            setCatalogError(error instanceof Error ? error.message : 'Could not load the POS catalog.');
          }
        })
        .finally(() => {
          if (active && requestId === requestSequence) setCatalogLoading(false);
        });
    };
    const handleStockChanged = () => refreshCatalog();

    refreshCatalog();
    window.addEventListener(STOCK_CHANGED_EVENT, handleStockChanged);
    window.addEventListener(DEMO_DATA_CHANGED_EVENT, handleStockChanged);
    return () => {
      active = false;
      window.removeEventListener(STOCK_CHANGED_EVENT, handleStockChanged);
      window.removeEventListener(DEMO_DATA_CHANGED_EVENT, handleStockChanged);
    };
  }, [currentUserId, catalogRetry]);

  const categories = useMemo(() => ['ALL', ...Array.from(new Set(products.map((p) => p.category)))], [products]);
  const brands = useMemo(() => ['ALL', ...Array.from(new Set(products.map((p) => p.company)))], [products]);

  // Financial calculations
  const subtotalPaisa = useMemo(() => cart.reduce((sum, item) => sum + item.lineTotalPaisa, 0), [cart]);
  const subtotalPKR = subtotalPaisa / 100;

  const maxAllowedDiscount = ROLE_MAX_DISCOUNT[currentRole];
  const discountResult = useMemo(() => computeDiscount({
    billPaisa: subtotalPaisa,
    mode: discount.mode,
    value: discount.value,
    maxPercent: maxAllowedDiscount,
    maxPaisa: MAX_DISCOUNT_PAISA,
  }), [subtotalPaisa, discount.mode, discount.value, maxAllowedDiscount]);
  const discountPaisa = discountResult.discountPaisa;
  const discountPKR = discountPaisa / 100;

  const unroundedTotalPaisa = discountResult.payablePaisa;
  const roundingUnitPaisa = billingTemplate === 'pharmacy-memo' && memoSettings.roundNet !== 'none'
    ? Number(memoSettings.roundNet) * 100
    : 0;
  const totalPaisa = roundingUnitPaisa
    ? Math.floor(unroundedTotalPaisa / roundingUnitPaisa + 0.5) * roundingUnitPaisa
    : unroundedTotalPaisa;
  const tenderedAmountPaisa = tenderedAmountPKR !== null && Number.isFinite(tenderedAmountPKR)
    ? Math.max(0, Math.round(tenderedAmountPKR * 100))
    : 0;
  const customerDisplaySnapshot = useMemo(() => buildCustomerDisplaySnapshot(
    cart.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      let batchNumber = item.batchNumber;
      let expiryDate = item.expiryDate;
      if (product && item.unitId) {
        try {
          const allocations = allocateFefo(
            product.batches,
            getRequiredSmallestUnits(item.quantityInUnit, item.conversionFactor),
            localIsoDate(),
          );
          const batches = allocations.map((allocation) => allocation.batchNumber);
          const expiries = [...new Set(allocations.map((allocation) => allocation.expiryDate))];
          batchNumber = [...new Set(batches)].join(', ');
          expiryDate = expiries.join(', ');
        } catch {
          // Keep the cart's known first batch details if live reallocation is unavailable.
        }
      }
      return {
        productName: item.productName,
        unitName: item.unitName,
        quantity: item.quantityInUnit,
        batchNumber,
        expiryDate,
        unitPricePaisa: item.mrpPaisaPerUnit,
        lineTotalPaisa: item.lineTotalPaisa,
      };
    }),
    subtotalPaisa,
    discountPaisa,
    totalPaisa,
    showCheckoutModal ? 'payment' : cart.length > 0 ? 'order' : 'welcome',
    buildCustomerDisplayPayment(paymentMethod, totalPaisa, tenderedAmountPaisa),
  ), [cart, products, subtotalPaisa, discountPaisa, totalPaisa, showCheckoutModal, paymentMethod, tenderedAmountPaisa]);
  const customerDisplayMessage: CustomerDisplayMessage = displayThankYou
    ? { type: 'thank_you' }
    : activeOptions
      ? buildCustomerDisplayOptionsMessage(
          activeOptions.productName,
          activeOptions.strength,
          activeOptions.candidates,
        )
      : customerDisplaySnapshot;
  const customerDisplayMessageRef = useRef<CustomerDisplayMessage>(customerDisplayMessage);
  useEffect(() => {
    customerDisplayMessageRef.current = customerDisplayMessage;
  }, [customerDisplayMessage]);

  useEffect(() => {
    if (
      !displayChannel
      || displayChannel.userId !== currentUserId
      || !canAccessCustomerDisplay(currentRole, permissions)
    ) return;
    if (typeof BroadcastChannel === 'undefined') {
      setDisplayNotice('This browser does not support a live customer display.');
      return;
    }

    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(`pharma-care.customer-display.${displayChannel.id}`);
    } catch (error) {
      setDisplayNotice(error instanceof Error ? error.message : 'Could not start the customer display.');
      return;
    }
    displayChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseCustomerDisplayMessage(event.data);
      if (message?.type === 'ready') {
        channel.postMessage(customerDisplayMessageRef.current);
      } else if (message?.type === 'option_selected') {
        const selectedOption = activeOptionsRef.current?.candidates[message.optionIndex];
        if (selectedOption) swapOptionRef.current(selectedOption);
      }
    };
    channel.postMessage(customerDisplayMessageRef.current);

    return () => {
      channel.postMessage({ type: 'closed' });
      channel.close();
      if (displayChannelRef.current === channel) displayChannelRef.current = null;
    };
  }, [displayChannel, currentUserId, currentRole, permissions]);

  useEffect(() => {
    displayChannelRef.current?.postMessage(customerDisplayMessage);
  }, [customerDisplayMessage]);
  const roundingPaisa = totalPaisa - unroundedTotalPaisa;
  const totalPKR = totalPaisa / 100;
  const splitSummary = useMemo(
    () => getSplitPaymentSummary(splitRows, totalPaisa),
    [splitRows, totalPaisa],
  );

  const handleDiscountChange = (next: { mode: DiscountMode; value: string }) => {
    const result = computeDiscount({
      billPaisa: subtotalPaisa,
      mode: next.mode,
      value: next.value,
      maxPercent: maxAllowedDiscount,
      maxPaisa: MAX_DISCOUNT_PAISA,
    });
    if (result.error) {
      setDiscount(next);
      setDiscountNotice(result.error);
      return;
    }
    if (result.limited) {
      const amount = formatDiscountLimit(result.maxDiscountPaisa ?? 0);
      setDiscountNotice(`${next.mode === 'amount' ? 'Maximum discount is' : 'Limited to'} Rs ${amount}`);
      setDiscount(next.mode === 'amount'
        ? { mode: 'amount', value: (result.discountPaisa / 100).toFixed(2) }
        : next);
      return;
    }
    setDiscount(next);
    setDiscountNotice('');
  };

  const clearQuantityDraft = (productId: string) => {
    setQuantityDrafts((drafts) => {
      if (!(productId in drafts)) return drafts;
      const next = { ...drafts };
      delete next[productId];
      return next;
    });
  };

  const clearQuantityFeedback = (productId: string) => {
    clearQuantityDraft(productId);
    setQuantityWarnings((warnings) => {
      if (!(productId in warnings)) return warnings;
      const next = { ...warnings };
      delete next[productId];
      return next;
    });
  };

  const changeDuePaisa = paymentMethod === 'CASH'
    ? Math.max(0, tenderedAmountPaisa - totalPaisa)
    : 0;
  const changeDuePKR = changeDuePaisa / 100;
  const previousTotalPaisa = useRef(totalPaisa);
  const createSplitRow = (providerId: PaymentProviderId, amountPaisa: number): SplitPaymentDraft => ({
    id: globalThis.crypto?.randomUUID?.()
      ?? `split-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    providerId,
    amount: (amountPaisa / 100).toFixed(2),
    reference: '',
  });

  const openSplitPayment = () => {
    setPaymentMethod('SPLIT');
    if (splitRows.length === 0 && savedSplitRows.length === 0) {
      setSplitRows([createSplitRow('cash', totalPaisa)]);
    }
    setSplitError('');
    setShowSplitModal(true);
  };

  const selectPaymentMethod = (method: 'CASH' | 'ONLINE' | 'CREDIT' | 'SPLIT') => {
    if (method === 'SPLIT') {
      openSplitPayment();
      return;
    }
    setPaymentMethod(method);
  };

  const updateSplitRow = (rowId: string, update: Partial<Omit<SplitPaymentDraft, 'id'>>) => {
    setSplitRows((rows) => rows.map((row) => row.id === rowId ? { ...row, ...update } : row));
    setSplitTouched(true);
    setSplitPaymentConfirmed(false);
    setSplitError('');
  };

  const addSplitPayment = () => {
    if (splitSummary.remainingPaisa <= 0) return;
    setSplitRows((rows) => [...rows, createSplitRow('jazzcash', splitSummary.remainingPaisa)]);
    setSplitTouched(true);
    setSplitPaymentConfirmed(false);
    setSplitError('');
  };

  const removeSplitPayment = (rowId: string) => {
    setSplitRows((rows) => rows.length > 1 ? rows.filter((row) => row.id !== rowId) : rows);
    setSplitTouched(true);
    setSplitPaymentConfirmed(false);
    setSplitError('');
  };

  const closeSplitPayment = () => {
    if (splitTouched && !window.confirm('Close Split Payment? Your entered amounts will not be confirmed.')) return;
    if (splitTouched) {
      setSplitRows(savedSplitRows.map((row) => ({ ...row })));
      setSplitPaymentConfirmed(savedSplitRows.length > 0);
      setSplitTouched(false);
      setSplitError('');
    }
    setShowSplitModal(false);
  };

  const confirmSplitPayment = () => {
    if (!splitSummary.isBalanced) {
      setSplitError('Paid So Far must equal the Total Bill.');
      return;
    }
    setSavedSplitRows(splitRows.map((row) => ({ ...row })));
    setSplitPaymentConfirmed(true);
    setSplitTouched(false);
    setSplitError('');
    setShowSplitModal(false);
  };

  const clearCartContents = () => {
    setCart([]);
    setQuantityDrafts({});
    setQuantityWarnings({});
    setDiscount({ mode: 'amount', value: '' });
    setDiscountNotice('');
    setTenderedAmountPKR(null);
    setSelectedCustomerId('');
    setWalkInName('');
    setCustomerType('WALK_IN');
    setCustomerDetails(emptyCustomerDetails());
    setCustomerPhoneError('');
    setShowCustomerDetails(false);
    setPaymentMethod('CASH');
    setOnlineProviderId('easypaisa');
    setOnlinePaymentReference('');
    setSplitRows([]);
    setSavedSplitRows([]);
    setSplitPaymentConfirmed(false);
    setSplitTouched(false);
    setSplitError('');
    setShowSplitModal(false);
    setShowClearCartConfirm(false);
    setShowCheckoutModal(false);
    setSaleError('');
  };

  useEffect(() => {
    if (cart.length === 0) {
      if (discount.value !== '' || discount.mode !== 'amount') setDiscount({ mode: 'amount', value: '' });
      if (discountNotice) setDiscountNotice('');
      return;
    }
    if (discountResult.limited && discount.mode === 'amount') {
      const clampedValue = (discountResult.discountPaisa / 100).toFixed(2);
      if (discount.value !== clampedValue) {
        setDiscount({ mode: 'amount', value: clampedValue });
        setDiscountNotice(`Maximum discount is Rs ${formatDiscountLimit(discountResult.maxDiscountPaisa ?? 0)}`);
      }
    } else if (discountResult.limited && discount.mode === 'percent' && !discountNotice) {
      setDiscountNotice(`Limited to Rs ${formatDiscountLimit(discountResult.maxDiscountPaisa ?? 0)}`);
    }
  }, [
    subtotalPaisa,
    cart.length,
    discount.mode,
    discount.value,
    discountResult.limited,
    discountResult.maxDiscountPaisa,
    discountNotice,
  ]);

  useEffect(() => {
    const previousTotal = previousTotalPaisa.current;
    previousTotalPaisa.current = totalPaisa;
    if (previousTotal > 0 && tenderedAmountPaisa === previousTotal) {
      setTenderedAmountPKR(totalPaisa / 100);
    }
  }, [totalPaisa, tenderedAmountPaisa]);

  // Add Product to Cart
  const handleAddToCart = (product: PosCatalogProduct) => {
    const existingItem = cart.find((item) => item.productId === product.id);
    const preferredUnit = existingItem
      ? product.units.find((unit) => unit.id === existingItem.unitId)
      : product.units.find((unit) => unit.isDefaultSaleUnit);
    const firstUnit = preferredUnit ?? product.units[0];
    if (!firstUnit) {
      setSaleError('This product has no configured sale unit.');
      return;
    }
    const unitsToTry = existingItem
      ? [firstUnit]
      : [
          firstUnit,
          ...product.units
            .filter((unit) => unit.id !== firstUnit.id)
            .sort((left, right) => left.conversionFactor - right.conversionFactor),
        ];
    let saleUnit: PosCatalogProduct['units'][number] | undefined;
    let targetBatch: PosCatalogProduct['batches'][number] | undefined;
    let lastAllocationError: unknown;
    const quantity = (existingItem?.quantityInUnit ?? 0) + 1;
    try {
      for (const unit of unitsToTry) {
        try {
          const allocation = allocateFefo(
            product.batches,
            getRequiredSmallestUnits(quantity, unit.conversionFactor),
            localIsoDate(),
          );
          saleUnit = unit;
          targetBatch = product.batches.find((batch) => batch.id === allocation[0].batchId);
          break;
        } catch (error) {
          lastAllocationError = error;
          if (existingItem) throw error;
        }
      }
      if (!saleUnit) throw lastAllocationError ?? new RangeError('No sale unit can be fulfilled from current stock.');
    } catch (error) {
      setSaleError(error instanceof Error ? error.message : 'Unable to allocate stock for this item.');
      return;
    }
    setSaleError('');
    setDisplayThankYou(false);
    setActiveOptions(null);
    clearQuantityFeedback(product.id);

    setCart((prev) => {
      const idx = prev.findIndex((i) => i.productId === product.id);
      if (idx > -1) {
        const copy = [...prev];
        const item = copy[idx];
        const newQty = item.quantityInUnit + 1;
        copy[idx] = {
          ...item,
          quantityInUnit: newQty,
          lineTotalPaisa: newQty * item.mrpPaisaPerUnit,
        };
        return copy;
      }

      const newItem: CartItem = {
        productId: product.id,
        productName: product.brandName,
        genericName: product.genericName,
        batchId: targetBatch?.id || 'batch-1',
        batchNumber: targetBatch?.batchNumber || 'B-01',
        expiryDate: targetBatch?.expiryDate || '2027-12-31',
        drugClass: product.drugClass,
        unitId: saleUnit.id,
        unitName: saleUnit.name,
        conversionFactor: saleUnit.conversionFactor,
        quantityInUnit: 1,
        mrpPaisaPerUnit: saleUnit.pricePerUnitPaisa,
        costPaisaPerUnit: null,
        discountPercent: 0,
        lineTotalPaisa: saleUnit.pricePerUnitPaisa,
      };
      return [newItem, ...prev];
    });
    if (!existingItem) {
      window.requestAnimationFrame(() => cartItemsListRef.current?.scrollTo({ top: 0 }));
    }
    setDisplayThankYou(false);
    if (showDisplayAlternatives) {
      const lineIndex = existingItem ? cart.findIndex((item) => item.productId === product.id) : 0;
      openCustomerAlternatives(lineIndex, product.id, quantity);
    } else {
      setActiveOptions(null);
    }
  };

  const openCustomerAlternatives = (lineIndex: number, productId: string, quantityInUnit: number) => {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) return;
    setActiveOptions({
      lineIndex,
      productName: product.brandName,
      strength: product.strength ?? null,
      candidates: buildSameMedicineOptions(products, product.id, quantityInUnit),
    });
  };

  const updateQuantity = (idx: number, delta: number) => {
    const item = cart[idx];
    const product = products.find((candidate) => candidate.id === item?.productId);
    const unit = product?.units.find((candidate) => candidate.id === item?.unitId);
    if (!item || !product || !unit) {
      setSaleError('The selected product or sale unit is no longer available. Refresh the POS catalog.');
      return;
    }
    const newQty = item.quantityInUnit + delta;
    if (newQty > 0) {
      try {
        allocateFefo(
          product.batches,
          getRequiredSmallestUnits(newQty, unit.conversionFactor),
          localIsoDate(),
        );
      } catch (error) {
        setSaleError(error instanceof Error ? error.message : 'Unable to allocate stock for this item.');
        return;
      }
    }
    setCart((prev) => {
      const copy = [...prev];
      if (newQty <= 0) return copy.filter((_, i) => i !== idx);
      copy[idx] = {
        ...item,
        quantityInUnit: newQty,
        lineTotalPaisa: newQty * item.mrpPaisaPerUnit,
      };
      return copy;
    });
    clearQuantityFeedback(item.productId);
    setDisplayThankYou(false);
    setActiveOptions(null);
    setSaleError('');
  };

  const updateQuantityValue = (idx: number, requestedQuantity: number): boolean => {
    const item = cart[idx];
    const product = products.find((candidate) => candidate.id === item?.productId);
    const unit = product?.units.find((candidate) => candidate.id === item?.unitId);
    if (!item || !product || !unit) {
      setSaleError('The selected product or sale unit is no longer available. Refresh the POS catalog.');
      return false;
    }

    const maximumQuantity = Math.floor(
      availableSmallestUnits(product.batches, localIsoDate()) / unit.conversionFactor,
    );
    if (maximumQuantity < 1) {
      setQuantityWarnings((warnings) => ({
        ...warnings,
        [item.productId]: 'No full units are currently available.',
      }));
      return false;
    }

    const quantity = Math.min(requestedQuantity, maximumQuantity);
    if (requestedQuantity > maximumQuantity) {
      setQuantityWarnings((warnings) => ({
        ...warnings,
        [item.productId]: `Only ${maximumQuantity} available; quantity set to ${maximumQuantity}.`,
      }));
      setQuantityDrafts((drafts) => ({ ...drafts, [item.productId]: String(quantity) }));
    } else {
      setQuantityWarnings((warnings) => {
        if (!(item.productId in warnings)) return warnings;
        const next = { ...warnings };
        delete next[item.productId];
        return next;
      });
    }

    try {
      allocateFefo(
        product.batches,
        getRequiredSmallestUnits(quantity, unit.conversionFactor),
        localIsoDate(),
      );
    } catch (error) {
      setSaleError(error instanceof Error ? error.message : 'Unable to allocate stock for this quantity.');
      return false;
    }

    setCart((previous) => previous.map((current) => current.productId === item.productId
      ? {
          ...current,
          quantityInUnit: quantity,
          lineTotalPaisa: quantity * current.mrpPaisaPerUnit,
        }
      : current));
    setDisplayThankYou(false);
    setActiveOptions(null);
    setSaleError('');
    return true;
  };

  const handleQuantityInputChange = (idx: number, productId: string, value: string) => {
    setQuantityDrafts((drafts) => ({ ...drafts, [productId]: value }));
    setQuantityWarnings((warnings) => {
      if (!(productId in warnings)) return warnings;
      const next = { ...warnings };
      delete next[productId];
      return next;
    });
    if (!/^\d+$/.test(value)) return;
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity < 1) return;
    updateQuantityValue(idx, quantity);
  };

  const applyQuantityDraft = (idx: number, productId: string) => {
    const draft = quantityDrafts[productId];
    if (draft === undefined) return;
    if (!/^\d+$/.test(draft)) {
      clearQuantityDraft(productId);
      return;
    }

    const quantity = Number(draft);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      clearQuantityDraft(productId);
      return;
    }

    if (cart[idx]?.quantityInUnit !== quantity) {
      updateQuantityValue(idx, quantity);
    }
    clearQuantityDraft(productId);
  };

  const changeCartUnit = (idx: number, unitId: string) => {
    const item = cart[idx];
    const product = products.find((candidate) => candidate.id === item?.productId);
    const unit = product?.units.find((candidate) => candidate.id === unitId);
    if (!item || !product || !unit) {
      setSaleError('The selected sale unit is unavailable. Refresh the POS catalog.');
      return;
    }
    try {
      allocateFefo(
        product.batches,
        getRequiredSmallestUnits(item.quantityInUnit, unit.conversionFactor),
        localIsoDate(),
      );
    } catch (error) {
      setSaleError(error instanceof Error ? error.message : 'Unable to allocate stock for this sale unit.');
      return;
    }

    setCart((prev) => prev.map((current, currentIndex) => currentIndex === idx
      ? {
          ...current,
          unitId: unit.id,
          unitName: unit.name,
          conversionFactor: unit.conversionFactor,
          mrpPaisaPerUnit: unit.pricePerUnitPaisa,
          lineTotalPaisa: current.quantityInUnit * unit.pricePerUnitPaisa,
        }
      : current));
    clearQuantityFeedback(item.productId);
    setDisplayThankYou(false);
    setActiveOptions(null);
    setSaleError('');
  };

  const handleSwapOption = (option: CustomerDisplayOptionCandidate) => {
    const lineIndex = activeOptions?.lineIndex;
    const item = lineIndex === undefined ? undefined : cart[lineIndex];
    const product = products.find((candidate) => candidate.id === option.productId);
    const unit = product?.units.find((candidate) => candidate.id === option.unitId);
    if (lineIndex === undefined || !item || !product || !unit) {
      setSaleError('That option is no longer available. Refresh the POS catalog and try again.');
      setActiveOptions(null);
      return;
    }

    try {
      const batchAllocations = allocateFefo(
        product.batches,
        getRequiredSmallestUnits(item.quantityInUnit, unit.conversionFactor),
        localIsoDate(),
      );
      const firstBatch = product.batches.find((batch) => batch.id === batchAllocations[0]?.batchId);
      if (!firstBatch) throw new RangeError('No eligible batch is available for this option.');
      setCart((previous) => previous.map((current, currentIndex) => currentIndex === lineIndex
        ? {
            ...current,
            productId: product.id,
            productName: product.brandName,
            genericName: product.genericName,
            batchId: firstBatch.id,
            batchNumber: firstBatch.batchNumber,
            expiryDate: firstBatch.expiryDate,
            drugClass: product.drugClass,
            unitId: unit.id,
            unitName: unit.name,
            conversionFactor: unit.conversionFactor,
            mrpPaisaPerUnit: unit.pricePerUnitPaisa,
            costPaisaPerUnit: null,
            lineTotalPaisa: current.quantityInUnit * unit.pricePerUnitPaisa,
            batchAllocations,
          }
        : current));
      setActiveOptions(null);
      setDisplayThankYou(false);
      setSaleError('');
    } catch (error) {
      setSaleError(error instanceof Error ? error.message : 'Unable to swap to this option.');
    }
  };

  swapOptionRef.current = handleSwapOption;

  useEffect(() => {
    if (!showDisplayAlternatives) {
      setActiveOptions(null);
      return;
    }
    if (cart.length > 0) {
      const lineIndex = cart.length - 1;
      const item = cart[lineIndex];
      openCustomerAlternatives(lineIndex, item.productId, item.quantityInUnit);
    }
  }, [showDisplayAlternatives]);

  const filteredProducts = products.filter((p) => {
    const matchSearch =
      p.brandName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.genericName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode?.includes(searchQuery) ?? false) ||
      p.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCat = selectedCategory === 'ALL' || p.category === selectedCategory;
    const matchBrand = selectedBrand === 'ALL' || p.company === selectedBrand;
    return matchSearch && matchCat && matchBrand;
  });

  const submitBarcode = (rawValue: string) => {
    const normalized = normalizeScannedValue(rawValue);
    if (!normalized) {
      return;
    }

    const match = findProductByScan(products, normalized);
    if (!match) {
      setSaleError(`No product matches barcode "${normalized}".`);
      setBarcodeInput('');
      resetScan();
      return;
    }

    handleAddToCart(match);
    setBarcodeInput('');
    resetScan();
    setSearchQuery('');
    setSelectedCategory('ALL');
    setSelectedBrand('ALL');
  };

  useEffect(() => {
    if (!lastScanned) {
      return;
    }

    submitBarcode(lastScanned);
  }, [lastScanned]);

  const printSaleReceipt = async (sale: CompletedSale, autoPrint = false) => {
    try {
      const snapshot = buildPrintSnapshot(buildMemoData(sale, {
          role: currentRole,
          terminal: memoSettings.terminalName,
        }), {
          ...memoSettings,
          storeName: memoSettings.storeName || companyName,
        }, receiptFormat, billingTemplate);
      const result = await onPrintReceipt('sale', snapshot, { autoPrint });
      setPrintNotice('');
      return result === 'printed' || result === 'requested';
    } catch (error) {
      setPrintNotice(`Receipt printing failed. ${error instanceof Error ? error.message : 'The print document could not be opened.'}`);
      return false;
    }
  };

  const handleCompleteSale = () => {
    if (isPostingSale || isPostingSaleRef.current) return;
    if (cart.length === 0) return;
    const finalDiscount = computeDiscount({
      billPaisa: subtotalPaisa,
      mode: discount.mode,
      value: discount.value,
      maxPercent: maxAllowedDiscount,
      maxPaisa: MAX_DISCOUNT_PAISA,
    });
    if (finalDiscount.error) {
      setDiscountNotice(finalDiscount.error);
      return;
    }
    if (finalDiscount.limited) {
      setDiscountNotice(
        `${discount.mode === 'amount' ? 'Maximum discount is' : 'Limited to'} Rs ${formatDiscountLimit(finalDiscount.maxDiscountPaisa ?? 0)}`,
      );
      return;
    }

    let items: CartItem[];
    try {
      items = cart.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        if (!product) throw new RangeError(`Product ${item.productName} is no longer available.`);
        const batchAllocations = allocateFefo(
          product.batches,
          getRequiredSmallestUnits(item.quantityInUnit, item.conversionFactor),
          localIsoDate()
        );
        const firstBatch = product.batches.find((batch) => batch.id === batchAllocations[0].batchId);
        if (!firstBatch) throw new RangeError(`No eligible batch is available for ${item.productName}.`);
        return {
          ...item,
          batchId: firstBatch.id,
          batchNumber: firstBatch.batchNumber,
          expiryDate: firstBatch.expiryDate,
          batchAllocations,
        };
      });
    } catch (error) {
      setSaleError(error instanceof Error ? error.message : 'Unable to allocate stock for this sale.');
      return;
    }

    setSaleError('');
    const customer = customers.find((c) => c.id === selectedCustomerId);
    const phoneError = customer ? '' : customerPhoneValidationError(customerDetails);
    if (phoneError) {
      setCustomerPhoneError(phoneError);
      setShowCustomerDetails(true);
      setSaleError('Check the customer phone number before charging.');
      return;
    }
    setCustomerPhoneError('');
    let payments: PostSaleInput['payments'];
    let tenderedPaisa: number;
    if (paymentMethod === 'CREDIT') {
      if (!customer) {
        setSaleError('Select a registered customer before making a credit sale.');
        return;
      }
      payments = [{ paymentMethod: PaymentMethod.CREDIT, amountPaisa: totalPaisa }];
      tenderedPaisa = 0;
    } else if (paymentMethod === 'ONLINE') {
      if (onlineProviderId === 'cash' || onlineProviderId === 'card') {
        setSaleError('Choose a mobile wallet or bank provider for an online payment.');
        return;
      }
      payments = [{
        paymentMethod: getPaymentMethodForProvider(onlineProviderId),
        amountPaisa: totalPaisa,
        providerId: onlineProviderId,
        ...(onlinePaymentReference.trim() ? { reference: onlinePaymentReference.trim() } : {}),
      }];
      tenderedPaisa = totalPaisa;
    } else if (paymentMethod === 'SPLIT') {
      if (!splitPaymentConfirmed || !splitSummary.isBalanced) {
        if (splitRows.length === 0 && savedSplitRows.length === 0) {
          setSplitRows([createSplitRow('cash', totalPaisa)]);
        }
        setShowSplitModal(true);
        setSplitError(splitPaymentConfirmed ? 'Paid So Far must equal the Total Bill.' : '');
        return;
      }
      const splitPayments: PostSaleInput['payments'] = [];
      for (const row of splitRows) {
        const amountPaisa = parsePaisaAmount(row.amount);
        if (amountPaisa === null || amountPaisa <= 0) {
          setSplitError('Every split payment must be greater than zero.');
          setShowSplitModal(true);
          return;
        }
        splitPayments.push({
          paymentMethod: getPaymentMethodForProvider(row.providerId),
          amountPaisa,
          providerId: row.providerId,
          ...(row.reference.trim() && row.providerId !== 'cash'
            ? { reference: row.reference.trim() }
            : {}),
        });
      }
      payments = splitPayments;
      tenderedPaisa = totalPaisa;
    } else {
      tenderedPaisa = tenderedAmountPKR === null ? totalPaisa : tenderedAmountPaisa;
      if (tenderedPaisa < totalPaisa) {
        setSaleError('Tendered cash cannot be less than the bill total.');
        return;
      }
      payments = [{
        paymentMethod: PaymentMethod.CASH,
        amountPaisa: totalPaisa,
        providerId: 'cash',
      }];
    }

    const saleItems: PostSaleInput['items'] = [];
    for (const item of items) {
      if (!item.unitId) {
        setSaleError(`Choose a configured sale unit for ${item.productName}.`);
        return;
      }
      saleItems.push({
        medicineId: item.productId,
        unitId: item.unitId,
        quantityInUnit: item.quantityInUnit,
      });
    }
    const saleInput: PostSaleInput = {
      customerId: customer?.id ?? null,
      customerName: resolvePosCustomerName(customer?.name, walkInName),
      customerType: paymentMethod === 'CREDIT' ? 'CREDIT' : customerType,
      customerPhone: customer?.phone ?? customerDetails.phone.trim(),
      customerWhatsapp: customer
        ? customer.phone
        : customerDetails.sameWhatsappAsPhone
          ? customerDetails.phone.trim()
          : customerDetails.whatsapp.trim(),
      customerAddress: customer?.address ?? customerDetails.address.trim(),
      customerNotes: customer ? '' : customerDetails.notes.trim(),
      items: saleItems,
      discountPaisa,
      roundingPaisa,
      tenderedPaisa,
      payments,
    };

    isPostingSaleRef.current = true;
    setIsPostingSale(true);
    void postSale(saleInput).then((sale) => {
      onSaleComplete(sale);
      setShowCheckoutModal(false);
      setSaleCompleteModal(sale);
      setDisplayThankYou(true);
      setActiveOptions(null);
      if (memoSettings.autoPrint) {
        if (canPrintReceipt(currentRole, permissions, 'sale')) {
          window.setTimeout(() => { void printSaleReceipt(sale, true); }, 0);
        } else {
          setPrintNotice('Auto-print is disabled for this account. Use Request print to ask an admin.');
        }
      }
      clearCartContents();
    }).catch((error: unknown) => {
      setSaleError(error instanceof Error ? error.message : 'Could not complete the sale.');
    }).finally(() => {
      isPostingSaleRef.current = false;
      setIsPostingSale(false);
    });
  };

  const saveHeldBillList = (nextBills: HeldBill[]) => {
    if (heldBillsUserId !== currentUserId || heldBillsError) {
      setHeldBillsError(heldBillsError || 'Held bills are still loading. Try again in a moment.');
      return false;
    }
    try {
      writeHeldBills(currentUserId, nextBills);
      setHeldBills(nextBills);
      setHeldBillsError('');
      return true;
    } catch (error) {
      setHeldBillsError(error instanceof Error ? error.message : 'Could not save held bills.');
      return false;
    }
  };

  const createCurrentHeldBill = (): HeldBill => ({
    id: globalThis.crypto?.randomUUID?.()
      ?? `held-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    heldAt: Date.now(),
    cart: cart.map((item) => ({
      ...item,
      ...(item.batchAllocations
        ? { batchAllocations: item.batchAllocations.map((allocation) => ({ ...allocation })) }
        : {}),
    })),
    discount: { ...discount },
    customerId: selectedCustomerId,
    customerName: resolvePosCustomerName(
      customers.find((customer) => customer.id === selectedCustomerId)?.name,
      walkInName,
    ),
    customerType,
    totalPaisa,
  });

  const handleHoldCurrentBill = () => {
    if (isPostingSale || isPostingSaleRef.current) return;
    if (cart.length === 0) {
      setSaleError('Add at least one item before holding a bill.');
      return;
    }
    if (!saveHeldBillList([createCurrentHeldBill(), ...heldBills])) return;

    clearCartContents();
    setDisplayThankYou(false);
    setActiveOptions(null);
  };
  holdCurrentCartRef.current = handleHoldCurrentBill;

  const handleResumeHeldBill = (heldBill: HeldBill) => {
    if (isPostingSale || isPostingSaleRef.current) return;
    const nextBills = heldBills.filter((bill) => bill.id !== heldBill.id);
    if (cart.length > 0) {
      nextBills.unshift(createCurrentHeldBill());
    }
    if (!saveHeldBillList(nextBills)) return;

    const customerStillExists = customers.some((customer) => customer.id === heldBill.customerId);
    setCart(heldBill.cart.map((item) => ({
      ...item,
      ...(item.batchAllocations
        ? { batchAllocations: item.batchAllocations.map((allocation) => ({ ...allocation })) }
        : {}),
    })));
    setQuantityDrafts({});
    setQuantityWarnings({});
    setDiscount({ ...heldBill.discount });
    setSelectedCustomerId(customerStillExists ? heldBill.customerId : '');
    setWalkInName(customerStillExists ? '' : heldBill.customerName);
    setCustomerType(heldBill.customerType);
    setCustomerDetails(emptyCustomerDetails());
    setCustomerPhoneError('');
    setShowCustomerDetails(false);
    setTenderedAmountPKR(null);
    setPaymentMethod('CASH');
    setOnlineProviderId('easypaisa');
    setOnlinePaymentReference('');
    setSplitRows([]);
    setSavedSplitRows([]);
    setSplitPaymentConfirmed(false);
    setSplitTouched(false);
    setSplitError('');
    setShowSplitModal(false);
    setShowCheckoutModal(false);
    setShowHeldBills(false);
    setDisplayThankYou(false);
    setActiveOptions(null);
    setSaleError('');
  };

  const handleDeleteHeldBill = (heldBill: HeldBill) => {
    const customerName = heldBill.customerName || 'this customer';
    if (!window.confirm(`Delete the held bill for ${customerName}? This cannot be undone.`)) return;
    saveHeldBillList(heldBills.filter((bill) => bill.id !== heldBill.id));
  };

  const openCustomerDisplay = () => {
    if (!canAccessCustomerDisplay(currentRole, permissions)) {
      setDisplayNotice('POS access is required to open the customer display.');
      return;
    }
    let channelId: string;
    try {
      channelId = getCustomerDisplayChannelId(currentUserId);
    } catch (error) {
      setDisplayNotice(error instanceof Error ? error.message : 'Could not load the customer display link.');
      return;
    }
    setDisplayChannel({ userId: currentUserId, id: channelId });

    const displayWindow = window.open('about:blank', '_blank');
    if (!displayWindow) {
      setDisplayNotice('The customer display window was blocked. Allow pop-ups and try again.');
      return;
    }
    displayWindow.opener = null;
    const displayUrl = new URL('/customer-display', window.location.origin);
    displayUrl.searchParams.set('channel', channelId);
    displayWindow.location.replace(displayUrl.toString());
    setDisplayNotice('Customer display opened.');
  };

  const currentUserHeldBills = heldBillsUserId === currentUserId ? heldBills : [];

  return (
    <div className="flex h-auto min-h-[600px] flex-col gap-1 lg:h-full lg:min-h-0">
      {saleError && !showCheckoutModal && !showSplitModal && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {saleError}
        </div>
      )}
      {heldBillsError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {heldBillsError}
        </div>
      )}
      {printNotice && <p role="status" className="rounded-control border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-text shrink-0">{printNotice}</p>}
      {displayNotice && <p role="status" className="rounded-control border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-text shrink-0">{displayNotice}</p>}

      {/* ── Main Split View ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0 items-stretch">
        {/* Left 7 Cols: Product Catalog & Fast Search */}
        <div className="lg:col-span-7 flex flex-col gap-2 min-h-0">
          {/* Top Tabs moved here to eliminate right-side gap */}
          <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
            <div className="flex w-fit max-w-full flex-wrap items-center gap-1.5 bg-surface p-1 rounded-xl border border-border shadow-xs">
              <button
                type="button"
                onClick={() => setActiveTopTab('sale')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTopTab === 'sale'
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-muted hover:bg-surface-2'
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>Sale</span>
              </button>

              <SaleReturnsPanel
                canReview={(currentRole === UserRole.MANAGER || currentRole === UserRole.ADMIN)
                  && permissions.includes('sales_history')}
                canRestock={permissions.includes('stock_inventory')}
                triggerClassName="px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-muted hover:bg-surface-2 border-0 bg-transparent shadow-none"
              />

              <button
                type="button"
                onClick={() => {
                  const next = activeTopTab === 'barcode' ? 'sale' : 'barcode';
                  setActiveTopTab(next);
                  if (next === 'barcode') {
                    setTimeout(() => searchInputRef.current?.focus(), 50);
                  }
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTopTab === 'barcode'
                    ? 'bg-primary text-white shadow-xs ring-2 ring-accent'
                    : 'text-muted hover:bg-surface-2'
                }`}
              >
                <Barcode className="w-3.5 h-3.5" />
                <span>Barcode Scan</span>
              </button>

              <div ref={heldBillsPanelRef} className="relative">
                <button
                  type="button"
                  aria-controls="pos-held-bills-panel"
                  aria-expanded={showHeldBills}
                  aria-label={`Held bills, ${currentUserHeldBills.length} saved`}
                  onClick={() => {
                    setHeldBillsNow(Date.now());
                    setShowHeldBills((isOpen) => !isOpen);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                    showHeldBills
                      ? 'bg-primary text-white shadow-xs'
                      : 'text-muted hover:bg-surface-2'
                  }`}
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Held</span>
                  <span className={`min-w-4 rounded-full px-1 text-center text-[10px] leading-4 ${
                    showHeldBills ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                  }`}>
                    {currentUserHeldBills.length}
                  </span>
                  <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    showHeldBills ? 'bg-white/20 text-white' : 'bg-surface-2 text-muted'
                  }`}>
                    F3
                  </span>
                </button>

                {showHeldBills && (
                  <div
                    id="pos-held-bills-panel"
                    role="region"
                    aria-label="Held bills"
                    className="absolute right-0 top-full z-40 mt-2 flex max-h-96 w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface text-text shadow-xl"
                  >
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                      <h2 className="text-xs font-bold">Held bills</h2>
                      <span className="text-[10px] font-semibold text-muted">
                        {currentUserHeldBills.length}
                      </span>
                    </div>
                    {currentUserHeldBills.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-muted">No held bills</p>
                    ) : (
                      <div className="space-y-2 overflow-y-auto p-2">
                        {currentUserHeldBills.map((heldBill) => {
                          const itemCount = heldBill.cart.reduce(
                            (count, item) => count + item.quantityInUnit,
                            0,
                          );
                          const minutesSinceHeld = Math.floor(
                            Math.max(0, heldBillsNow - heldBill.heldAt) / 60_000,
                          );
                          return (
                            <article
                              key={heldBill.id}
                              className="rounded-lg border border-border bg-surface-2 p-2.5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold">
                                    {heldBill.customerName || 'Walk-in customer'}
                                  </p>
                                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                                    <span>{itemCount} items</span>
                                    <span aria-hidden="true">·</span>
                                    <Clock3 className="h-3 w-3" />
                                    <span>{minutesSinceHeld} min ago</span>
                                  </p>
                                </div>
                                <span className="shrink-0 font-mono text-xs font-bold">
                                  Rs. {(heldBill.totalPaisa / 100).toFixed(2)}
                                </span>
                              </div>
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleResumeHeldBill(heldBill)}
                                  className="flex-1 rounded-control bg-primary px-2 py-1.5 text-[10px] font-bold text-white hover:brightness-95"
                                >
                                  Resume
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteHeldBill(heldBill)}
                                  className="flex-1 rounded-control border border-danger/40 px-2 py-1.5 text-[10px] font-bold text-danger hover:bg-danger/5"
                                >
                                  <Trash2 className="mr-1 inline h-3 w-3" />
                                  Delete
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex justify-between border-t border-border px-3 py-2 text-[10px] font-semibold text-muted">
                      <span>F3 open held</span>
                      <span>F6 hold bill</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {catalogError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-center justify-between gap-3">
              <span>{catalogError}</span>
              <button
                type="button"
                onClick={() => setCatalogRetry((retry) => retry + 1)}
                className="shrink-0 rounded-lg border border-red-300 bg-white px-2.5 py-1 font-bold text-red-800"
              >
                Retry
              </button>
            </div>
          )}

          {/* Unified Search Bar & Filters with Integrated Barcode Scan */}
          <div className={`p-2.5 rounded-2xl border transition-all shadow-xs flex flex-col sm:flex-row gap-2 ${
            activeTopTab === 'barcode'
              ? 'bg-blue-50/60 border-blue-300 ring-2 ring-blue-500/20'
              : 'bg-white border-slate-200/90'
          }`}>
            <div className="relative flex-1 flex items-center">
              {activeTopTab === 'barcode' ? (
                <Barcode className="w-4 h-4 text-blue-600 absolute left-3 pointer-events-none" />
              ) : (
                <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
              )}
              <input
                ref={searchInputRef}
                type="text"
                placeholder={
                  activeTopTab === 'barcode'
                    ? 'Scan barcode or enter code (Enter to add)...'
                    : 'Search by name / brand / barcode...'
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Barcode scan: Enter submits the scanned value
                  if (e.key === 'Enter' && activeTopTab === 'barcode' && searchQuery.trim()) {
                    e.preventDefault();
                    submitBarcode(searchQuery);
                    return;
                  }
                  // Sale mode: Enter adds the highlighted product
                  if (e.key === 'Enter' && activeTopTab === 'sale' && highlightedIndex >= 0) {
                    e.preventDefault();
                    const product = filteredProducts[highlightedIndex];
                    if (product) { handleAddToCart(product); setHighlightedIndex(-1); }
                    return;
                  }
                  // Arrow Down — move highlight forward
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightedIndex((prev) => Math.min(prev + 1, filteredProducts.length - 1));
                    return;
                  }
                  // Arrow Up — move highlight backward
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightedIndex((prev) => Math.max(prev - 1, 0));
                    return;
                  }
                  // Escape — clear search and reset highlight
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSearchQuery('');
                    setHighlightedIndex(-1);
                  }
                }}
                className="w-full pl-9 pr-16 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-blue-600 font-medium bg-white"
                autoFocus
              />
              {/* F2 badge — sale mode */}
              {activeTopTab === 'sale' && (
                <div className="absolute right-2 flex items-center gap-1">
                  {highlightedIndex >= 0 && (
                    <span className="text-[9px] font-semibold text-slate-400">
                      {highlightedIndex + 1}/{filteredProducts.length}
                    </span>
                  )}
                  <span
                    title="Press F2 to focus this search bar"
                    className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 uppercase tracking-wider select-none"
                  >
                    F2
                  </span>
                </div>
              )}
              {activeTopTab === 'barcode' && (
                <div className="absolute right-2 flex items-center gap-1.5">
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-[10px] text-slate-500 hover:text-slate-800 px-1 font-semibold"
                    >
                      Clear
                    </button>
                  )}
                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase tracking-wider">
                    SCAN
                  </span>
                </div>
              )}
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-blue-600 bg-white text-slate-800"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'ALL' ? 'All Categories' : c}
                </option>
              ))}
            </select>

            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-blue-600 bg-white text-slate-800"
            >
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b === 'ALL' ? 'All Brands' : b}
                </option>
              ))}
            </select>
          </div>

          {/* Product Chips Grid (Matching Screenshot 7) */}
          <div ref={productGridRef} className="pos-product-grid grid grid-cols-2 sm:grid-cols-3 gap-2 flex-1 min-h-0 overflow-y-auto pr-1">
            {catalogLoading && products.length === 0 && (
              <div role="status" className="col-span-full rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                Loading live product catalog...
              </div>
            )}
            {filteredProducts.map((p) => {
              const defaultUnit = p.units.find((u) => u.isDefaultSaleUnit) || p.units[0];
              const totalStock = p.batches.reduce((sum, b) => sum + b.quantitySmallestUnit, 0);

              const cardIndex = filteredProducts.indexOf(p);
              return (
                <button
                  key={p.id}
                  onClick={() => handleAddToCart(p)}
                  className={`pos-product-card p-2.5 rounded-xl border shadow-xs text-left transition flex flex-col justify-between group h-28 ${
                    cardIndex === highlightedIndex
                      ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-400/50'
                      : 'bg-white border-slate-200/90 hover:border-blue-500 hover:shadow-sm'
                  }`}
                >
                  <div>
                    <span className="font-bold text-xs text-slate-900 group-hover:text-blue-600 transition block truncate">
                      {p.brandName}
                    </span>
                    {p.strength && (
                      <span className="text-[10px] text-slate-500 block truncate">{p.strength}</span>
                    )}
                    <span className="text-[10px] text-slate-500 block truncate">
                      {p.genericName} • {p.company}
                    </span>
                  </div>

                  <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono font-black text-slate-900 block">
                        Rs. {(defaultUnit.pricePerUnitPaisa / 100).toFixed(0)}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        Stock: {totalStock}
                      </span>
                    </div>
                    <span className="pos-add-indicator w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs group-hover:bg-blue-600 group-hover:text-white transition">
                      +
                    </span>
                  </div>
                </button>
              );
            })}
            {!catalogLoading && !catalogError && filteredProducts.length === 0 && (
              <div className="col-span-full rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                {products.length === 0 ? 'No sellable products are available.' : 'No products match your search.'}
              </div>
            )}
          </div>
        </div>

        {/* Right 5 Cols: Cart & Checkout Bar (Matching Screenshot 7, 8, 61, 62) */}
        <div className="lg:col-span-5 overflow-hidden bg-white p-3 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col h-full min-h-0">
          <div className="flex flex-col min-h-0 flex-1">
            {/* Top Cart Header & Layout Switches (Matching Screenshot 7) */}
            <div className="shrink-0 border-b border-slate-100 pb-1 mb-1">
              <div className="flex h-8 min-w-0 items-center gap-1">
                <ShoppingCart className="h-4 w-4 shrink-0 text-blue-600" />
                <span className="pos-cart-count shrink-0 whitespace-nowrap text-xs font-black text-slate-900" key={cart.reduce((sum, i) => sum + i.quantityInUnit, 0)}>
                  Cart ({cart.reduce((sum, i) => sum + i.quantityInUnit, 0)})
                </span>
                <button
                  type="button"
                  onClick={openCustomerDisplay}
                  aria-label="Open customer display"
                  title="Open customer display"
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-slate-300 px-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Monitor className="h-3.5 w-3.5" />
                  <span>Display</span>
                </button>
                <select
                  aria-label="Customer type"
                  value={customerType}
                  onChange={(event) => {
                    const nextType = event.target.value as SaleCustomerType;
                    setCustomerType(nextType);
                    if (nextType !== 'REGISTERED' && nextType !== 'CREDIT' && selectedCustomerId) {
                      const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
                      setWalkInName(selectedCustomer?.name ?? '');
                      setCustomerDetails({
                        ...emptyCustomerDetails(),
                        phone: selectedCustomer?.phone ?? '',
                        whatsapp: selectedCustomer?.phone ?? '',
                        address: selectedCustomer?.address ?? '',
                      });
                      setSelectedCustomerId('');
                    }
                  }}
                  className="h-7 w-[118px] max-w-[31%] min-w-0 shrink rounded-lg border border-slate-300 bg-white px-1 text-[10px] font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="WALK_IN">Walk-in Customer</option>
                  <option value="REGISTERED">Registered Customer</option>
                  <option value="CREDIT">Credit Customer</option>
                  <option value="DOCTOR_CLINIC">Doctor / Clinic</option>
                  <option value="WHOLESALE_RETAILER">Wholesale / Retailer</option>
                </select>
                <div className="relative min-w-0 flex-1" ref={customerDetailsRef}>
                  <input
                    ref={customerNameRef}
                    type="text"
                    placeholder="Customer name (optional)"
                    aria-label="Walk-in customer name"
                    aria-haspopup="dialog"
                    aria-expanded={showCustomerDetails}
                    aria-controls="pos-customer-details"
                    value={walkInName}
                    onChange={(event) => setWalkInName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      const name = walkInName.trim();
                      if (!name) return;
                      setWalkInName(name);
                      setCustomerPhoneError('');
                      setShowCustomerDetails(true);
                    }}
                    className="h-7 w-full min-w-0 rounded-lg border border-slate-300 px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  {showCustomerDetails && (
                    <div
                      role="dialog"
                      id="pos-customer-details"
                      aria-label="Customer Details"
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        const phoneError = customerPhoneValidationError(customerDetails);
                        if (phoneError) {
                          setCustomerPhoneError(phoneError);
                          return;
                        }
                        setCustomerPhoneError('');
                        setShowCustomerDetails(false);
                        customerNameRef.current?.focus();
                      }}
                      className="absolute right-0 top-full z-40 mt-1 w-[min(18rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-border bg-surface p-3 text-left shadow-lg"
                    >
                        <div>
                          <h3 className="text-xs font-bold text-text">Customer Details</h3>
                          <p className="truncate text-[11px] text-muted">{walkInName.trim()}</p>
                        </div>
                        <label className="grid gap-1 text-[10px] font-semibold text-muted">
                          Phone number
                          <input
                            ref={customerPhoneRef}
                            aria-describedby={customerPhoneError ? 'pos-customer-phone-error' : undefined}
                            type="tel"
                            inputMode="tel"
                            value={customerDetails.phone}
                            onChange={(event) => {
                              const phone = event.target.value;
                              const nextDetails = {
                                ...customerDetails,
                                phone,
                                ...(customerDetails.sameWhatsappAsPhone ? { whatsapp: phone } : {}),
                              };
                              setCustomerDetails(nextDetails);
                              setCustomerPhoneError(customerPhoneValidationError(nextDetails));
                            }}
                            className="rounded-control border border-border bg-surface px-2 py-1.5 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] font-medium text-text">
                          <input
                            type="checkbox"
                            checked={customerDetails.sameWhatsappAsPhone}
                            onChange={(event) => setCustomerDetails((details) => ({
                              ...details,
                              sameWhatsappAsPhone: event.target.checked,
                              whatsapp: event.target.checked ? details.phone : details.whatsapp,
                            }))}
                          />
                          WhatsApp number is the same as phone
                        </label>
                        {!customerDetails.sameWhatsappAsPhone && (
                          <label className="grid gap-1 text-[10px] font-semibold text-muted">
                            WhatsApp number
                            <input
                              type="tel"
                              inputMode="tel"
                              value={customerDetails.whatsapp}
                              onChange={(event) => {
                                const whatsapp = event.target.value;
                                const nextDetails = { ...customerDetails, whatsapp };
                                setCustomerDetails(nextDetails);
                                setCustomerPhoneError(customerPhoneValidationError(nextDetails));
                              }}
                              className="rounded-control border border-border bg-surface px-2 py-1.5 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            />
                          </label>
                        )}
                        <label className="grid gap-1 text-[10px] font-semibold text-muted">
                          Address
                          <input
                            type="text"
                            value={customerDetails.address}
                            onChange={(event) => setCustomerDetails((details) => ({
                              ...details,
                              address: event.target.value,
                            }))}
                            className="rounded-control border border-border bg-surface px-2 py-1.5 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          />
                        </label>
                        <label className="grid gap-1 text-[10px] font-semibold text-muted">
                          Notes
                          <input
                            type="text"
                            value={customerDetails.notes}
                            onChange={(event) => setCustomerDetails((details) => ({
                              ...details,
                              notes: event.target.value,
                            }))}
                            className="rounded-control border border-border bg-surface px-2 py-1.5 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          />
                        </label>
                        {customerPhoneError && (
                          <p id="pos-customer-phone-error" role="alert" className="text-[10px] font-semibold text-danger">
                            {customerPhoneError}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const phoneError = customerPhoneValidationError(customerDetails);
                            if (phoneError) {
                              setCustomerPhoneError(phoneError);
                              return;
                            }
                            setCustomerPhoneError('');
                            setShowCustomerDetails(false);
                            customerNameRef.current?.focus();
                          }}
                          className="w-full rounded-control bg-primary px-3 py-1.5 text-xs font-bold text-white"
                        >
                          Done
                        </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Cart Items List — with flex-1 min-h-0 overflow-y-auto so it stretches full card height */}
            <div ref={cartItemsListRef} className="space-y-1.5 flex-1 min-h-0 overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <Package className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                  Cart is empty
                  <p className="text-[10px] text-slate-400">Click products on left panel to add</p>
                </div>
              ) : (
                cart.map((item, idx) => (
                  <div
                    key={item.productId}
                    className="pos-cart-item p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-bold text-slate-900 truncate">{item.productName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        Rs. {(item.mrpPaisaPerUnit / 100).toFixed(0)} × {item.quantityInUnit} · {item.unitName}
                      </div>
                      {products.find((product) => product.id === item.productId)?.units.length ? (
                        <label className="mt-1 block max-w-44">
                          <span className="sr-only">Sale unit for {item.productName}</span>
                          <select
                            value={item.unitId ?? ''}
                            onChange={(event) => changeCartUnit(idx, event.target.value)}
                            className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-[10px] text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {products.find((product) => product.id === item.productId)?.units.map((unit) => (
                              <option key={unit.id} value={unit.id}>
                                {unit.name} · {unit.conversionFactor} base units · Rs. {(unit.pricePerUnitPaisa / 100).toFixed(2)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {quantityWarnings[item.productId] && (
                        <p role="status" className="mt-1 text-[10px] font-medium text-warning">
                          {quantityWarnings[item.productId]}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-slate-300 rounded bg-white">
                        <button
                          onClick={() => updateQuantity(idx, -1)}
                          className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100"
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          aria-label={`Quantity of ${item.productName}`}
                          value={quantityDrafts[item.productId] ?? String(item.quantityInUnit)}
                          onFocus={(event) => event.currentTarget.select()}
                          onClick={(event) => event.currentTarget.select()}
                          onChange={(event) => handleQuantityInputChange(idx, item.productId, event.target.value)}
                          onBlur={() => applyQuantityDraft(idx, item.productId)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            applyQuantityDraft(idx, item.productId);
                          }}
                          className="w-10 rounded-sm bg-transparent px-0.5 text-center font-mono text-xs font-bold selection:bg-blue-200 focus:bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => updateQuantity(idx, 1)}
                          className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      </div>

                      <span className="font-mono font-bold text-slate-900 min-w-[50px] text-right">
                        Rs. {(item.lineTotalPaisa / 100).toFixed(0)}
                      </span>

                      <button
                        onClick={() => updateQuantity(idx, -item.quantityInUnit)}
                        className="text-slate-400 hover:text-red-500 p-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Bottom Dock Checkout Panel (Matching Screenshot 8, 61, 62) ─── */}
          <div className="mt-auto shrink-0 space-y-1.5 border-t border-slate-200 pt-1.5">
            <div className="flex min-w-0 items-center justify-between gap-1 text-[10px]">
              <span className="shrink-0 font-medium text-slate-600">
                Subtotal <strong className="font-mono text-slate-900">Rs. {subtotalPKR.toFixed(0)}</strong>
              </span>
              <div className="flex min-w-0 items-center gap-1 font-semibold text-slate-600">
                <span>Disc:</span>
                <label className="inline-flex min-w-0 items-center gap-1 rounded-control border border-border bg-surface px-1.5 text-text focus-within:ring-2 focus-within:ring-accent">
                  <span className="text-muted">Rs.</span>
                  <input
                    aria-label="Cart discount amount"
                    type="text"
                    inputMode="decimal"
                    value={discount.mode === 'amount' ? discount.value : discountPKR.toFixed(2)}
                    disabled={cart.length === 0}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!/^\d*(?:\.\d{0,2})?$/.test(value)) {
                        setDiscountNotice('Enter a valid discount.');
                        return;
                      }
                      handleDiscountChange({ mode: 'amount', value });
                    }}
                    className="w-14 min-w-0 bg-transparent py-1 font-mono text-text outline-none disabled:cursor-not-allowed"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => handleDiscountChange({ mode: 'amount', value: '' })}
                  className="rounded-control px-1 py-1 text-[10px] font-semibold text-muted hover:bg-surface disabled:cursor-not-allowed"
                  disabled={cart.length === 0}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-1">
              <div className="pos-discount-options flex min-w-0 items-center gap-0.5 text-[9px]">
                {[0, 2, 5, 10, 15, 20].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleDiscountChange({ mode: 'percent', value: String(pct) })}
                    disabled={cart.length === 0}
                    aria-pressed={discount.mode === 'percent' && Number(discount.value || 0) === pct}
                    className={`rounded px-1 py-1 font-bold transition ${
                      discount.mode === 'percent' && Number(discount.value || 0) === pct
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {pct === 0 ? '0' : `${pct}%`}
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-700">NET TOTAL</span>
                <span className="pos-total-value whitespace-nowrap font-mono text-base font-black text-slate-950" key={totalPKR}>
                  Rs. {totalPKR.toFixed(2)}
                </span>
              </div>
            </div>
            {discountNotice && cart.length > 0 && (
              <p role="alert" className="text-[10px] font-semibold text-danger">{discountNotice}</p>
            )}

            {paymentMethod === 'CASH' && (
              <div className="flex min-w-0 items-center gap-1 text-[10px]">
                <span className="shrink-0 font-semibold text-muted">Tendered:</span>
                <input
                  type="number"
                  min={totalPKR}
                  step="0.01"
                  placeholder="0"
                  value={tenderedAmountPKR ?? ''}
                  onChange={(event) => setTenderedAmountPKR(event.target.value === '' ? null : Number(event.target.value))}
                  className="w-16 shrink-0 rounded-control border border-border bg-surface px-1.5 py-1 font-mono text-[11px] font-bold text-text"
                />
                <button
                  type="button"
                  onClick={() => setTenderedAmountPKR(totalPKR)}
                  className="shrink-0 rounded-control bg-primary px-1.5 py-1 font-bold text-white"
                >
                  Exact
                </button>
                <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
                  {[50, 100, 500, 1000, 5000].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setTenderedAmountPKR(amount)}
                      className="min-w-0 rounded-control border border-border bg-surface px-1 py-1 font-semibold text-text hover:bg-surface-muted"
                    >
                      {amount >= 1000 ? `${amount / 1000}k` : amount}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {changeDuePKR > 0 && paymentMethod === 'CASH' && (
              <p className="text-right text-[10px] font-semibold text-emerald-800">
                Change due: Rs. {changeDuePKR.toFixed(2)}
              </p>
            )}

            <div className="pos-payment-methods grid grid-cols-4 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => selectPaymentMethod('CASH')}
                aria-pressed={paymentMethod === 'CASH'}
                className={`rounded-lg border py-1 font-bold text-[11px] transition ${
                  paymentMethod === 'CASH'
                    ? 'border-emerald-700 bg-emerald-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Cash
              </button>
              <button
                type="button"
                onClick={() => selectPaymentMethod('ONLINE')}
                aria-pressed={paymentMethod === 'ONLINE'}
                className={`rounded-lg border py-1 font-bold text-[11px] transition ${
                  paymentMethod === 'ONLINE'
                    ? 'border-blue-700 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Online
              </button>
              <button
                type="button"
                onClick={() => selectPaymentMethod('CREDIT')}
                aria-pressed={paymentMethod === 'CREDIT'}
                className={`rounded-lg border py-1 font-bold text-[11px] transition ${
                  paymentMethod === 'CREDIT'
                    ? 'border-amber-700 bg-amber-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Credit
              </button>
              <button
                type="button"
                onClick={() => selectPaymentMethod('SPLIT')}
                aria-pressed={paymentMethod === 'SPLIT'}
                className={`rounded-lg border py-1 font-bold text-[11px] transition ${
                  paymentMethod === 'SPLIT'
                    ? 'border-purple-700 bg-purple-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Split
              </button>
            </div>

            {paymentMethod === 'ONLINE' && (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-1.5">
                <label className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-muted">
                  Provider
                  <PaymentProviderSelect
                    value={onlineProviderId}
                    onChange={setOnlineProviderId}
                    ariaLabel="Online payment provider"
                  />
                </label>
                <label className="grid min-w-0 gap-0.5 text-[9px] font-semibold text-muted">
                  TID / Ref
                  <input
                    type="text"
                    value={onlinePaymentReference}
                    onChange={(event) => setOnlinePaymentReference(event.target.value)}
                    placeholder="TID / Ref (optional)"
                    maxLength={200}
                    className="h-9 w-full min-w-0 rounded-control border border-border bg-surface px-2 text-xs font-normal text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </label>
              </div>
            )}

            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={handleHoldCurrentBill}
                disabled={cart.length === 0 || isPostingSale}
                aria-label="Hold the cart"
                title={'Hold the cart\nPress F6 to hold this bill'}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/40 text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                <Pause aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowClearCartConfirm(true)}
                disabled={cart.length === 0 || isPostingSale}
                aria-label="Clear cart"
                title="Clear cart"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/40 text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                ref={chargeButtonRef}
                type="button"
                onClick={() => {
                  setShowHeldBills(false);
                  setShowCheckoutModal(true);
                }}
                disabled={cart.length === 0 || isPostingSale}
                className="pos-charge-button relative flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-primary px-2 text-xs font-black text-white shadow-md shadow-primary/25 transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Zap aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Charge Rs. {totalPKR.toFixed(2)} (F4)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Pharma Care checkout modal ─────────────────────────────────────── */}
      {showCheckoutModal && (
        <div className="pos-modal-backdrop fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className="pos-modal-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setShowCheckoutModal(false);
              } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
                event.preventDefault();
                handleCompleteSale();
              }
            }}
          >
            {/* Modal Header */}
            <div className="bg-blue-600 text-white p-4 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-blue-200 uppercase tracking-wider block">
                  {APP_NAME.toUpperCase()} CHECKOUT
                </span>
                <span className="text-base font-black">
                  Total Payable: Rs. {totalPKR.toFixed(2)}
                </span>
              </div>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="text-white/80 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-col space-y-4 overflow-y-auto p-5 text-xs">
              <div className="order-1 text-slate-600 font-medium">
                Customer: <strong>{resolvePosCustomerName(
                  customers.find((customer) => customer.id === selectedCustomerId)?.name,
                  walkInName,
                )}</strong>
              </div>

              <DiscountBox
                billPaisa={subtotalPaisa}
                discount={discount}
                maxPercent={maxAllowedDiscount}
                maxPaisa={MAX_DISCOUNT_PAISA}
                notice={discountNotice}
                onChange={handleDiscountChange}
              />

              {paymentMethod === 'CASH' && <div className="order-2">
                <div className="flex justify-between font-bold text-slate-700 mb-1">
                  <span>RECEIVED / TENDERED AMOUNT</span>
                  <span className="flex items-center gap-1.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider select-none" title="Press F3 to focus this field">F3</span>
                    <span className="font-mono">Bill: Rs. {totalPKR.toFixed(2)}</span>
                  </span>
                </div>
                <input
                  ref={tenderedInputRef}
                  type="number"
                  step="0.01"
                  placeholder="0"
                  value={tenderedAmountPKR ?? ''}
                  onChange={(e) => setTenderedAmountPKR(e.target.value === '' ? null : Number(e.target.value))}
                  className="w-full px-3 py-2 text-base font-black font-mono border-2 border-blue-500 rounded-xl focus:outline-none"
                />
              </div>}
              {/* Quick Cash pills */}
              {paymentMethod === 'CASH' && <div className="order-3 flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setTenderedAmountPKR(totalPKR)}
                  className="px-2.5 py-1 text-[11px] font-bold bg-emerald-600 text-white rounded-lg"
                >
                  Exact (Rs. {totalPKR.toFixed(2)})
                </button>
                {[100, 500, 1000, 5000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setTenderedAmountPKR(amt)}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg border border-slate-200"
                  >
                    Rs. {amt}
                  </button>
                ))}
              </div>}

              {/* Change Banner */}
              {discountPaisa > 0 && (
                <div className="order-5 flex items-center justify-between rounded-control border border-border bg-surface px-3 py-2 font-semibold text-text">
                  <span>Discount</span>
                  <span className="font-mono">-Rs. {discountPKR.toFixed(2)}</span>
                </div>
              )}

              {changeDuePaisa > 0 && (
                <div className="order-6 p-2.5 bg-emerald-50 rounded-xl border border-emerald-300 flex items-center justify-between text-emerald-950">
                  <span className="font-bold">Wapis Karein (Change Due):</span>
                  <span className="text-base font-black font-mono text-emerald-700">
                    Rs. {changeDuePKR.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Payment Method Selector */}
              <div className="order-7">
                <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                  PAYMENT METHOD
                </span>
                <div className="grid grid-cols-4 gap-1.5 text-xs">
                  {(['CASH', 'ONLINE', 'CREDIT', 'SPLIT'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => selectPaymentMethod(m)}
                      className={`py-1.5 rounded-lg border font-bold text-[11px] ${
                        paymentMethod === m
                          ? 'bg-blue-600 text-white border-blue-700'
                          : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {paymentMethod === 'ONLINE' && (
                <div className="order-8 grid min-w-0 grid-cols-2 gap-2">
                  <label className="grid min-w-0 gap-1 text-[10px] font-semibold text-muted">
                    Provider
                    <PaymentProviderSelect
                      value={onlineProviderId}
                      onChange={setOnlineProviderId}
                      ariaLabel="Online payment provider"
                    />
                  </label>
                  <label className="grid min-w-0 gap-1 text-[10px] font-semibold text-muted">
                    TID / Ref
                    <input
                      type="text"
                      value={onlinePaymentReference}
                      onChange={(event) => setOnlinePaymentReference(event.target.value)}
                      placeholder="TID / Ref (optional)"
                      maxLength={200}
                      className="min-h-9 w-full min-w-0 rounded-control border border-border bg-surface px-2 text-xs font-normal text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </label>
                </div>
              )}

              {saleError && (
                <p role="alert" className="order-9 text-xs font-semibold text-danger">
                  {saleError}
                </p>
              )}

              <div className="order-10 pt-2 flex items-center gap-2">
                <button
                  onClick={() => setShowCheckoutModal(false)}
                  className="flex-1 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  ← Back to Cart
                </button>
                <button
                  ref={completeSaleButtonRef}
                  onClick={handleCompleteSale}
                  disabled={isPostingSale}
                  className="flex-1 py-2.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md transition disabled:opacity-60 flex items-center justify-center gap-1.5"
                >
                  {isPostingSale
                    ? 'Saving sale…'
                    : <>
                        <span>✓ Complete Sale (Rs. {totalPKR.toFixed(2)})</span>
                        <span className="rounded bg-emerald-800/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider select-none">F4</span>
                      </>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSplitModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSplitPayment();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="split-payment-title"
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            onKeyDownCapture={(event) => {
              if (event.key !== 'Enter') return;
              const target = event.target;
              if (!(target instanceof HTMLElement)) return;
              if (target.closest('[aria-haspopup="listbox"]')) return;
              if (!(target instanceof HTMLInputElement)) return;
              event.preventDefault();
              event.stopPropagation();
              const fields = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button[aria-haspopup="listbox"], input.split-payment-field',
                ),
              );
              const currentIndex = fields.indexOf(target);
              const nextField = fields[currentIndex + 1];
              if (nextField) nextField.focus();
              else splitDoneButtonRef.current?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              closeSplitPayment();
            }}
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="split-payment-title" className="flex items-center gap-2 text-base font-black text-text">
                <ArrowLeftRight aria-hidden="true" className="h-5 w-5 text-primary" />
                Split Payment
              </h2>
              <button
                type="button"
                onClick={closeSplitPayment}
                aria-label="Close split payment"
                className="rounded-control p-1.5 text-muted hover:bg-surface-muted hover:text-text"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 space-y-3 overflow-y-auto p-4">
              <div className="space-y-3">
                {splitRows.map((row, index) => (
                  <div key={row.id} className="rounded-xl border border-border bg-surface p-3">
                    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_2rem] items-end gap-2">
                      <label className="grid min-w-0 gap-1 text-[10px] font-semibold text-muted">
                        Payment method
                        <PaymentProviderSelect
                          value={row.providerId}
                          onChange={(providerId) => updateSplitRow(row.id, {
                            providerId,
                            ...(providerId === 'cash' ? { reference: '' } : {}),
                          })}
                          includeCash
                          includeCard
                          ariaLabel={`Payment method for payment ${index + 1}`}
                        />
                      </label>
                      <label className="grid min-w-0 gap-1 text-[10px] font-semibold text-muted">
                        Amount (Rs)
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.amount}
                          onChange={(event) => updateSplitRow(row.id, { amount: event.target.value })}
                          aria-label={`Amount for payment ${index + 1}`}
                          className="split-payment-field h-9 w-full min-w-0 rounded-control border border-border bg-surface px-2 font-mono text-xs font-bold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => removeSplitPayment(row.id)}
                        disabled={splitRows.length === 1}
                        aria-label={`Remove payment ${index + 1}`}
                        className="inline-flex h-9 w-8 items-center justify-center rounded-control border border-danger/40 text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                    {row.providerId !== 'cash' && (
                      <input
                        type="text"
                        value={row.reference}
                        onChange={(event) => updateSplitRow(row.id, { reference: event.target.value })}
                        placeholder="TID / Ref / Account (optional)"
                        aria-label={`TID / Ref / Account for payment ${index + 1}`}
                        maxLength={200}
                        className="split-payment-field mt-2 h-9 w-full rounded-control border border-border bg-surface px-2 text-xs text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-1 rounded-xl border border-border bg-surface-muted p-3 text-xs">
                <div className="flex justify-between font-black text-text">
                  <span>Total Bill:</span>
                  <span className="font-mono">Rs. {totalPKR.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold text-primary">
                  <span>Paid So Far:</span>
                  <span className="font-mono">Rs. {(splitSummary.paidPaisa / 100).toFixed(2)}</span>
                </div>
                <div className={`flex justify-between font-semibold ${
                  splitSummary.remainingPaisa === 0
                    ? 'text-muted'
                    : splitSummary.remainingPaisa > 0
                      ? 'text-amber-700'
                      : 'text-danger'
                }`}>
                  <span>Remaining:</span>
                  <span className="font-mono">
                    {splitSummary.remainingPaisa < 0 ? '- ' : ''}
                    Rs. {(Math.abs(splitSummary.remainingPaisa) / 100).toFixed(2)}
                  </span>
                </div>
              </div>

              {splitError && (
                <p role="alert" className="text-xs font-semibold text-danger">{splitError}</p>
              )}
              {!splitError && !splitSummary.isBalanced && (
                <p role="status" className="text-xs font-medium text-muted">
                  {!splitSummary.hasValidRows
                    ? 'Every payment must be a positive amount.'
                    : splitSummary.remainingPaisa > 0
                      ? 'Paid So Far must equal the Total Bill.'
                      : 'Paid amount exceeds the Total Bill.'}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={addSplitPayment}
                  disabled={splitSummary.remainingPaisa <= 0}
                  className="rounded-control border border-primary px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + Add Payment
                </button>
                <button
                  ref={splitDoneButtonRef}
                  type="button"
                  onClick={confirmSplitPayment}
                  disabled={!splitSummary.isBalanced}
                  className="rounded-control bg-primary px-5 py-2 text-xs font-bold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showClearCartConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowClearCartConfirm(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-cart-title"
            aria-describedby="clear-cart-description"
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl"
          >
            <h2 id="clear-cart-title" className="text-base font-black text-text">Clear cart?</h2>
            <p id="clear-cart-description" className="mt-2 text-sm text-muted">
              Clear all items from this cart?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearCartConfirm(false)}
                className="rounded-control border border-border px-4 py-2 text-xs font-bold text-text hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearCartContents}
                className="rounded-control bg-primary px-4 py-2 text-xs font-bold text-white hover:brightness-95"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sale Complete Dialog (Matching Screenshot 11 & 65) ─────────────── */}
      {saleCompleteModal && (
        <div className="pos-modal-backdrop fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="pos-modal-panel bg-white rounded-2xl max-w-xs w-full p-6 text-center space-y-4 shadow-2xl border border-slate-200">
            <div className="pos-sale-success relative w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="pos-success-check w-8 h-8" />
            </div>

            <div>
              <h3 className="text-base font-black text-slate-900">Sale Complete!</h3>
              <p className="text-xs text-slate-500">{saleCompleteModal.paymentMethod} sale</p>
            </div>

            {saleCompleteModal.changePaisa > 0 && (
              <div className="p-3 bg-emerald-600 text-white rounded-xl">
                <span className="text-[10px] font-bold uppercase tracking-wider block">
                  WAPIS KAREIN (CHANGE DUE)
                </span>
                <span className="text-xl font-black font-mono">
                  Rs. {(saleCompleteModal.changePaisa / 100).toFixed(0)}
                </span>
                <div className="text-[10px] text-emerald-100 mt-1">
                  Paid Rs. {(saleCompleteModal.amountTenderedPaisa / 100).toFixed(0)} • Total Rs.{' '}
                  {(saleCompleteModal.totalPaisa / 100).toFixed(0)}
                </div>
              </div>
            )}

            <div className="py-2 border-y border-slate-100 text-xs space-y-1">
              <div className="flex justify-between text-slate-500">
                <span>Invoice:</span>
                <span className="font-mono font-bold text-slate-800">
                  {saleCompleteModal.invoiceNumber}
                </span>
              </div>
              <div className="flex justify-between font-bold text-slate-900">
                <span>Total:</span>
                <span className="font-mono">
                  Rs. {(saleCompleteModal.totalPaisa / 100).toFixed(0)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  void printSaleReceipt(saleCompleteModal).then((completed) => {
                    if (completed) setSaleCompleteModal(null);
                  });
                }}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="w-4 h-4" /> {canPrintReceipt(currentRole, permissions, 'sale') ? 'Print Receipt' : 'Request print'}
              </button>
              <button
                onClick={() => setSaleCompleteModal(null)}
                className="w-full py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
