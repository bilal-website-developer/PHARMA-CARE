import React, { useState } from 'react';
import {
  Users,
  Search,
  Plus,
  Receipt,
  Phone,
  X,
} from 'lucide-react';
import { Customer, LedgerEntry, UserRole } from '../types/pharmacy';
import {
  PharmacyMemoSettings,
  ReceiptFormat,
  buildPaymentMemoData,
} from '../utils/receipt';
import { buildPrintSnapshot, PrintReceiptHandler } from '../utils/printWorkflow';

interface CustomerLedgerScreenProps {
  customers: Customer[];
  ledgerEntries: Record<string, LedgerEntry[]>;
  onRecordPayment: (customerId: string, amountPaisa: number, note: string) => Promise<{
    referenceNo: string;
    dateTime: string;
    balanceAfterPaisa: number;
  }>;
  onAddCustomer: (customer: {
    name: string;
    phone: string;
    cnic: string;
    address: string;
    creditLimitPaisa: number;
  }) => Promise<Customer>;
  memoSettings: PharmacyMemoSettings;
  memoFormat: ReceiptFormat;
  currentUserName: string;
  currentRole: UserRole;
  onPrintReceipt: PrintReceiptHandler;
}

export const CustomerLedgerScreen: React.FC<CustomerLedgerScreenProps> = ({
  customers,
  ledgerEntries,
  onRecordPayment,
  onAddCustomer,
  memoSettings,
  memoFormat,
  currentUserName,
  currentRole,
  onPrintReceipt,
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(customers[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmountPKR, setPaymentAmountPKR] = useState<number>(0);
  const [paymentNote, setPaymentNote] = useState('Cash received on counter');
  const [paymentPrintNotice, setPaymentPrintNotice] = useState('');
  const [customerSaveError, setCustomerSaveError] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);

  // New Customer Modal
  const [showNewCustModal, setShowNewCustModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCnic, setNewCnic] = useState('');
  const [newCreditLimit, setNewCreditLimit] = useState(20000);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const currentLedger = selectedCustomerId ? ledgerEntries[selectedCustomerId] || [] : [];

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery) ||
      (c.cnic && c.cnic.includes(searchQuery))
  );

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || paymentAmountPKR <= 0) return;
    let payment: Awaited<ReturnType<typeof onRecordPayment>>;
    try {
      payment = await onRecordPayment(selectedCustomerId, Math.round(paymentAmountPKR * 100), paymentNote);
    } catch (error) {
      setPaymentPrintNotice(`Payment could not be recorded. ${error instanceof Error ? error.message : 'Please try again.'}`);
      return;
    }
    try {
      const snapshot = buildPrintSnapshot(buildPaymentMemoData({
        referenceNo: payment.referenceNo,
        dateTime: payment.dateTime,
        customerName: selectedCustomer?.name ?? '',
        amountReceivedPaisa: Math.round(paymentAmountPKR * 100),
        balanceAfterPaisa: payment.balanceAfterPaisa,
        cashier: currentUserName,
        role: currentRole,
        terminal: memoSettings.terminalName,
      }), memoSettings, memoFormat);
      await onPrintReceipt('payment', snapshot);
      setPaymentPrintNotice('');
    } catch (error) {
      setPaymentPrintNotice(`Payment was recorded, but its receipt action failed. ${error instanceof Error ? error.message : 'The print document could not be opened.'}`);
    }
    setShowPaymentModal(false);
    setPaymentAmountPKR(0);
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCustomerSaveError('');
    setSavingCustomer(true);
    try {
      const newCustomer = await onAddCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
        cnic: newCnic.trim(),
        address: '',
        creditLimitPaisa: Math.round(newCreditLimit * 100),
      });
      setSelectedCustomerId(newCustomer.id);
      setShowNewCustModal(false);
      setNewName('');
      setNewPhone('');
      setNewCnic('');
    } catch (error) {
      setCustomerSaveError(error instanceof Error ? error.message : 'Could not save customer.');
    } finally {
      setSavingCustomer(false);
    }
  };

  const [drawerCustomerId, setDrawerCustomerId] = useState<string | null>(null);

  const drawerCustomer = customers.find((c) => c.id === drawerCustomerId);
  const drawerLedger = drawerCustomerId ? ledgerEntries[drawerCustomerId] || [] : [];

  const sendWhatsAppReminder = (c: Customer, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
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

  const openReceivePayment = (customerId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedCustomerId(customerId);
    setShowPaymentModal(true);
  };

  return (
    <div className="space-y-4">
      {paymentPrintNotice && <p role="status" className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text">{paymentPrintNotice}</p>}

      {/* ── Top Row: Search Field & "+ Add" Customer Button ── */}
      <section className="flex flex-wrap items-center justify-between gap-3 bg-surface p-3 rounded-card border border-border shadow-xs">
        <div className="relative flex-1 min-w-56">
          <Search className="w-4 h-4 text-muted absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search customers by name, phone or CNIC..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-border bg-surface text-text rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent font-medium"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowNewCustModal(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-primary hover:opacity-90 rounded-control shadow-xs transition shrink-0"
        >
          <Plus className="w-4 h-4" /> Add customer
        </button>
      </section>

      {/* ── Grid of Customer Cards (2 or 3 columns) ── */}
      {filteredCustomers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredCustomers.map((c) => {
            const initials = c.name.slice(0, 2).toUpperCase();
            const hasDue = c.currentBalancePaisa > 0;

            return (
              <div
                key={c.id}
                onClick={() => { setSelectedCustomerId(c.id); setDrawerCustomerId(c.id); }}
                className="group cursor-pointer bg-surface p-4 rounded-card border border-border hover:border-primary/60 shadow-xs hover:shadow-sm transition flex flex-col justify-between gap-3 text-xs"
              >
                {/* Card Header: Avatar with initial, Name, Phone */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0 text-xs">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-text group-hover:text-primary transition truncate text-sm">
                        {c.name}
                      </h4>
                      <p className="text-muted text-[11px] flex items-center gap-1 mt-0.5 font-mono">
                        <Phone className="w-3 h-3 text-muted" /> {c.phone}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[10px] uppercase font-bold text-muted block">Due Amount</span>
                    <span className={`font-mono font-black text-sm ${hasDue ? 'text-danger' : 'text-primary'}`}>
                      Rs. {(c.currentBalancePaisa / 100).toFixed(0)}
                    </span>
                  </div>
                </div>

                {/* Card Footer: Limit & Quick Action Buttons (Remind & Receive) */}
                <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted font-mono">
                    Limit: Rs. {(c.creditLimitPaisa / 100).toFixed(0)}
                  </span>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {hasDue && (
                      <button
                        type="button"
                        onClick={(e) => sendWhatsAppReminder(c, e)}
                        title="Send WhatsApp reminder"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/20 rounded-control border border-primary/20 transition"
                      >
                        Remind
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => openReceivePayment(c.id, e)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-primary hover:opacity-90 rounded-control transition"
                    >
                      Receive
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Friendly Empty State when no customers ── */}
      {filteredCustomers.length === 0 && (
        <div className="bg-surface rounded-card border border-border p-8 text-center text-xs text-muted max-w-md mx-auto space-y-2 mt-4">
          <Users className="w-10 h-10 text-muted mx-auto mb-1" />
          <h4 className="font-bold text-text text-sm">No customers found</h4>
          <p className="text-[11px] text-muted">
            {searchQuery ? `No customer matches "${searchQuery}".` : 'No credit customers have been added yet.'}
          </p>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs text-primary font-semibold hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      )}

      {/* ── Side Drawer / Modal for Customer Ledger ── */}
      {drawerCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-end">
          <div
            className="w-full max-w-2xl bg-surface h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
            role="dialog"
            aria-modal="true"
          >
            {/* Drawer Header */}
            <div className="p-4 bg-primary text-white flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white text-primary font-black flex items-center justify-center text-sm">
                  {drawerCustomer.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-black text-base text-white leading-tight">{drawerCustomer.name}</h3>
                  <p className="text-white/80 text-xs font-mono">
                    {drawerCustomer.phone} {drawerCustomer.cnic ? `· CNIC: ${drawerCustomer.cnic}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-white/80 block">Balance Due</span>
                  <span className="text-base font-black font-mono text-white">
                    Rs. {(drawerCustomer.currentBalancePaisa / 100).toFixed(2)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerCustomerId(null)}
                  className="p-1 text-white/80 hover:text-white hover:bg-white/10 rounded-control transition"
                  aria-label="Close statement"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick Actions in Drawer */}
            <div className="p-3 bg-surface-2 border-b border-border flex items-center justify-between gap-2 shrink-0">
              <span className="text-xs text-text font-semibold">
                Customer Statement ({drawerLedger.length} entries)
              </span>
              <div className="flex items-center gap-2">
                {drawerCustomer.currentBalancePaisa > 0 && (
                  <button
                    type="button"
                    onClick={(e) => sendWhatsAppReminder(drawerCustomer, e)}
                    className="px-3 py-1 text-xs font-bold bg-surface text-primary hover:bg-surface-2 rounded-control border border-border transition"
                  >
                    WhatsApp Reminder
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openReceivePayment(drawerCustomer.id)}
                  className="px-3 py-1 text-xs font-bold text-white bg-primary hover:opacity-90 rounded-control transition"
                >
                  Receive Payment
                </button>
              </div>
            </div>

            {/* Drawer Table */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="rounded-control border border-border overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-surface-2 text-muted font-bold border-b border-border">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Ref #</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3 text-right">Debit</th>
                      <th className="py-2.5 px-3 text-right">Credit</th>
                      <th className="py-2.5 px-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {drawerLedger.map((entry) => (
                      <tr key={entry.id} className="hover:bg-surface-2/60">
                        <td className="py-2 px-3 text-muted">{entry.date}</td>
                        <td className="py-2 px-3 font-semibold text-text">{entry.referenceNo}</td>
                        <td className="py-2 px-3 font-sans text-text max-w-[160px] truncate">{entry.description}</td>
                        <td className="py-2 px-3 text-right text-danger font-semibold">
                          {entry.debitPaisa > 0 ? `Rs. ${(entry.debitPaisa / 100).toFixed(0)}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-right text-primary font-semibold">
                          {entry.creditPaisa > 0 ? `Rs. ${(entry.creditPaisa / 100).toFixed(0)}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-text">
                          Rs. {(entry.runningBalancePaisa / 100).toFixed(0)}
                        </td>
                      </tr>
                    ))}
                    {drawerLedger.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-xs text-muted font-sans">
                          No transactions recorded for this customer yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment Modal ─────────────────────────────────────────────────── */}
      {showPaymentModal && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handlePaymentSubmit}
            className="bg-surface rounded-card max-w-sm w-full p-5 border border-border shadow-xl space-y-4 text-text"
          >
            <h3 className="font-bold text-base text-text flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" /> Receive Customer Payment
            </h3>
            <p className="text-xs text-muted">
              Receiving payment for <strong>{selectedCustomer.name}</strong> (Outstanding: Rs{' '}
              {(selectedCustomer.currentBalancePaisa / 100).toFixed(2)})
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-text mb-1">
                  Amount Received (PKR) *
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={paymentAmountPKR || ''}
                  onChange={(e) => setPaymentAmountPKR(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-border bg-surface text-text rounded-control text-sm font-mono font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-semibold text-text mb-1">Remarks / Mode</label>
                <input
                  type="text"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="w-full px-3 py-1.5 border border-border bg-surface text-text rounded-control text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 rounded-control"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold text-white bg-primary hover:opacity-90 rounded-control transition"
              >
                Save Receipt
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── New Customer Modal ────────────────────────────────────────────── */}
      {showNewCustModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCustomer}
            className="bg-surface rounded-card max-w-sm w-full p-5 border border-border shadow-xl space-y-4 text-text"
          >
            <h3 className="font-bold text-base text-text flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> New Credit Customer
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-text mb-1">Full Name *</label>
                <input
                  type="text"
                  placeholder="Customer Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-border bg-surface text-text rounded-control text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-text mb-1">Phone Number</label>
                <input
                  type="text"
                  placeholder="0300-1234567"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full px-3 py-1.5 border border-border bg-surface text-text rounded-control text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label className="block font-semibold text-text mb-1">CNIC (Optional)</label>
                <input
                  type="text"
                  placeholder="35201-xxxxxxx-x"
                  value={newCnic}
                  onChange={(e) => setNewCnic(e.target.value)}
                  className="w-full px-3 py-1.5 border border-border bg-surface text-text rounded-control text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label className="block font-semibold text-text mb-1">Credit Limit (PKR)</label>
                <input
                  type="number"
                  value={newCreditLimit}
                  onChange={(e) => setNewCreditLimit(Number(e.target.value))}
                  className="w-full px-3 py-1.5 border border-border bg-surface text-text rounded-control text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </div>

            {customerSaveError && <p role="alert" className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-text">{customerSaveError}</p>}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowNewCustModal(false)}
                disabled={savingCustomer}
                className="px-3.5 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 rounded-control"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCustomer}
                className="px-4 py-1.5 text-xs font-bold text-white bg-primary hover:opacity-90 rounded-control transition"
              >
                {savingCustomer ? 'Saving…' : 'Create Khata'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
