import React, { useState } from 'react';
import {
  Package,
  AlertTriangle,
  Clock,
  Plus,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Shield,
  Layers,
  Thermometer,
  MapPin,
  Barcode,
} from 'lucide-react';
import { Product, Batch, BatchStatus, DrugClass, UserRole } from '../types/pharmacy';
import { localIsoDate } from '../utils/fefo';

interface InventoryScreenProps {
  products: Product[];
  currentRole: UserRole;
  onAddProduct: (prod: Product) => void;
}

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  products,
  currentRole,
  onAddProduct,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [drugClassFilter, setDrugClassFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'products' | 'batches'>('products');
  const [showAddModal, setShowAddModal] = useState(false);
  const isCashier = currentRole === UserRole.CASHIER;

  // New product form state
  const [newBrand, setNewBrand] = useState('');
  const [newGeneric, setNewGeneric] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newCategory, setNewCategory] = useState('Antibiotics');
  const [newDrugClass, setNewDrugClass] = useState<DrugClass>(DrugClass.OTC);
  const [newRack, setNewRack] = useState('A-1-01');
  const [newPackPrice, setNewPackPrice] = useState(500);

  const filteredProducts = products.filter((p) => {
    const matchSearch =
      p.brandName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.genericName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.barcode.includes(searchTerm);
    const matchClass = drugClassFilter === 'ALL' || p.drugClass === drugClassFilter;
    return matchSearch && matchClass;
  });

  const allBatches = products.flatMap((p) =>
    p.batches.map((b) => ({ ...b, productBrand: p.brandName, drugClass: p.drugClass }))
  );

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrand || !newGeneric) {
      alert('Please fill brand and generic names.');
      return;
    }

    const productId = `prod-${Date.now()}`;
    const newProd: Product = {
      id: productId,
      code: `MED-${Math.floor(100 + Math.random() * 900)}`,
      barcode: `8964000${Math.floor(100000 + Math.random() * 900000)}`,
      brandName: newBrand,
      genericName: newGeneric,
      category: newCategory,
      company: newCompany || 'Pharma Mfg',
      drugClass: newDrugClass,
      storageCondition: 'ROOM_TEMPERATURE',
      rackLocation: newRack,
      minStockAlert: 30,
      requiresPrescription: newDrugClass !== DrugClass.OTC,
      units: [
        { id: `u-${Date.now()}-1`, name: 'Pack', conversionFactor: 20, isDefaultSaleUnit: true, pricePerUnitPaisa: newPackPrice * 100 },
        { id: `u-${Date.now()}-2`, name: 'Tablet (Loose)', conversionFactor: 1, isDefaultSaleUnit: false, pricePerUnitPaisa: Math.round((newPackPrice / 20) * 100) },
      ],
      batches: [
        {
          id: `b-${Date.now()}`,
          productId,
          batchNumber: `B-${Math.floor(1000 + Math.random() * 9000)}`,
          expiryDate: '2027-12-31',
          receivedDate: localIsoDate(),
          costPricePaisa: Math.round(newPackPrice * 0.75 * 100),
          mrpPaisa: newPackPrice * 100,
          quantitySmallestUnit: 200,
          status: BatchStatus.ACTIVE,
          supplierName: 'Premier Distributors Ltd',
        },
      ],
    };

    onAddProduct(newProd);
    setShowAddModal(false);
    setNewBrand('');
    setNewGeneric('');
  };

  return (
    <div className="space-y-5">
      {/* ── Action & Filter Bar ────────────────────────────────────────────── */}
      <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="w-4 h-4 text-emerald-700 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search product master..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600 font-medium"
            />
          </div>

          <select
            value={drugClassFilter}
            onChange={(e) => setDrugClassFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600 bg-white"
          >
            <option value="ALL">All Drug Classes</option>
            <option value={DrugClass.OTC}>OTC Only</option>
            <option value={DrugClass.RX}>Prescription (Rx)</option>
            <option value={DrugClass.CONTROLLED}>Controlled (Sched G)</option>
            <option value={DrugClass.NARCOTIC}>Narcotics (Form 7)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border border-emerald-300 rounded-lg overflow-hidden text-xs">
            <button
              onClick={() => setViewMode('products')}
              className={`px-3 py-1.5 font-semibold transition ${
                viewMode === 'products'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white text-emerald-900 hover:bg-emerald-50'
              }`}
            >
              Product View
            </button>
            <button
              onClick={() => setViewMode('batches')}
              className={`px-3 py-1.5 font-semibold transition ${
                viewMode === 'batches'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white text-emerald-900 hover:bg-emerald-50'
              }`}
            >
              FEFO Batches View
            </button>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg flex items-center gap-1.5 shadow-xs transition"
          >
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>
      </div>

      {/* ── View 1: Products Table ─────────────────────────────────────────── */}
      {viewMode === 'products' && (
        <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-emerald-50/80 text-emerald-950 font-semibold border-b border-emerald-200">
                <tr>
                  <th className="py-3 px-4">Code / Barcode</th>
                  <th className="py-3 px-4">Brand & Generic Name</th>
                  <th className="py-3 px-4">Drug Class</th>
                  <th className="py-3 px-4">Rack Location</th>
                  <th className="py-3 px-4">Total Stock</th>
                  <th className="py-3 px-4">Default MRP</th>
                  {!isCashier && <th className="py-3 px-4">Purchase Cost</th>}
                  <th className="py-3 px-4">Batches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-100 text-emerald-950">
                {filteredProducts.map((p) => {
                  const totalStock = p.batches.reduce((sum, b) => sum + b.quantitySmallestUnit, 0);
                  const defaultUnit = p.units.find((u) => u.isDefaultSaleUnit) || p.units[0];
                  const avgCost = p.batches[0]?.costPricePaisa || 0;

                  return (
                    <tr key={p.id} className="hover:bg-emerald-50/40 transition">
                      <td className="py-3 px-4 font-mono text-[11px] text-emerald-800">
                        <div>{p.code}</div>
                        <div className="text-[10px] text-emerald-600 flex items-center gap-1">
                          <Barcode className="w-3 h-3" /> {p.barcode}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-emerald-950">{p.brandName}</div>
                        <div className="text-[11px] text-emerald-700 italic">{p.genericName}</div>
                        <div className="text-[10px] text-emerald-600 mt-0.5">{p.company}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.drugClass === DrugClass.NARCOTIC
                              ? 'bg-red-100 text-red-800'
                              : p.drugClass === DrugClass.CONTROLLED
                              ? 'bg-purple-100 text-purple-800'
                              : p.drugClass === DrugClass.RX
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {p.drugClass}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                          <MapPin className="w-3 h-3 text-slate-500" /> {p.rackLocation}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <span
                          className={`font-bold ${
                            totalStock <= p.minStockAlert ? 'text-amber-600' : 'text-emerald-900'
                          }`}
                        >
                          {totalStock}
                        </span>{' '}
                        <span className="text-[10px] text-emerald-700">tabs/units</span>
                        {totalStock <= p.minStockAlert && (
                          <div className="text-[10px] text-amber-700 font-semibold flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" /> Reorder Alert
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-950">
                        Rs {(defaultUnit.pricePerUnitPaisa / 100).toFixed(2)}
                        <span className="text-[10px] text-emerald-700 font-normal block">
                          per {defaultUnit.name}
                        </span>
                      </td>
                      {!isCashier && (
                        <td className="py-3 px-4 font-mono text-emerald-700">
                          Rs {(avgCost / 100).toFixed(2)}
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold text-[11px]">
                          {p.batches.length} active
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── View 2: Batches & FEFO Expiry View ──────────────────────────────── */}
      {viewMode === 'batches' && (
        <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-emerald-50/80 text-emerald-950 font-semibold border-b border-emerald-200">
                <tr>
                  <th className="py-3 px-4">Medicine Brand</th>
                  <th className="py-3 px-4">Batch Number</th>
                  <th className="py-3 px-4">Expiry Date (FEFO)</th>
                  <th className="py-3 px-4">Available Quantity</th>
                  <th className="py-3 px-4">MRP (Paisa)</th>
                  {!isCashier && <th className="py-3 px-4">Cost (Paisa)</th>}
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Supplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-100 text-emerald-950">
                {allBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-emerald-50/40 transition">
                    <td className="py-3 px-4 font-bold text-emerald-950">{b.productBrand}</td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-800">{b.batchNumber}</td>
                    <td className="py-3 px-4 font-mono font-semibold">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-emerald-600" />
                        {b.expiryDate}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold">{b.quantitySmallestUnit} units</td>
                    <td className="py-3 px-4 font-mono">Rs {(b.mrpPaisa / 100).toFixed(2)}</td>
                    {!isCashier && (
                      <td className="py-3 px-4 font-mono text-emerald-700">
                        Rs {(b.costPricePaisa / 100).toFixed(2)}
                      </td>
                    )}
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          b.status === BatchStatus.EXPIRED
                            ? 'bg-red-100 text-red-800'
                            : b.status === BatchStatus.NEAR_EXPIRY
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-emerald-800 text-[11px]">{b.supplierName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add Product Modal ──────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateProduct}
            className="bg-white rounded-2xl max-w-lg w-full p-6 border border-emerald-200 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-base text-emerald-950 flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-700" /> Register New Medicine
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Brand Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Ciproxin 500mg"
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Generic Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Ciprofloxacin"
                  value={newGeneric}
                  onChange={(e) => setNewGeneric(e.target.value)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Drug Classification</label>
                <select
                  value={newDrugClass}
                  onChange={(e) => setNewDrugClass(e.target.value as DrugClass)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg bg-white"
                >
                  <option value={DrugClass.OTC}>OTC (Over The Counter)</option>
                  <option value={DrugClass.RX}>Prescription Only (Rx)</option>
                  <option value={DrugClass.CONTROLLED}>Controlled Substance</option>
                  <option value={DrugClass.NARCOTIC}>Narcotic (Form 7)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Manufacturer</label>
                <input
                  type="text"
                  placeholder="e.g. Bayer Pakistan"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Rack / Shelf Location</label>
                <input
                  type="text"
                  placeholder="Rack (e.g. B-3-01)"
                  value={newRack}
                  onChange={(e) => setNewRack(e.target.value)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Pack MRP (PKR)</label>
                <input
                  type="number"
                  value={newPackPrice}
                  onChange={(e) => setNewPackPrice(Number(e.target.value))}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                Save Medicine & Generate Batches
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
