import React, { useState } from 'react';
import { MessageSquare, Search, Send, CheckCircle2, Phone, AlertCircle, Lightbulb } from 'lucide-react';
import { Customer } from '../types/pharmacy';

interface WhatsAppRemindersViewProps {
  customers: Customer[];
}

export const WhatsAppRemindersView: React.FC<WhatsAppRemindersViewProps> = ({ customers }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const debtCustomers = customers.filter(
    (c) =>
      c.currentBalancePaisa > 0 &&
      (c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm))
  );

  const sendWhatsAppReminder = (c: Customer) => {
    const rawPhone = c.phone.replace(/[^0-9]/g, '');
    const formattedPhone = rawPhone.startsWith('0') ? `92${rawPhone.slice(1)}` : rawPhone;
    const duePKR = (c.currentBalancePaisa / 100).toFixed(0);

    const message = encodeURIComponent(
      `Assalam-o-Alaikum ${c.name},\n\n` +
      `This is a gentle reminder from your pharmacy.\n` +
      `Your outstanding ledger balance is *Rs. ${duePKR}*.\n\n` +
      `Kindly clear the dues at your earliest convenience.\n` +
      `JazakAllah Khair!`
    );

    window.open(`https://wa.me/${formattedPhone}?text=${message}`, '_blank');
  };

  return (
    <div className="space-y-5">
      {/* ── Top Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
            <span>📲</span> WhatsApp Reminders
          </h2>
          <p className="text-xs text-slate-500">
            Send instant 1-click debt collection reminders to credit customers with outstanding balances.
          </p>
        </div>
      </div>

      {/* ── Search Bar ──────────────────────────────────────────────────────── */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by customer name or phone number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-blue-600 font-medium"
          />
        </div>
      </div>

      {/* ── Customer Dues Table (Matching Screenshot 26) ────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 text-slate-700 font-bold border-b">
            <tr>
              <th className="py-3 px-4">CUSTOMER</th>
              <th className="py-3 px-4">PHONE NUMBER</th>
              <th className="py-3 px-4">OUTSTANDING BALANCE</th>
              <th className="py-3 px-4 text-right">ACTION</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {debtCustomers.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-bold text-slate-900">{c.name}</td>
                <td className="py-3 px-4 font-mono text-slate-600">{c.phone}</td>
                <td className="py-3 px-4 font-mono font-bold text-red-600">
                  Rs. {(c.currentBalancePaisa / 100).toFixed(0)}
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => sendWhatsAppReminder(c)}
                    className="px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg inline-flex items-center gap-1.5 shadow-xs transition"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Send Reminder
                  </button>
                </td>
              </tr>
            ))}
            {debtCustomers.length === 0 && (
              <tr>
                <td colSpan={4} className="py-12 text-center text-xs text-slate-400">
                  No customers found with outstanding balance. All accounts are settled!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pro-Tip Box (Matching Screenshot 26) ────────────────────────────── */}
      <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-2xl text-xs text-blue-900 flex items-start gap-3">
        <div className="p-2 bg-blue-100 text-blue-700 rounded-xl shrink-0">
          <Lightbulb className="w-5 h-5" />
        </div>
        <div>
          <h4 className="font-bold text-blue-950">Pro-Tip: Keeping it Free</h4>
          <p className="mt-0.5 text-blue-800/90 leading-relaxed text-[11px]">
            We use the official WhatsApp Link system which is completely free. When you click "Send Reminder", it will open WhatsApp Web or the App on your device with the customized message and customer details ready. You just need to press Enter to send it!
          </p>
        </div>
      </div>
    </div>
  );
};
