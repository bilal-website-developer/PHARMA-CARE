import React, { useState } from 'react';
import { Layers, Plus, Tag, Boxes, Check, Trash2, Edit2, Download, Upload } from 'lucide-react';

export const MasterDataView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'categories' | 'brands' | 'units'>('categories');

  // Categories
  const [categories, setCategories] = useState([
    { id: '1', name: 'Analgesics & Pain Relief', productsCount: 14, lowStockAlert: 10 },
    { id: '2', name: 'Antibiotics & Antivirals', productsCount: 18, lowStockAlert: 15 },
    { id: '3', name: 'Cardiovascular & Hypertension', productsCount: 12, lowStockAlert: 8 },
    { id: '4', name: 'Psychotropic & Sedatives', productsCount: 6, lowStockAlert: 5 },
    { id: '5', name: 'Surgical & Bandages', productsCount: 22, lowStockAlert: 20 },
  ]);
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatAlert, setNewCatAlert] = useState(10);

  // Brands / Companies
  const [brands, setBrands] = useState([
    { id: '1', name: 'GSK Pakistan', productsCount: 25 },
    { id: '2', name: 'Getz Pharma', productsCount: 30 },
    { id: '3', name: 'Abbott Laboratories', productsCount: 18 },
    { id: '4', name: 'Martin Dow Healthcare', productsCount: 12 },
    { id: '5', name: 'Sanofi-Aventis', productsCount: 14 },
    { id: '6', name: 'Bayer Healthcare', productsCount: 8 },
  ]);
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');

  // Units
  const [units, setUnits] = useState([
    { id: '1', name: 'Pack (Box)', abbr: 'Pack' },
    { id: '2', name: 'Blister Strip', abbr: 'Strip' },
    { id: '3', name: 'Tablet (Loose)', abbr: 'Tab' },
    { id: '4', name: 'Capsule', abbr: 'Cap' },
    { id: '5', name: 'Syrup Bottle (120ml)', abbr: 'Btl' },
    { id: '6', name: 'Injection Vial', abbr: 'Vial' },
  ]);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');
  const [newUnitAbbr, setNewUnitAbbr] = useState('');

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName) return;
    setCategories((prev) => [
      ...prev,
      { id: Date.now().toString(), name: newCatName, productsCount: 0, lowStockAlert: newCatAlert },
    ]);
    setNewCatName('');
    setShowAddCat(false);
  };

  const handleAddBrand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName) return;
    setBrands((prev) => [...prev, { id: Date.now().toString(), name: newBrandName, productsCount: 0 }]);
    setNewBrandName('');
    setShowAddBrand(false);
  };

  const handleAddUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitName) return;
    setUnits((prev) => [
      ...prev,
      { id: Date.now().toString(), name: newUnitName, abbr: newUnitAbbr || newUnitName },
    ]);
    setNewUnitName('');
    setNewUnitAbbr('');
    setShowAddUnit(false);
  };

  return (
    <div className="space-y-5">
      {/* ── Top Header & Tab Switcher ─────────────────────────────────────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
            <span>⚙️</span> Master Data
          </h2>
          <p className="text-xs text-slate-500">Configure global categories, brands and packaging units.</p>
        </div>

        {/* Tab Buttons (Matching Screenshot 16) */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600">
          <button
            onClick={() => setActiveTab('categories')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'categories' ? 'bg-blue-600 text-white shadow-xs' : 'hover:text-slate-900'
            }`}
          >
            Categories
          </button>
          <button
            onClick={() => setActiveTab('brands')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'brands' ? 'bg-blue-600 text-white shadow-xs' : 'hover:text-slate-900'
            }`}
          >
            Brands
          </button>
          <button
            onClick={() => setActiveTab('units')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'units' ? 'bg-blue-600 text-white shadow-xs' : 'hover:text-slate-900'
            }`}
          >
            Units
          </button>
        </div>
      </div>

      {/* ── TAB 1: CATEGORIES ──────────────────────────────────────────────── */}
      {activeTab === 'categories' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold text-sm text-slate-900">Categories</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddCat(!showAddCat)}
                className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-1 shadow-xs transition"
              >
                <Plus className="w-3.5 h-3.5" /> Add Category
              </button>
            </div>
          </div>

          {/* Add Form (Matching Screenshot 17) */}
          {showAddCat && (
            <form onSubmit={handleAddCategory} className="p-4 bg-slate-50 border-b border-slate-200 text-xs space-y-3">
              <span className="font-bold text-slate-800 block">New Category</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Antibiotics, Surgical"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Low Stock Alert Threshold</label>
                  <input
                    type="number"
                    value={newCatAlert}
                    onChange={(e) => setNewCatAlert(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-mono"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg"
                >
                  Save Category
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddCat(false)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Table */}
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-700 font-bold border-b">
              <tr>
                <th className="py-2.5 px-4">SR.</th>
                <th className="py-2.5 px-4">CATEGORY NAME</th>
                <th className="py-2.5 px-4">PRODUCTS</th>
                <th className="py-2.5 px-4">LOW STOCK ALERT</th>
                <th className="py-2.5 px-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((c, idx) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono text-slate-400">{idx + 1}</td>
                  <td className="py-2.5 px-4 font-bold text-slate-900">{c.name}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{c.productsCount}</td>
                  <td className="py-2.5 px-4 font-mono text-amber-600 font-bold">⚠️ &le; {c.lowStockAlert}</td>
                  <td className="py-2.5 px-4 text-right space-x-2">
                    <button className="text-blue-600 hover:underline">Edit</button>
                    <button className="text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 2: BRANDS ─────────────────────────────────────────────────── */}
      {activeTab === 'brands' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900">Brands / Pharmaceutical Manufacturers</h3>
            <button
              onClick={() => setShowAddBrand(!showAddBrand)}
              className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-1 shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Brand
            </button>
          </div>

          {showAddBrand && (
            <form onSubmit={handleAddBrand} className="p-4 bg-slate-50 border-b border-slate-200 text-xs space-y-3">
              <span className="font-bold text-slate-800 block">New Brand</span>
              <input
                type="text"
                placeholder="e.g. GSK, Bayer, Novartis"
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                className="w-full sm:w-80 px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                required
              />
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white font-bold rounded-lg">
                  Save Brand
                </button>
                <button type="button" onClick={() => setShowAddBrand(false)} className="px-3 py-1.5 text-slate-600 rounded-lg">
                  Cancel
                </button>
              </div>
            </form>
          )}

          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-700 font-bold border-b">
              <tr>
                <th className="py-2.5 px-4">BRAND NAME</th>
                <th className="py-2.5 px-4">REGISTERED PRODUCTS</th>
                <th className="py-2.5 px-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {brands.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-bold text-slate-900">{b.name}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{b.productsCount}</td>
                  <td className="py-2.5 px-4 text-right space-x-2">
                    <button className="text-blue-600 hover:underline">View Products</button>
                    <button className="text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 3: UNITS ──────────────────────────────────────────────────── */}
      {activeTab === 'units' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900">Units of Measure & Packaging</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddUnit(!showAddUnit)}
                className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-1 shadow-xs transition"
              >
                <Plus className="w-3.5 h-3.5" /> Add Unit
              </button>
            </div>
          </div>

          {showAddUnit && (
            <form onSubmit={handleAddUnit} className="p-4 bg-slate-50 border-b border-slate-200 text-xs space-y-3">
              <span className="font-bold text-slate-800 block">New Unit</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Unit Name (e.g. Blister Pack, Carton)"
                  value={newUnitName}
                  onChange={(e) => setNewUnitName(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  required
                />
                <input
                  type="text"
                  placeholder="Abbreviation (e.g. Pk, Str)"
                  value={newUnitAbbr}
                  onChange={(e) => setNewUnitAbbr(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-mono"
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white font-bold rounded-lg">
                  Save Unit
                </button>
                <button type="button" onClick={() => setShowAddUnit(false)} className="px-3 py-1.5 text-slate-600 rounded-lg">
                  Cancel
                </button>
              </div>
            </form>
          )}

          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-700 font-bold border-b">
              <tr>
                <th className="py-2.5 px-4">UNIT NAME</th>
                <th className="py-2.5 px-4">ABBREVIATION</th>
                <th className="py-2.5 px-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {units.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-bold text-slate-900">{u.name}</td>
                  <td className="py-2.5 px-4 font-mono text-blue-600 font-bold">{u.abbr}</td>
                  <td className="py-2.5 px-4 text-right space-x-2">
                    <button className="text-blue-600 hover:underline">Edit</button>
                    <button className="text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
