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
  Pill,
  ShieldAlert,
  Clock,
  UserCheck,
  Receipt,
  X,
} from 'lucide-react';
import {
  Product,
  CartItem,
  UserRole,
  DrugClass,
  BatchStatus,
  PaymentMethod,
  Customer,
  CompletedSale,
  ROLE_MAX_DISCOUNT,
} from '../types/pharmacy';

interface POSScreenProps {
  products: Product[];
  customers: Customer[];
  currentRole: UserRole;
  currentUserName: string;
  onSaleComplete: (sale: CompletedSale) => void;
}

export const POSScreen: React.FC<POSScreenProps> = ({
  products,
  customers,
  currentRole,
  currentUserName,
  onSaleComplete,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amountTenderedPaisa, setAmountTenderedPaisa] = useState<number>(0);
  const [heldBills, setHeldBills] = useState<{ id: string; time: string; items: CartItem[] }[]>([]);

  // Controlled drug validation modal
  const [pendingControlledItem, setPendingControlledItem] = useState<{
    product: Product;
    batchId: string;
    unitName: string;
    conversionFactor: number;
    pricePerUnitPaisa: number;
    costPerUnitPaisa: number;
  } | null>(null);
  const [patientName, setPatientName] = useState('');
  const [patientCnic, setPatientCnic] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [doctorRegNo, setDoctorRegNo] = useState('');

  // Receipt Modal
  const [lastSaleReceipt, setLastSaleReceipt] = useState<CompletedSale | null>(null);

  const maxAllowedDiscount = ROLE_MAX_DISCOUNT[currentRole] || 0;

  // Filter products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        p.brandName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.genericName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.barcode.includes(searchQuery);
      const matchCategory = selectedCategory === 'ALL' || p.category === selectedCategory;
      return matchSearch && matchCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return ['ALL', ...Array.from(set)];
  }, [products]);

  // Financial calculations in integer paisa
  const subtotalPaisa = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.lineTotalPaisa, 0);
  }, [cart]);

  const discountPaisa = useMemo(() => {
    return Math.round((subtotalPaisa * discountPercent) / 100);
  }, [subtotalPaisa, discountPercent]);

  const totalPaisa = useMemo(() => {
    return Math.max(0, subtotalPaisa - discountPaisa);
  }, [subtotalPaisa, discountPaisa]);

  const changePaisa = useMemo(() => {
    if (paymentMethod !== PaymentMethod.CASH) return 0;
    return Math.max(0, amountTenderedPaisa - totalPaisa);
  }, [amountTenderedPaisa, totalPaisa, paymentMethod]);

  // Add item to cart with FEFO batch selection
  const handleAddToCart = (product: Product, unitName?: string) => {
    // FEFO: Find active batch with nearest expiry
    const activeBatches = product.batches
      .filter((b) => b.quantitySmallestUnit > 0 && b.status !== BatchStatus.EXPIRED)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

    if (activeBatches.length === 0) {
      alert(`No available stock for ${product.brandName}. All batches are expired or empty.`);
      return;
    }

    const targetBatch = activeBatches[0];
    const unit = product.units.find((u) => u.name === unitName) || product.units[0];

    // Controlled or Narcotic check
    if (product.drugClass === DrugClass.CONTROLLED || product.drugClass === DrugClass.NARCOTIC) {
      setPendingControlledItem({
        product,
        batchId: targetBatch.id,
        unitName: unit.name,
        conversionFactor: unit.conversionFactor,
        pricePerUnitPaisa: unit.pricePerUnitPaisa,
        costPerUnitPaisa: Math.round(targetBatch.costPricePaisa * (unit.conversionFactor / 10)),
      });
      return;
    }

    addItemDirectly(product, targetBatch.id, targetBatch.batchNumber, targetBatch.expiryDate, unit);
  };

  const addItemDirectly = (
    product: Product,
    batchId: string,
    batchNumber: string,
    expiryDate: string,
    unit: any
  ) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (i) => i.productId === product.id && i.unitName === unit.name && i.batchId === batchId
      );

      if (existingIndex > -1) {
        const updated = [...prev];
        const item = updated[existingIndex];
        const newQty = item.quantityInUnit + 1;
        updated[existingIndex] = {
          ...item,
          quantityInUnit: newQty,
          lineTotalPaisa: newQty * item.mrpPaisaPerUnit,
        };
        return updated;
      }

      const costPerUnit = Math.round(
        (product.batches.find((b) => b.id === batchId)?.costPricePaisa || 0) * (unit.conversionFactor / 10)
      );

      const newItem: CartItem = {
        productId: product.id,
        productName: product.brandName,
        genericName: product.genericName,
        batchId,
        batchNumber,
        expiryDate,
        drugClass: product.drugClass,
        unitName: unit.name,
        conversionFactor: unit.conversionFactor,
        quantityInUnit: 1,
        mrpPaisaPerUnit: unit.pricePerUnitPaisa,
        costPaisaPerUnit: costPerUnit,
        discountPercent: 0,
        lineTotalPaisa: unit.pricePerUnitPaisa,
      };

      return [...prev, newItem];
    });
  };

  const confirmControlledDrugAdd = () => {
    if (!patientCnic || !doctorName || !doctorRegNo) {
      alert('Pakistan DRAP Form 7 requires Patient CNIC, Doctor Name, and PMDC Reg # for controlled medicines.');
      return;
    }

    if (pendingControlledItem) {
      const { product, batchId, unitName, conversionFactor, pricePerUnitPaisa } = pendingControlledItem;
      const batch = product.batches.find((b) => b.id === batchId);
      addItemDirectly(
        product,
        batchId,
        batch?.batchNumber || 'BATCH',
        batch?.expiryDate || '2027-01-01',
        { name: unitName, conversionFactor, pricePerUnitPaisa }
      );
      setPendingControlledItem(null);
      setPatientName('');
      setPatientCnic('');
      setDoctorName('');
      setDoctorRegNo('');
    }
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart((prev) => {
      const updated = [...prev];
      const item = updated[index];
      const newQty = item.quantityInUnit + delta;
      if (newQty <= 0) {
        return updated.filter((_, i) => i !== index);
      }
      updated[index] = {
        ...item,
        quantityInUnit: newQty,
        lineTotalPaisa: newQty * item.mrpPaisaPerUnit,
      };
      return updated;
    });
  };

  const removeItem = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const holdCurrentBill = () => {
    if (cart.length === 0) return;
    const newBill = {
      id: `HOLD-${Date.now().toString().slice(-4)}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      items: [...cart],
    };
    setHeldBills((prev) => [...prev, newBill]);
    setCart([]);
  };

  const resumeBill = (billId: string) => {
    const target = heldBills.find((b) => b.id === billId);
    if (!target) return;
    setCart(target.items);
    setHeldBills((prev) => prev.filter((b) => b.id !== billId));
  };

  const handleCompleteSale = () => {
    if (cart.length === 0) {
      alert('Cart is empty.');
      return;
    }

    if (paymentMethod === PaymentMethod.CASH && amountTenderedPaisa < totalPaisa) {
      alert('Amount tendered is less than total bill.');
      return;
    }

    if (paymentMethod === PaymentMethod.CREDIT && !selectedCustomerId) {
      alert('Please select a customer for credit sales.');
      return;
    }

    const customer = customers.find((c) => c.id === selectedCustomerId);

    const sale: CompletedSale = {
      id: `sale-${Date.now()}`,
      invoiceNumber: `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      timestamp: new Date().toLocaleString(),
      cashierName: currentUserName,
      customerName: customer?.name || 'Walk-in Customer',
      customerPhone: customer?.phone || '-',
      items: [...cart],
      subtotalPaisa,
      discountPaisa,
      totalPaisa,
      paymentMethod,
      amountTenderedPaisa: paymentMethod === PaymentMethod.CASH ? amountTenderedPaisa : totalPaisa,
      changePaisa,
    };

    onSaleComplete(sale);
    setLastSaleReceipt(sale);
    setCart([]);
    setDiscountPercent(0);
    setAmountTenderedPaisa(0);
    setSelectedCustomerId('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* ── Left 7 Cols: Product Catalog & Fast Search ─────────────────────── */}
      <div className="lg:col-span-7 space-y-4">
        {/* Search Bar */}
        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-emerald-700 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search by Brand, Generic or Barcode... (e.g. Panadol, Augmentin, Lexotanil)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600 font-medium"
              autoFocus
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600 bg-white text-emerald-950 font-medium"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'ALL' ? 'All Categories' : c}
              </option>
            ))}
          </select>
        </div>

        {/* Held Bills Bar */}
        {heldBills.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-xl flex items-center justify-between gap-2 overflow-x-auto">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 shrink-0">
              <PauseCircle className="w-4 h-4 text-amber-700" />
              Held Bills ({heldBills.length}):
            </div>
            <div className="flex items-center gap-2">
              {heldBills.map((b) => (
                <button
                  key={b.id}
                  onClick={() => resumeBill(b.id)}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-amber-200 hover:bg-amber-300 text-amber-950 rounded-lg border border-amber-300 flex items-center gap-1 transition"
                >
                  <PlayCircle className="w-3 h-3" /> {b.id} ({b.items.length} items)
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Product Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[620px] overflow-y-auto pr-1">
          {filteredProducts.map((p) => {
            const totalStock = p.batches.reduce((sum, b) => sum + b.quantitySmallestUnit, 0);
            const activeBatches = p.batches.filter((b) => b.quantitySmallestUnit > 0);
            const nearestExpiry = activeBatches.sort(
              (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
            )[0];

            return (
              <div
                key={p.id}
                className="bg-white p-4 rounded-xl border border-emerald-200/80 hover:border-emerald-400 shadow-xs hover:shadow-sm transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <span className="text-sm font-bold text-emerald-950">{p.brandName}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                        p.drugClass === DrugClass.NARCOTIC
                          ? 'bg-red-100 text-red-800 border border-red-300'
                          : p.drugClass === DrugClass.CONTROLLED
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : p.drugClass === DrugClass.RX
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {p.drugClass}
                    </span>
                  </div>

                  <p className="text-xs text-emerald-800/80 italic">{p.genericName}</p>
                  <div className="text-[11px] text-emerald-700/70 mt-1 flex items-center gap-2">
                    <span>{p.company}</span> • <span>Rack: {p.rackLocation}</span>
                  </div>

                  {/* Stock & FEFO Batch info */}
                  <div className="mt-2.5 pt-2 border-t border-emerald-100 flex items-center justify-between text-xs">
                    <span className="text-emerald-900 font-medium">
                      Stock: <strong className="text-emerald-700">{totalStock}</strong> units
                    </span>
                    {nearestExpiry ? (
                      <span className="text-[11px] text-emerald-800 flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3 text-emerald-600" />
                        Exp: {nearestExpiry.expiryDate}
                      </span>
                    ) : (
                      <span className="text-[11px] text-red-600 font-semibold">Out of Stock</span>
                    )}
                  </div>
                </div>

                {/* Units & Quick Add Buttons */}
                <div className="mt-3 pt-2 border-t border-emerald-50 flex items-center gap-1.5 flex-wrap">
                  {p.units.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleAddToCart(p, u.name)}
                      disabled={totalStock <= 0}
                      className="flex-1 py-1 px-2 text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-lg transition disabled:opacity-40"
                    >
                      {u.name} <br />
                      <span className="text-emerald-700 font-mono font-bold">
                        Rs {(u.pricePerUnitPaisa / 100).toFixed(0)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right 5 Cols: Active POS Cart & Bill Checkout ──────────────────── */}
      <div className="lg:col-span-5 bg-white p-5 rounded-xl border border-emerald-200 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between border-b border-emerald-100 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-700" />
              <h3 className="text-base font-bold text-emerald-950">Active POS Bill</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={holdCurrentBill}
                disabled={cart.length === 0}
                className="px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg flex items-center gap-1 transition disabled:opacity-40"
              >
                <PauseCircle className="w-3.5 h-3.5" /> Hold
              </button>
              <button
                onClick={() => setCart([])}
                disabled={cart.length === 0}
                className="p-1 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-30"
                title="Clear Cart"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Cart Items List */}
          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
            {cart.length === 0 ? (
              <div className="py-12 text-center text-emerald-700/60 text-xs">
                <ShoppingCart className="w-8 h-8 mx-auto mb-2 text-emerald-300" />
                Cart is empty. Select medicines from the left or scan barcode.
              </div>
            ) : (
              cart.map((item, idx) => (
                <div
                  key={`${item.productId}-${item.unitName}-${idx}`}
                  className="p-2.5 rounded-lg border border-emerald-100 bg-emerald-50/40 flex items-center justify-between text-xs"
                >
                  <div className="flex-1 pr-2">
                    <p className="font-bold text-emerald-950">{item.productName}</p>
                    <div className="text-[11px] text-emerald-700/80 flex items-center gap-2 mt-0.5">
                      <span>{item.unitName}</span>
                      <span>• Batch: {item.batchNumber}</span>
                      {currentRole !== UserRole.CASHIER && (
                        <span className="text-[10px] text-emerald-600">
                          (Cost: Rs {(item.costPaisaPerUnit / 100).toFixed(0)})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Quantity Selector */}
                    <div className="flex items-center border border-emerald-300 rounded-md bg-white">
                      <button
                        onClick={() => updateQuantity(idx, -1)}
                        className="px-2 py-0.5 text-emerald-800 hover:bg-emerald-100"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="px-2 font-mono font-bold text-xs">{item.quantityInUnit}</span>
                      <button
                        onClick={() => updateQuantity(idx, 1)}
                        className="px-2 py-0.5 text-emerald-800 hover:bg-emerald-100"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="text-right min-w-[70px]">
                      <span className="font-mono font-bold text-emerald-950">
                        Rs {(item.lineTotalPaisa / 100).toFixed(2)}
                      </span>
                    </div>

                    <button
                      onClick={() => removeItem(idx)}
                      className="text-red-500 hover:text-red-700 p-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Bill Totals & Checkout Options ────────────────────────────────── */}
        <div className="mt-4 pt-4 border-t border-emerald-200/80 space-y-3">
          {/* Discount & Customer */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-emerald-900 mb-1">
                Discount ({discountPercent}% - Max {maxAllowedDiscount}%):
              </label>
              <input
                type="number"
                min="0"
                max={maxAllowedDiscount}
                value={discountPercent}
                onChange={(e) =>
                  setDiscountPercent(Math.min(maxAllowedDiscount, Math.max(0, Number(e.target.value))))
                }
                className="w-full px-2.5 py-1.5 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-emerald-900 mb-1">
                Customer / Khata:
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600 bg-white"
              >
                <option value="">Walk-in Customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (Due: Rs {(c.currentBalancePaisa / 100).toFixed(0)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="block text-[11px] font-semibold text-emerald-900 mb-1.5">
              Payment Method:
            </label>
            <div className="grid grid-cols-4 gap-1.5 text-xs">
              <button
                onClick={() => setPaymentMethod(PaymentMethod.CASH)}
                className={`py-1.5 rounded-lg border font-semibold flex items-center justify-center gap-1 transition ${
                  paymentMethod === PaymentMethod.CASH
                    ? 'bg-emerald-700 text-white border-emerald-800'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" /> Cash
              </button>
              <button
                onClick={() => setPaymentMethod(PaymentMethod.CARD)}
                className={`py-1.5 rounded-lg border font-semibold flex items-center justify-center gap-1 transition ${
                  paymentMethod === PaymentMethod.CARD
                    ? 'bg-emerald-700 text-white border-emerald-800'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" /> Card
              </button>
              <button
                onClick={() => setPaymentMethod(PaymentMethod.EASYPAISA)}
                className={`py-1.5 rounded-lg border font-semibold flex items-center justify-center gap-1 transition ${
                  paymentMethod === PaymentMethod.EASYPAISA
                    ? 'bg-emerald-700 text-white border-emerald-800'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" /> Mobile
              </button>
              <button
                onClick={() => setPaymentMethod(PaymentMethod.CREDIT)}
                className={`py-1.5 rounded-lg border font-semibold flex items-center justify-center gap-1 transition ${
                  paymentMethod === PaymentMethod.CREDIT
                    ? 'bg-emerald-700 text-white border-emerald-800'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" /> Credit
              </button>
            </div>
          </div>

          {/* Cash Tendered Input if Cash */}
          {paymentMethod === PaymentMethod.CASH && (
            <div className="flex items-center justify-between text-xs bg-emerald-50 p-2 rounded-lg border border-emerald-200">
              <span className="font-semibold text-emerald-900">Cash Received (PKR):</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="0"
                  onChange={(e) => setAmountTenderedPaisa(Math.round(Number(e.target.value) * 100))}
                  className="w-24 px-2 py-1 text-xs border border-emerald-300 rounded font-mono font-bold bg-white text-right"
                />
                <button
                  onClick={() => setAmountTenderedPaisa(totalPaisa)}
                  className="px-2 py-1 text-[11px] bg-emerald-200 text-emerald-900 rounded font-semibold"
                >
                  Exact
                </button>
              </div>
            </div>
          )}

          {/* Calculation summary */}
          <div className="space-y-1 text-xs text-emerald-950 font-medium">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-mono">Rs {(subtotalPaisa / 100).toFixed(2)}</span>
            </div>
            {discountPaisa > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Discount ({discountPercent}%):</span>
                <span className="font-mono">- Rs {(discountPaisa / 100).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-emerald-900 border-t border-emerald-200 pt-1.5">
              <span>Grand Total:</span>
              <span className="font-mono text-base text-emerald-800">
                Rs {(totalPaisa / 100).toFixed(2)}
              </span>
            </div>
            {paymentMethod === PaymentMethod.CASH && changePaisa > 0 && (
              <div className="flex justify-between text-xs font-semibold text-emerald-700">
                <span>Change Due:</span>
                <span className="font-mono">Rs {(changePaisa / 100).toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <button
            onClick={handleCompleteSale}
            disabled={cart.length === 0}
            className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-xl shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-5 h-5" />
            Complete Sale & Issue Receipt (F9)
          </button>
        </div>
      </div>

      {/* ── CONTROLLED DRUG MODAL (Schedule G / Form 7) ────────────────────── */}
      {pendingControlledItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 border border-red-200 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-red-700">
              <ShieldAlert className="w-6 h-6" />
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  DRAP Form 7: Controlled Drug Verification
                </h3>
                <p className="text-xs text-slate-600">
                  Dispensing {pendingControlledItem.product.brandName} ({pendingControlledItem.product.drugClass})
                </p>
              </div>
            </div>

            <div className="p-3 bg-red-50 rounded-xl text-xs text-red-900 border border-red-200 leading-relaxed">
              Under Drug Regulatory Authority of Pakistan (DRAP) Rules, benzodiazepines and narcotics require valid prescription recording with Doctor PMDC Reg # and Patient CNIC.
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">Patient Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Tariq Mehmood"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">Patient CNIC *</label>
                  <input
                    type="text"
                    placeholder="35202-xxxxxxx-x"
                    value={patientCnic}
                    onChange={(e) => setPatientCnic(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">Prescribing Doctor *</label>
                  <input
                    type="text"
                    placeholder="Dr. Name"
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">PMDC / PMC Reg No *</label>
                  <input
                    type="text"
                    placeholder="PMDC-12345-P"
                    value={doctorRegNo}
                    onChange={(e) => setDoctorRegNo(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                onClick={() => setPendingControlledItem(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={confirmControlledDrugAdd}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Authorize & Add to Bill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RECEIPT MODAL (In-App Printable Thermal 80mm) ──────────────────── */}
      {lastSaleReceipt && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 border border-slate-200 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-emerald-700" /> Thermal Receipt Preview
              </span>
              <button
                onClick={() => setLastSaleReceipt(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Thermal Slip Content */}
            <div className="p-4 bg-slate-50 border border-dashed border-slate-300 font-mono text-[11px] text-slate-800 space-y-2 rounded-lg">
              <div className="text-center">
                <h4 className="font-bold text-sm text-slate-900">PHARMACARE SYSTEM</h4>
                <p className="text-[10px] text-slate-500">Retail & Hospital Pharmacy</p>
                <p className="text-[10px] text-slate-500">Tel: +92 42 111-222-333</p>
                <div className="border-b border-dashed border-slate-400 my-2" />
              </div>

              <div className="flex justify-between text-[10px]">
                <span>Invoice: {lastSaleReceipt.invoiceNumber}</span>
                <span>{lastSaleReceipt.timestamp.split(',')[0]}</span>
              </div>
              <div className="text-[10px]">
                <span>Cashier: {lastSaleReceipt.cashierName}</span>
              </div>
              <div className="border-b border-dashed border-slate-400 my-1" />

              <div className="space-y-1.5">
                {lastSaleReceipt.items.map((i, idx) => (
                  <div key={idx}>
                    <div className="flex justify-between font-bold">
                      <span>{i.productName} ({i.unitName})</span>
                      <span>Rs {(i.lineTotalPaisa / 100).toFixed(2)}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 flex justify-between">
                      <span>Batch: {i.batchNumber}</span>
                      <span>Qty: {i.quantityInUnit}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-b border-dashed border-slate-400 my-2" />

              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>Rs {(lastSaleReceipt.subtotalPaisa / 100).toFixed(2)}</span>
                </div>
                {lastSaleReceipt.discountPaisa > 0 && (
                  <div className="flex justify-between">
                    <span>Discount:</span>
                    <span>- Rs {(lastSaleReceipt.discountPaisa / 100).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xs pt-1 border-t border-slate-300">
                  <span>NET TOTAL:</span>
                  <span>Rs {(lastSaleReceipt.totalPaisa / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[10px] pt-1">
                  <span>Payment ({lastSaleReceipt.paymentMethod}):</span>
                  <span>Rs {(lastSaleReceipt.amountTenderedPaisa / 100).toFixed(2)}</span>
                </div>
                {lastSaleReceipt.changePaisa > 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span>Change Returned:</span>
                    <span>Rs {(lastSaleReceipt.changePaisa / 100).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="border-b border-dashed border-slate-400 my-2" />
              <div className="text-center text-[9px] text-slate-500">
                Medicines sold are non-refundable without valid invoice. Keep in cool & dry place.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="w-4 h-4" /> Print Thermal Slip
              </button>
              <button
                onClick={() => setLastSaleReceipt(null)}
                className="py-2 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition"
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
