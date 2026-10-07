import React, { useState } from 'react';
import {
  Store,
  Upload,
  Check,
  Eye,
  Trash2,
  AlertTriangle,
  Smartphone,
  Save,
  Printer,
  Sparkles,
} from 'lucide-react';

interface SettingsViewProps {
  onOpenTemplatePreview: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onOpenTemplatePreview }) => {
  const [shopName, setShopName] = useState('Demo Store');
  const [phone, setPhone] = useState('03011234567');
  const [city, setCity] = useState('Bahawalpur');
  const [activeTemplate, setActiveTemplate] = useState('Classic');
  const [urduFooter, setUrduFooter] = useState('شکریہ! دوبارہ تشریف لائیں');
  const [debtTemplate, setDebtTemplate] = useState(
    'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!'
  );
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl mx-auto pb-8">
      {/* ── Shop Profile ─────────────────────────────────────────────────── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-4">
        <div>
          <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
            <span>⚙️</span> Shop Profile
          </h2>
          <p className="text-xs text-slate-500">This information will appear on your prints and invoices.</p>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Store / Shop Name</label>
            <input
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl font-medium focus:outline-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Contact Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl font-medium focus:outline-blue-600"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Location / City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl font-medium focus:outline-blue-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Invoice Footer & Urdu Text (Matching Screenshot 50) ────────────── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
        <h3 className="text-sm font-black text-slate-900">Invoice Footers & Urdu Greeting</h3>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Invoice Footer (Urdu/English)
          </label>
          <input
            type="text"
            value={urduFooter}
            onChange={(e) => setUrduFooter(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl font-serif text-sm text-right focus:outline-blue-600"
            dir="rtl"
          />
        </div>
      </div>

      {/* ── Billing Template Selection (Matching Screenshot 54, 55, 67, 75) ── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900">Billing Template</h3>
            <p className="text-xs text-slate-500">
              Choose how your receipts and invoices look when printed. Works for both 80mm thermal and A4.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenTemplatePreview}
            className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg flex items-center gap-1 transition"
          >
            <Sparkles className="w-3.5 h-3.5" /> Full Screen Preview
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {[
            {
              id: 'Simple',
              desc: 'Minimal & clean. No logo area. Compact spacing. Fast to print.',
              icon: '📄',
            },
            {
              id: 'Classic',
              desc: 'Standard receipt style with logo, dashed lines and item table. Recommended.',
              icon: '🧾',
            },
            {
              id: 'Professional',
              desc: 'Full invoice look — letterhead, invoice number box, PAID stamp, signature line.',
              icon: '📑',
            },
            {
              id: 'Modern',
              desc: 'Elegant & spacious. System sans-serif font, thin grey borders, cards for totals.',
              icon: '✨',
            },
          ].map((tmpl) => (
            <div
              key={tmpl.id}
              className={`p-3.5 rounded-2xl border flex flex-col justify-between transition ${
                activeTemplate === tmpl.id
                  ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-600/20'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div>
                <span className="text-xl block mb-1">{tmpl.icon}</span>
                <span className="font-bold text-slate-900 block">{tmpl.id}</span>
                {activeTemplate === tmpl.id && (
                  <span className="inline-block px-1.5 py-0.2 bg-blue-600 text-white text-[9px] font-bold rounded uppercase mt-0.5">
                    Active
                  </span>
                )}
                <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">{tmpl.desc}</p>
              </div>

              <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveTemplate(tmpl.id)}
                  className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition ${
                    activeTemplate === tmpl.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                  }`}
                >
                  {activeTemplate === tmpl.id ? 'Selected' : 'Select'}
                </button>
                <button
                  type="button"
                  onClick={onOpenTemplatePreview}
                  className="p-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
                  title="Preview"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── WhatsApp Messaging Templates (Matching Screenshot 51 & 52) ────── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-3">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <span>💬</span> WhatsApp Messaging Templates
        </h3>
        <p className="text-xs text-slate-500">
          Variables: <code>[Name]</code>, <code>[Shop Name]</code>, <code>[Amount]</code>, <code>[ID]</code>
        </p>

        <div className="text-xs space-y-2">
          <label className="block font-semibold text-slate-700">Debt Reminder Template</label>
          <textarea
            rows={3}
            value={debtTemplate}
            onChange={(e) => setDebtTemplate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-blue-600"
          />
        </div>
      </div>

      {/* ── Bottom Save Strip ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm sticky bottom-4 z-20">
        <div className="text-xs text-slate-500">
          {savedSuccess ? (
            <span className="text-emerald-600 font-bold flex items-center gap-1">
              <Check className="w-4 h-4" /> Changes saved successfully!
            </span>
          ) : (
            'Make changes and click Update Profile.'
          )}
        </div>

        <button
          type="submit"
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md shadow-blue-600/25 flex items-center gap-1.5 transition"
        >
          <Save className="w-4 h-4" /> Update Profile
        </button>
      </div>
    </form>
  );
};
