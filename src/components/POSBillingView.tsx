import React, { useState, useMemo } from 'react';
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  Smartphone,
  Building2,
  Printer,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Package,
  Receipt,
  RotateCcw,
  Sparkles,
  Barcode,
  Layers,
  FileText,
  User,
  X,
  Zap,
} from 'lucide-react';
import {
  Product,
  CartItem,
  UserRole,
  PaymentMethod,
  Customer,
  CompletedSale,
  ROLE_MAX_DISCOUNT,
  BatchStatus,
} from '../types/pharmacy';
import { allocateFefo, localIsoDate } from '../utils/fefo';

interface POSBillingViewProps {
  products: Product[];
  customers: Customer[];
  currentRole: UserRole;
  currentUserName: string;
  onSaleComplete: (sale: CompletedSale) => void;
  onOpenTemplatePreview: () => void;
}

export const POSBillingView: React.FC<POSBillingViewProps> = ({
  products,
  customers,
  currentRole,
  currentUserName,
  onSaleComplete,
  onOpenTemplatePreview,
}) => {
  // Top Tabs
  const [activeTopTab, setActiveTopTab] = useState<'sale' | 'quotation' | 'search-quote' | 'barcode'>(
    'sale'
  );

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedBrand, setSelectedBrand] = useState<string>('ALL');

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartLayout, setCartLayout] = useState<'2-stage' | 'dock' | 'side' | 'quick'>('dock');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [walkInName, setWalkInName] = useState<string>('Walk-in Customer');

  // Checkout & Cash Tendered
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'ONLINE' | 'CREDIT' | 'SPLIT'>('CASH');
  const [tenderedAmountPKR, setTenderedAmountPKR] = useState<number>(0);
  const [saleError, setSaleError] = useState('');

  // Modals
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [saleCompleteModal, setSaleCompleteModal] = useState<CompletedSale | null>(null);

  const categories = useMemo(() => ['ALL', ...Array.from(new Set(products.map((p) => p.category)))], [products]);
  const brands = useMemo(() => ['ALL', ...Array.from(new Set(products.map((p) => p.company)))], [products]);

  // Financial calculations
  const subtotalPaisa = useMemo(() => cart.reduce((sum, item) => sum + item.lineTotalPaisa, 0), [cart]);
  const subtotalPKR = subtotalPaisa / 100;

  const discountPaisa = useMemo(
    () => Math.round((subtotalPaisa * discountPercent) / 100),
    [subtotalPaisa, discountPercent]
  );
  const discountPKR = discountPaisa / 100;

  const totalPaisa = Math.max(0, subtotalPaisa - discountPaisa);
  const totalPKR = totalPaisa / 100;

  const changeDuePKR = Math.max(0, tenderedAmountPKR - totalPKR);

  // Add Product to Cart
  const handleAddToCart = (product: Product) => {
    const defaultUnit = product.units.find((u) => u.isDefaultSaleUnit) || product.units[0];
    if (!defaultUnit) {
      setSaleError('This product has no configured sale unit.');
      return;
    }
    let targetBatch: Product['batches'][number] | undefined;
    try {
      const allocation = allocateFefo(product.batches, defaultUnit.conversionFactor, localIsoDate());
      targetBatch = product.batches.find((batch) => batch.id === allocation[0].batchId);
    } catch (error) {
      setSaleError(error instanceof Error ? error.message : 'Unable to allocate stock for this item.');
      return;
    }
    setSaleError('');

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
        unitName: defaultUnit.name,
        conversionFactor: defaultUnit.conversionFactor,
        quantityInUnit: 1,
        mrpPaisaPerUnit: defaultUnit.pricePerUnitPaisa,
        costPaisaPerUnit: targetBatch?.costPricePaisa || 0,
        discountPercent: 0,
        lineTotalPaisa: defaultUnit.pricePerUnitPaisa,
      };
      return [...prev, newItem];
    });
  };

  const updateQuantity = (idx: number, delta: number) => {
    setCart((prev) => {
      const copy = [...prev];
      const item = copy[idx];
      const newQty = item.quantityInUnit + delta;
      if (newQty <= 0) return copy.filter((_, i) => i !== idx);
      copy[idx] = {
        ...item,
        quantityInUnit: newQty,
        lineTotalPaisa: newQty * item.mrpPaisaPerUnit,
      };
      return copy;
    });
  };

  const filteredProducts = products.filter((p) => {
    const matchSearch =
      p.brandName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.genericName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode.includes(searchQuery);
    const matchCat = selectedCategory === 'ALL' || p.category === selectedCategory;
    const matchBrand = selectedBrand === 'ALL' || p.company === selectedBrand;
    return matchSearch && matchCat && matchBrand;
  });

  const handleCompleteSale = () => {
    if (cart.length === 0) return;

    let items: CartItem[];
    try {
      items = cart.map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        if (!product) throw new RangeError(`Product ${item.productName} is no longer available.`);
        const batchAllocations = allocateFefo(
          product.batches,
          item.quantityInUnit * item.conversionFactor,
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
    const sale: CompletedSale = {
      id: `sale-${Date.now()}`,
      invoiceNumber: `INV-${Math.floor(1000000 + Math.random() * 9000000)}`,
      timestamp: new Date().toLocaleString(),
      cashierName: currentUserName,
      customerName: customer ? customer.name : walkInName,
      customerPhone: customer?.phone || '0300-1234567',
      items,
      subtotalPaisa,
      discountPaisa,
      totalPaisa,
      paymentMethod:
        paymentMethod === 'ONLINE'
          ? PaymentMethod.EASYPAISA
          : paymentMethod === 'CREDIT'
          ? PaymentMethod.CREDIT
          : PaymentMethod.CASH,
      amountTenderedPaisa:
        paymentMethod === 'CASH'
          ? (tenderedAmountPKR || totalPKR) * 100
          : totalPaisa,
      changePaisa: Math.round(changeDuePKR * 100),
    };

    onSaleComplete(sale);
    setShowCheckoutModal(false);
    setSaleCompleteModal(sale);
    setCart([]);
    setDiscountPercent(0);
    setTenderedAmountPKR(0);
  };

  return (
    <div className="space-y-4">
      {saleError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {saleError}
        </div>
      )}
      {/* ── Top Tabs (Sale, Quotation, Search Quotation, Barcode Scan) ──────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200/90 shadow-xs">
          <button
            onClick={() => setActiveTopTab('sale')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              activeTopTab === 'sale'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🟦 Sale</span>
          </button>
          <button
            onClick={() => setActiveTopTab('quotation')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              activeTopTab === 'quotation'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>📄 Quotation</span>
          </button>
          <button
            onClick={() => setActiveTopTab('search-quote')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              activeTopTab === 'search-quote'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>🔍 Search Quotation</span>
          </button>
          <button
            onClick={() => setActiveTopTab('barcode')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              activeTopTab === 'barcode'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Barcode className="w-3.5 h-3.5" />
            <span>Barcode Scan</span>
          </button>
        </div>

        {/* Template Preview Launcher */}
        <button
          onClick={onOpenTemplatePreview}
          className="px-3.5 py-1.5 text-xs font-bold bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 rounded-xl shadow-xs flex items-center gap-1.5 transition"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>Quick View Template Preview</span>
        </button>
      </div>

      {/* ── Main Split View ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 7 Cols: Product Catalog & Fast Search */}
        <div className="lg:col-span-7 space-y-3">
          {/* Search Bar & Filters (Matching Screenshot 7) */}
          <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search products / brand (F2)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-blue-600 font-medium"
                autoFocus
              />
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[580px] overflow-y-auto pr-1">
            {filteredProducts.map((p) => {
              const defaultUnit = p.units.find((u) => u.isDefaultSaleUnit) || p.units[0];
              const totalStock = p.batches.reduce((sum, b) => sum + b.quantitySmallestUnit, 0);

              return (
                <button
                  key={p.id}
                  onClick={() => handleAddToCart(p)}
                  className="bg-white p-3 rounded-xl border border-slate-200/90 hover:border-blue-500 shadow-xs hover:shadow-sm text-left transition flex flex-col justify-between group h-28"
                >
                  <div>
                    <span className="font-bold text-xs text-slate-900 group-hover:text-blue-600 transition block truncate">
                      {p.brandName}
                    </span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {p.genericName} • {p.company}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono font-black text-slate-900 block">
                        Rs. {(defaultUnit.pricePerUnitPaisa / 100).toFixed(0)}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono">
                        Stock: {totalStock}
                      </span>
                    </div>
                    <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs group-hover:bg-blue-600 group-hover:text-white transition">
                      +
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right 5 Cols: Cart & Checkout Bar (Matching Screenshot 7, 8, 61, 62) */}
        <div className="lg:col-span-5 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
          <div>
            {/* Top Cart Header & Layout Switches (Matching Screenshot 7) */}
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 mb-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-black text-slate-900">
                  Cart ({cart.reduce((sum, i) => sum + i.quantityInUnit, 0)})
                </span>
              </div>

              {/* Layout Switcher Pills */}
              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold text-slate-600">
                <button
                  onClick={() => setCartLayout('2-stage')}
                  className={`px-2 py-0.5 rounded ${
                    cartLayout === '2-stage' ? 'bg-blue-600 text-white shadow-xs' : ''
                  }`}
                >
                  2-Stage
                </button>
                <button
                  onClick={() => setCartLayout('dock')}
                  className={`px-2 py-0.5 rounded ${
                    cartLayout === 'dock' ? 'bg-blue-600 text-white shadow-xs' : ''
                  }`}
                >
                  Dock
                </button>
                <button
                  onClick={() => setCartLayout('side')}
                  className={`px-2 py-0.5 rounded ${
                    cartLayout === 'side' ? 'bg-blue-600 text-white shadow-xs' : ''
                  }`}
                >
                  Side
                </button>
                <button
                  onClick={() => setCartLayout('quick')}
                  className={`px-2 py-0.5 rounded ${
                    cartLayout === 'quick' ? 'bg-blue-600 text-white shadow-xs' : ''
                  }`}
                >
                  Quick
                </button>
              </div>
            </div>

            {/* Customer Select Row (Matching Screenshot 7) */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="relative">
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-blue-600 bg-white font-medium text-slate-800"
                >
                  <option value="">👤 Walk-in Customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                placeholder="Walk-in Name"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-blue-600"
              />
            </div>

            {/* Cart Items List (Matching Screenshot 8) */}
            <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <Package className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                  Cart is empty
                  <p className="text-[10px] text-slate-400">Click products on left panel to add</p>
                </div>
              ) : (
                cart.map((item, idx) => (
                  <div
                    key={`${item.productId}-${idx}`}
                    className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                  >
                    <div className="flex-1 pr-2 truncate">
                      <div className="font-bold text-slate-900 truncate">{item.productName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        Rs. {(item.mrpPaisaPerUnit / 100).toFixed(0)} × {item.quantityInUnit}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-slate-300 rounded bg-white">
                        <button
                          onClick={() => updateQuantity(idx, -1)}
                          className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100"
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <span className="px-1.5 font-mono font-bold text-xs">
                          {item.quantityInUnit}
                        </span>
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
          <div className="mt-4 pt-3 border-t border-slate-200 space-y-2.5">
            {/* Subtotal & Quick Discount Row */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 font-medium">
                Subtotal ({cart.reduce((sum, i) => sum + i.quantityInUnit, 0)} pcs):{' '}
                <strong className="text-slate-900 font-mono">Rs. {subtotalPKR.toFixed(0)}</strong>
              </span>

              {/* Quick Discount Pills */}
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-slate-500 font-semibold">Disc:</span>
                {[0, 2, 5, 10, 15, 20].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setDiscountPercent(pct)}
                    className={`px-1.5 py-0.5 rounded font-bold transition ${
                      discountPercent === pct
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {pct === 0 ? '0' : `${pct}%`}
                  </button>
                ))}
              </div>
            </div>

            {/* NET TOTAL */}
            <div className="flex items-center justify-between py-1 bg-slate-50 px-2.5 rounded-lg border border-slate-200">
              <span className="text-xs font-black uppercase text-slate-700 tracking-wider">
                NET TOTAL
              </span>
              <span className="text-base font-black font-mono text-slate-950">
                Rs. {totalPKR.toFixed(0)}
              </span>
            </div>

            {/* Tendered Cash & Quick Cash Pills (Matching Screenshot 62) */}
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[11px] font-semibold text-slate-600">Tendered:</span>
                <input
                  type="number"
                  placeholder="0"
                  value={tenderedAmountPKR || ''}
                  onChange={(e) => setTenderedAmountPKR(Number(e.target.value))}
                  className="w-20 px-2 py-1 text-xs border border-slate-300 rounded font-mono font-bold"
                />
                <button
                  onClick={() => setTenderedAmountPKR(totalPKR)}
                  className="px-2 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded"
                >
                  Exact
                </button>
              </div>

              {/* Quick cash pills */}
              <div className="flex items-center gap-1 text-[10px]">
                {[50, 100, 500, 1000, 5000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setTenderedAmountPKR(amt)}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold border border-slate-200"
                  >
                    Rs.{amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Change Due Banner (Wapis Karein) (Matching Screenshot 10, 62) */}
            {changeDuePKR > 0 && (
              <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-300 text-xs flex items-center justify-between text-emerald-950">
                <span className="font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-600" />
                  Wapis Karein (Change Due):
                </span>
                <span className="text-sm font-black font-mono text-emerald-800">
                  Rs. {changeDuePKR.toFixed(0)}
                </span>
              </div>
            )}

            {/* Payment Methods Chips (Matching Screenshot 61) */}
            <div className="grid grid-cols-4 gap-1.5 text-xs pt-1">
              <button
                onClick={() => setPaymentMethod('CASH')}
                className={`py-1 rounded-lg border font-bold text-[11px] transition ${
                  paymentMethod === 'CASH'
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Cash
              </button>
              <button
                onClick={() => setPaymentMethod('ONLINE')}
                className={`py-1 rounded-lg border font-bold text-[11px] transition ${
                  paymentMethod === 'ONLINE'
                    ? 'bg-blue-600 text-white border-blue-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Online
              </button>
              <button
                onClick={() => setPaymentMethod('CREDIT')}
                className={`py-1 rounded-lg border font-bold text-[11px] transition ${
                  paymentMethod === 'CREDIT'
                    ? 'bg-amber-600 text-white border-amber-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Credit
              </button>
              <button
                onClick={() => setPaymentMethod('SPLIT')}
                className={`py-1 rounded-lg border font-bold text-[11px] transition ${
                  paymentMethod === 'SPLIT'
                    ? 'bg-purple-600 text-white border-purple-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Split
              </button>
            </div>

            {/* Charge / Complete Sale Button (Matching Screenshot 8, 62) */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setShowCheckoutModal(true)}
                disabled={cart.length === 0}
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md shadow-blue-600/25 flex items-center justify-center gap-1.5 transition disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Charge Rs. {totalPKR.toFixed(0)} (F4)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── EdgeX Checkout Modal (Matching Screenshot 9 & 10) ──────────────── */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-200">
            {/* Modal Header */}
            <div className="bg-blue-600 text-white p-4 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-blue-200 uppercase tracking-wider block">
                  EDGEX CHECKOUT
                </span>
                <span className="text-base font-black">
                  Total Payable: Rs. {totalPKR.toFixed(0)}
                </span>
              </div>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="text-white/80 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="text-slate-600 font-medium">
                Customer: <strong>{walkInName}</strong>
              </div>

              <div>
                <div className="flex justify-between font-bold text-slate-700 mb-1">
                  <span>RECEIVED / TENDERED AMOUNT</span>
                  <span className="font-mono">Bill: Rs. {totalPKR.toFixed(0)}</span>
                </div>
                <input
                  type="number"
                  placeholder="0"
                  value={tenderedAmountPKR || ''}
                  onChange={(e) => setTenderedAmountPKR(Number(e.target.value))}
                  className="w-full px-3 py-2 text-base font-black font-mono border-2 border-blue-500 rounded-xl focus:outline-none"
                  autoFocus
                />
              </div>

              {/* Quick Cash pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setTenderedAmountPKR(totalPKR)}
                  className="px-2.5 py-1 text-[11px] font-bold bg-emerald-600 text-white rounded-lg"
                >
                  Exact (Rs. {totalPKR.toFixed(0)})
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
              </div>

              {/* Change Banner */}
              {changeDuePKR > 0 && (
                <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-300 flex items-center justify-between text-emerald-950">
                  <span className="font-bold">Wapis Karein (Change Due):</span>
                  <span className="text-base font-black font-mono text-emerald-700">
                    Rs. {changeDuePKR.toFixed(0)}
                  </span>
                </div>
              )}

              {/* Payment Method Selector */}
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                  PAYMENT METHOD
                </span>
                <div className="grid grid-cols-4 gap-1.5 text-xs">
                  {['CASH', 'ONLINE', 'CREDIT', 'SPLIT'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setPaymentMethod(m as any)}
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

              <div className="pt-2 flex items-center gap-2">
                <button
                  onClick={() => setShowCheckoutModal(false)}
                  className="flex-1 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  ← Back to Cart
                </button>
                <button
                  onClick={handleCompleteSale}
                  className="flex-1 py-2.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md transition"
                >
                  ✓ Complete Sale (Rs. {totalPKR.toFixed(0)})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Sale Complete Dialog (Matching Screenshot 11 & 65) ─────────────── */}
      {saleCompleteModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xs w-full p-6 text-center space-y-4 shadow-2xl border border-slate-200">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
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
                  onOpenTemplatePreview();
                  setSaleCompleteModal(null);
                }}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="w-4 h-4" /> Print Receipt
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
