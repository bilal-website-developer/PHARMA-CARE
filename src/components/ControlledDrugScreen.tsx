import React, { useState } from 'react';
import {
  ShieldAlert,
  Search,
  FileCheck,
  Calendar,
  AlertCircle,
  Download,
  Filter,
  UserCheck,
} from 'lucide-react';
import { ControlledDrugLog, DrugClass } from '../types/pharmacy';

interface ControlledDrugScreenProps {
  logs: ControlledDrugLog[];
}

export const ControlledDrugScreen: React.FC<ControlledDrugScreenProps> = ({ logs }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDrugClass, setSelectedDrugClass] = useState<string>('ALL');

  const filteredLogs = logs.filter((log) => {
    const matchSearch =
      log.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.patientCnic.includes(searchQuery) ||
      log.doctorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchClass = selectedDrugClass === 'ALL' || log.drugClass === selectedDrugClass;
    return matchSearch && matchClass;
  });

  return (
    <div className="space-y-5">
      {/* ── Regulatory Information Banner ──────────────────────────────────── */}
      <div className="bg-red-50 border border-red-200/80 p-5 rounded-xl shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-red-100 text-red-800 rounded-xl shrink-0 mt-0.5">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-200 text-red-900 font-bold text-[10px] rounded uppercase">
                  DRAP Form 7 Register
                </span>
                <span className="text-xs text-red-800 font-semibold">
                  Drug Act 1976 / DRAP Rules 2014
                </span>
              </div>
              <h2 className="text-lg font-bold text-red-950 mt-0.5">
                Controlled Drugs & Narcotics Register
              </h2>
              <p className="text-xs text-red-800/90 mt-1 max-w-2xl leading-relaxed">
                Mandatory statutory audit trail for Schedule G psychoactive drugs (Bromazepam, Clonazepam, Alprazolam) and Form 7 narcotics. Every transaction records patient CNIC, prescribing PMDC doctor, and running tablet balance.
              </p>
            </div>
          </div>

          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 text-xs font-bold text-red-900 bg-red-100 hover:bg-red-200 border border-red-300 rounded-lg flex items-center gap-1.5 transition shrink-0"
          >
            <Download className="w-4 h-4" /> Export Statutory Register
          </button>
        </div>
      </div>

      {/* ── Search & Filter ────────────────────────────────────────────────── */}
      <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-emerald-700 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by Patient Name, CNIC, Doctor PMDC # or Invoice..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600 font-medium"
          />
        </div>

        <select
          value={selectedDrugClass}
          onChange={(e) => setSelectedDrugClass(e.target.value)}
          className="px-3 py-2 text-xs border border-emerald-300 rounded-lg focus:outline-emerald-600 bg-white"
        >
          <option value="ALL">All Classifications</option>
          <option value={DrugClass.CONTROLLED}>Controlled Substances (Sched G)</option>
          <option value={DrugClass.NARCOTIC}>Narcotics (Schedule D / Form 7)</option>
        </select>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-800 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-3">Date & Time</th>
                <th className="py-3 px-3">Medicine & Batch</th>
                <th className="py-3 px-3">Drug Class</th>
                <th className="py-3 px-3">Patient Details</th>
                <th className="py-3 px-3">Doctor & PMDC #</th>
                <th className="py-3 px-3 text-center">Qty Dispensed</th>
                <th className="py-3 px-3 text-center">Remaining Balance</th>
                <th className="py-3 px-3">Invoice & Dispenser</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-900">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70 transition">
                  <td className="py-3 px-3 font-mono text-[11px] text-slate-600">{log.date}</td>
                  <td className="py-3 px-3">
                    <div className="font-bold text-slate-900">{log.productName}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Batch: {log.batchNumber}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        log.drugClass === DrugClass.NARCOTIC
                          ? 'bg-red-100 text-red-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}
                    >
                      {log.drugClass}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-semibold text-slate-900">{log.patientName}</div>
                    <div className="text-[10px] text-slate-600 font-mono">{log.patientCnic}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-medium text-slate-800">{log.doctorName}</div>
                    <div className="text-[10px] text-emerald-700 font-mono font-semibold">
                      {log.doctorRegNo}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center font-mono font-bold text-red-700">
                    -{log.quantitySmallestUnits} tabs
                  </td>
                  <td className="py-3 px-3 text-center font-mono font-bold text-slate-800">
                    {log.balanceAfter} tabs
                  </td>
                  <td className="py-3 px-3 text-[11px]">
                    <div className="font-mono text-emerald-800 font-semibold">
                      {log.invoiceNumber}
                    </div>
                    <div className="text-[10px] text-slate-500">{log.dispensedBy}</div>
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-xs text-slate-400">
                    No controlled drug records match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
