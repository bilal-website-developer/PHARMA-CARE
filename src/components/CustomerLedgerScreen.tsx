import React, { useState } from 'react';
import {
  Users,
  Search,
  Plus,
  CreditCard,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  Phone,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { Customer, LedgerEntry } from '../types/pharmacy';

interface CustomerLedgerScreenProps {
  customers: Customer[];
  ledgerEntries: Record<string, LedgerEntry[]>;
  onRecordPayment: (customerId: string, amountPaisa: number, note: string) => void;
  onAddCustomer: (customer: Customer) => void;
}

export const CustomerLedgerScreen: React.FC<CustomerLedgerScreenProps> = ({
  customers,
  ledgerEntries,
  onRecordPayment,
  onAddCustomer,
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(customers[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmountPKR, setPaymentAmountPKR] = useState<number>(0);
  const [paymentNote, setPaymentNote] = useState('Cash received on counter');

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

  const handlePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || paymentAmountPKR <= 0) return;
    onRecordPayment(selectedCustomerId, paymentAmountPKR * 100, paymentNote);
    setShowPaymentModal(false);
    setPaymentAmountPKR(0);
  };

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    const newCust: Customer = {
      id: `cust-${Date.now()}`,
      name: newName,
      phone: newPhone || '0300-0000000',
      cnic: newCnic,
      creditLimitPaisa: newCreditLimit * 100,
      currentBalancePaisa: 0,
      address: 'Local Customer',
    };
    onAddCustomer(newCust);
    setSelectedCustomerId(newCust.id);
    setShowNewCustModal(false);
    setNewName('');
    setNewPhone('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* ── Left 4 Cols: Customer List ──────────────────────────────────────── */}
      <div className="lg:col-span-4 bg-white p-4 rounded-xl border border-emerald-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-emerald-100">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-700" />
            <h3 className="text-sm font-bold text-emerald-950">Khata Customers</h3>
          </div>
          <button
            onClick={() => setShowNewCustModal(true)}
            className="p-1 text-emerald-700 hover:bg-emerald-50 rounded"
            title="Add Customer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-emerald-600 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600"
          />
        </div>

        <div className="space-y-1.5 max-h-[560px] overflow-y-auto">
          {filteredCustomers.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCustomerId(c.id)}
              className={`w-full text-left p-3 rounded-lg border text-xs transition ${
                selectedCustomerId === c.id
                  ? 'bg-emerald-50 border-emerald-400 shadow-xs'
                  : 'bg-white border-emerald-100 hover:bg-emerald-50/50'
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="font-bold text-emerald-950">{c.name}</span>
                <span
                  className={`font-mono font-bold text-[11px] ${
                    c.currentBalancePaisa > 0 ? 'text-red-600' : 'text-emerald-700'
                  }`}
                >
                  Rs {(c.currentBalancePaisa / 100).toFixed(0)}
                </span>
              </div>
              <div className="text-[11px] text-emerald-700 flex items-center gap-1 mt-1">
                <Phone className="w-3 h-3" /> {c.phone}
              </div>
              <div className="text-[10px] text-emerald-600/80 mt-0.5">
                Limit: Rs {(c.creditLimitPaisa / 100).toFixed(0)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right 8 Cols: Customer Statement / Ledger ───────────────────────── */}
      <div className="lg:col-span-8 bg-white p-5 rounded-xl border border-emerald-200 shadow-xs space-y-4">
        {selectedCustomer ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-emerald-100 gap-3">
              <div>
                <h2 className="text-lg font-bold text-emerald-950">{selectedCustomer.name}</h2>
                <div className="flex items-center gap-3 text-xs text-emerald-800 mt-0.5">
                  <span>Phone: {selectedCustomer.phone}</span>
                  {selectedCustomer.cnic && <span>CNIC: {selectedCustomer.cnic}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-right mr-2">
                  <div className="text-[10px] uppercase font-bold text-emerald-600">Total Due Balance</div>
                  <div className="text-base font-mono font-bold text-red-600">
                    Rs {(selectedCustomer.currentBalancePaisa / 100).toFixed(2)}
                  </div>
                </div>

                <button
                  onClick={() => setShowPaymentModal(true)}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 shadow-xs transition"
                >
                  <Receipt className="w-4 h-4" /> Receive Payment
                </button>
              </div>
            </div>

            {/* Ledger Transactions Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-emerald-50 text-emerald-950 font-semibold border-b border-emerald-200">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Ref #</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 text-right">Debit (Added)</th>
                    <th className="py-2.5 px-3 text-right">Credit (Paid)</th>
                    <th className="py-2.5 px-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-100">
                  {currentLedger.map((entry) => (
                    <tr key={entry.id} className="hover:bg-emerald-50/30">
                      <td className="py-2.5 px-3 text-emerald-800 font-mono">{entry.date}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-emerald-900">
                        {entry.referenceNo}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">{entry.description}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-red-600 font-semibold">
                        {entry.debitPaisa > 0 ? `Rs ${(entry.debitPaisa / 100).toFixed(2)}` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-700 font-semibold">
                        {entry.creditPaisa > 0 ? `Rs ${(entry.creditPaisa / 100).toFixed(2)}` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        Rs {(entry.runningBalancePaisa / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {currentLedger.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                        No ledger transactions recorded for this customer yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-xs text-slate-400">
            Select a customer from the left list to view their ledger.
          </div>
        )}
      </div>

      {/* ── Receive Payment Modal ─────────────────────────────────────────── */}
      {showPaymentModal && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handlePaymentSubmit}
            className="bg-white rounded-2xl max-w-sm w-full p-6 border border-emerald-200 shadow-xl space-y-4"
          >
            <h3 className="font-bold text-base text-emerald-950 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-emerald-700" /> Receive Customer Payment
            </h3>
            <p className="text-xs text-emerald-800">
              Receiving payment for <strong>{selectedCustomer.name}</strong> (Outstanding: Rs{' '}
              {(selectedCustomer.currentBalancePaisa / 100).toFixed(2)})
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-emerald-900 mb-1">
                  Amount Received (PKR) *
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={paymentAmountPKR || ''}
                  onChange={(e) => setPaymentAmountPKR(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-emerald-300 rounded-lg text-sm font-mono font-bold"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Remarks / Mode</label>
                <input
                  type="text"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
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
            className="bg-white rounded-2xl max-w-sm w-full p-6 border border-emerald-200 shadow-xl space-y-4"
          >
            <h3 className="font-bold text-base text-emerald-950 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-700" /> New Credit Customer
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Full Name *</label>
                <input
                  type="text"
                  placeholder="Customer Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg text-xs"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Phone Number *</label>
                <input
                  type="text"
                  placeholder="0300-1234567"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">CNIC (Optional)</label>
                <input
                  type="text"
                  placeholder="35201-xxxxxxx-x"
                  value={newCnic}
                  onChange={(e) => setNewCnic(e.target.value)}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg text-xs font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-emerald-900 mb-1">Credit Limit (PKR)</label>
                <input
                  type="number"
                  value={newCreditLimit}
                  onChange={(e) => setNewCreditLimit(Number(e.target.value))}
                  className="w-full px-3 py-1.5 border border-emerald-300 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowNewCustModal(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                Create Khata
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
