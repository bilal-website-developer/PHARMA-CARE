import React, { useState } from 'react';
import { MessageSquare, Search, Lightbulb } from 'lucide-react';
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
    <div className="space-y-3">
      {/* ── Slim Header Row with Search ── */}
      <section className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-black text-text">WhatsApp Reminders</h2>
          <span className="rounded-full bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 text-[11px]">
            {debtCustomers.length} with dues
          </span>
        </div>

        <div className="relative min-w-56 flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Search by customer name or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-border bg-surface rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent text-text"
          />
        </div>
      </section>

      {/* ── Compact Customer Dues Table ── */}
      <div className="bg-surface rounded-xl border border-border shadow-2xs overflow-hidden">
        <table className="w-full text-xs text-left">
          <thead className="bg-surface border-b border-border text-muted font-bold text-[11px] uppercase tracking-wider">
            <tr>
              <th className="py-2.5 px-3.5">Customer</th>
              <th className="py-2.5 px-3.5">Phone Number</th>
              <th className="py-2.5 px-3.5">Outstanding Balance</th>
              <th className="py-2.5 px-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono">
            {debtCustomers.map((c) => (
              <tr key={c.id} className="hover:bg-surface-muted/50 transition">
                <td className="py-2 px-3.5 font-bold text-text font-sans">{c.name}</td>
                <td className="py-2 px-3.5 text-muted">{c.phone}</td>
                <td className="py-2 px-3.5 font-black text-danger">
                  Rs. {(c.currentBalancePaisa / 100).toFixed(0)}
                </td>
                <td className="py-2 px-3.5 text-right font-sans">
                  <button
                    onClick={() => sendWhatsAppReminder(c)}
                    className="px-2.5 py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg inline-flex items-center gap-1 shadow-2xs transition"
                  >
                    <MessageSquare className="w-3 h-3" /> Send Reminder
                  </button>
                </td>
              </tr>
            ))}
            {debtCustomers.length === 0 && (
              <tr>
                <td colSpan={4} className="py-10 text-center text-xs text-muted font-sans">
                  No customers found with outstanding balance. All accounts are settled!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pro-Tip: Small One-Line Info Note ── */}
      <div className="px-3 py-2 bg-blue-50/70 border border-blue-200/80 rounded-lg text-xs text-blue-900 flex items-center gap-2">
        <Lightbulb className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <span className="text-[11px] text-blue-900">
          <strong>Tip:</strong> Free WhatsApp Link system opens WhatsApp Web or App with pre-filled message — just press Enter to send.
        </span>
      </div>
    </div>
  );
};
