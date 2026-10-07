import React, { useState } from 'react';
import { Sparkles, Printer, Check, X, FileText, Smartphone, Lightbulb } from 'lucide-react';

interface TemplatePreviewModalProps {
  onClose: () => void;
}

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({ onClose }) => {
  const [formatSize, setFormatSize] = useState<'58mm' | '80mm' | 'a4'>('80mm');
  const [templateOption, setTemplateOption] = useState<'Professional' | 'Classic' | 'Modern' | 'Simple'>('Professional');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-text text-white rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl border border-border flex flex-col max-h-[92vh]">
        {/* ── Top Header ───────────────────────────────────────────────────── */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-amber-400 text-lg">✨</span>
            <div>
              <h2 className="text-base font-black tracking-tight">Quick View Template Preview</h2>
              <p className="text-xs text-slate-400">See exactly how your invoice will print.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body: Left Config + Right Preview ────────────────────────────── */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden bg-slate-900">
          {/* Left 4 Cols: Configuration */}
          <div className="md:col-span-4 p-5 bg-slate-900/90 border-r border-slate-800 flex flex-col justify-between space-y-4 overflow-y-auto">
            <div className="space-y-4">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  SELECT FORMAT SIZE
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setFormatSize('58mm')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      formatSize === '58mm'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                        : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    58mm
                  </button>
                  <button
                    onClick={() => setFormatSize('80mm')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      formatSize === '80mm'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                        : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    80mm
                  </button>
                  <button
                    onClick={() => setFormatSize('a4')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                      formatSize === 'a4'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                        : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    📄 A4 Page
                  </button>
                </div>
              </div>

              {/* Template Style Selector */}
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  TEMPLATE STYLE
                </span>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {(['Professional', 'Modern', 'Classic', 'Simple'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setTemplateOption(opt)}
                      className={`py-1.5 px-2.5 rounded-lg border text-left text-xs font-semibold transition ${
                        templateOption === opt
                          ? 'bg-blue-600/30 text-blue-300 border-blue-500'
                          : 'bg-slate-800/50 text-slate-400 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Specs */}
              <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/80 space-y-2 text-xs">
                <span className="font-bold text-slate-200 block text-xs">Template Specs</span>
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Option:</span>
                  <span className="text-white font-medium">{templateOption}</span>
                </div>
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Paper Width:</span>
                  <span className="text-white font-medium">
                    {formatSize === 'a4' ? '210mm (A4)' : `${formatSize} (Thermal)`}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Layout type:</span>
                  <span className="text-white font-medium">
                    {formatSize === 'a4' ? 'Portrait Sheet' : 'Continuous Roll'}
                  </span>
                </div>
              </div>

              {/* Tip Box */}
              <div className="p-3 bg-blue-950/40 rounded-xl border border-blue-800/60 text-xs text-blue-300 flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  <strong>Tip:</strong> The printed layout is dynamic and will adjust perfectly
                  according to the printer size defined in settings.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={() => {
                  window.print();
                  onClose();
                }}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Apply This Template
              </button>
              <button
                onClick={onClose}
                className="w-full py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 font-semibold text-xs rounded-xl transition"
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Right 8 Cols: Interactive Invoice Paper Preview */}
          <div className="md:col-span-8 p-6 bg-slate-950 overflow-y-auto flex items-center justify-center">
            {formatSize !== 'a4' ? (
              /* ── 80mm Thermal Receipt (Exact replica of Screenshot 1 & 4) ── */
              <div
                className={`print-document print-document-${formatSize} bg-white text-slate-900 p-4 font-mono text-[11px] shadow-2xl rounded-sm border border-slate-300 select-none`}
                style={{ width: formatSize }}
              >
                <div className="text-center space-y-0.5">
                  <div className="text-xs font-black tracking-wider uppercase">✦ SALES RECEIPT ✦</div>
                  <h3 className="font-extrabold text-sm text-slate-950">Demo Store</h3>
                  <p className="text-[10px] text-slate-600">Bahawalpur • Ph: 03011234567</p>
                  <div className="border-b border-dashed border-slate-400 my-1.5" />
                </div>

                <div className="space-y-0.5 text-[10px]">
                  <div className="flex justify-between">
                    <span>Invoice #</span>
                    <span className="font-bold border border-slate-400 px-1">INV-87654321</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date</span>
                    <span>06/10/2026, 11:54:23 pm</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cashier</span>
                    <span>d</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Customer</span>
                    <span className="truncate max-w-[150px]">Ahmed Tariq • 0300-1234567</span>
                  </div>
                </div>

                <div className="border-b border-dashed border-slate-400 my-1.5" />

                <div className="text-[10px] space-y-1">
                  <div className="flex justify-between font-bold text-slate-700">
                    <span>Item</span>
                    <span>Qty×Rate Amt</span>
                  </div>
                  <div className="space-y-1">
                    <div>
                      <div className="font-bold">Wireless Optical Mouse 2.4G (Logitech)</div>
                      <div className="flex justify-between text-slate-600">
                        <span>RET-MOU-01</span>
                        <span>1×1850 1850</span>
                      </div>
                    </div>
                    <div>
                      <div className="font-bold">Executive Hardcover Notebook A5 (Deli)</div>
                      <div className="flex justify-between text-slate-600">
                        <span>RET-NTB-A5</span>
                        <span>2×450 900</span>
                      </div>
                    </div>
                    <div>
                      <div className="font-bold">Ballpoint Pen Box (Pack of 10) (Piano)</div>
                      <div className="flex justify-between text-slate-600">
                        <span>RET-PEN-10</span>
                        <span>1×300 300</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-900 mt-2 pt-1 space-y-0.5 text-[11px]">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>Rs. 3050</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>Discount</span>
                    <span>-Rs. 200</span>
                  </div>
                  <div className="flex justify-between font-black text-xs border-t border-slate-900 pt-0.5">
                    <span>NET TOTAL</span>
                    <span>Rs. 2850</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Amount Paid</span>
                    <span>Rs. 2850</span>
                  </div>
                  <div className="text-[10px] text-slate-700 pt-0.5">Payment: CASH</div>
                </div>

                <div className="border-t border-dashed border-slate-400 my-2 pt-1 text-center space-y-1">
                  {/* Urdu Greeting Footer */}
                  <div className="font-bold text-xs text-slate-950 font-serif" dir="rtl">
                    شکریہ! دوبارہ تشریف لائیں
                  </div>
                  <div className="text-[9px] text-slate-500">★ Thank you for your business ★</div>
                </div>
              </div>
            ) : (
              /* ── A4 Page Format (Exact replica of Screenshot 2, 3, 78) ── */
              <div className="print-document print-document-a4 bg-white text-slate-900 w-[520px] p-6 shadow-2xl rounded-sm border border-slate-300 font-sans text-xs space-y-4">
                {/* Header Banner */}
                <div className="bg-primary text-white p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-black">Demo Store</h3>
                    <p className="text-xs text-blue-200">📍 Bahawalpur • 📞 03011234567</p>
                  </div>
                  <div className="bg-white/10 p-2.5 rounded-lg text-right border border-white/20">
                    <span className="text-[10px] uppercase font-bold text-blue-200 block">
                      TAX INVOICE
                    </span>
                    <span className="text-sm font-black font-mono"># INV-87654321</span>
                    <span className="text-[9px] text-blue-200 block">06/10/2026, 11:54:28 pm</span>
                  </div>
                </div>

                {/* Bill to Info */}
                <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">
                      BILL TO
                    </span>
                    <span className="font-bold text-slate-900">Ahmed Tariq</span>
                    <span className="text-[11px] text-slate-600 block">0300-1234567</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">
                      CASHIER
                    </span>
                    <span className="font-bold text-slate-900">d</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">
                      PAYMENT
                    </span>
                    <span className="font-bold text-emerald-700">CASH (PAID)</span>
                  </div>
                </div>

                {/* Table */}
                <table className="w-full text-left text-xs">
                  <thead className="bg-text text-white">
                    <tr>
                      <th className="p-2">#</th>
                      <th className="p-2">DESCRIPTION</th>
                      <th className="p-2 text-center">QTY</th>
                      <th className="p-2 text-right">UNIT PRICE</th>
                      <th className="p-2 text-right">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="p-2">1</td>
                      <td className="p-2">
                        <span className="font-bold">Wireless Optical Mouse 2.4G</span>
                        <span className="text-[10px] text-slate-500 block">Logitech</span>
                      </td>
                      <td className="p-2 text-center">1</td>
                      <td className="p-2 text-right font-mono">Rs. 1850</td>
                      <td className="p-2 text-right font-mono font-bold">Rs. 1850</td>
                    </tr>
                    <tr>
                      <td className="p-2">2</td>
                      <td className="p-2">
                        <span className="font-bold">Executive Hardcover Notebook A5</span>
                        <span className="text-[10px] text-slate-500 block">Deli</span>
                      </td>
                      <td className="p-2 text-center">2</td>
                      <td className="p-2 text-right font-mono">Rs. 450</td>
                      <td className="p-2 text-right font-mono font-bold">Rs. 900</td>
                    </tr>
                    <tr>
                      <td className="p-2">3</td>
                      <td className="p-2">
                        <span className="font-bold">Ballpoint Pen Box (Pack of 10)</span>
                        <span className="text-[10px] text-slate-500 block">Piano</span>
                      </td>
                      <td className="p-2 text-center">1</td>
                      <td className="p-2 text-right font-mono">Rs. 300</td>
                      <td className="p-2 text-right font-mono font-bold">Rs. 300</td>
                    </tr>
                  </tbody>
                </table>

                {/* Summary Box */}
                <div className="flex justify-end pt-2">
                  <div className="w-56 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Subtotal (3 items)</span>
                      <span className="font-mono">Rs. 3050</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>Discount</span>
                      <span className="font-mono">-Rs. 200</span>
                    </div>
                    <div className="flex justify-between text-slate-700">
                      <span>Amount Paid</span>
                      <span className="font-mono">Rs. 2850</span>
                    </div>
                    <div className="flex justify-between font-black text-sm text-text border-t border-border pt-1">
                      <span>TOTAL</span>
                      <span className="font-mono">Rs. 2850</span>
                    </div>
                  </div>
                </div>

                {/* Urdu Footer & Signature */}
                <div className="border-t border-slate-200 pt-4 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-sm text-slate-900" dir="rtl">
                      شکریہ! دوبارہ تشریف لائیں
                    </div>
                    <div className="text-[10px] text-slate-500">★ Thank you for your business ★</div>
                  </div>
                  <div className="text-center">
                    <div className="w-32 border-b border-slate-400 mb-1" />
                    <span className="text-[10px] text-slate-500">Authorized Signature</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
