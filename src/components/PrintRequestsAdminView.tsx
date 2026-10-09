import React, { useCallback, useEffect, useState } from 'react';
import { Printer, RotateCcw, XCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { parsePrintSnapshot } from '../utils/printSnapshot';
import { parsePrintRequestRecord, PrintRequestRecord } from '../utils/printRequestTypes';
import { PrintReceiptHandler } from '../utils/printWorkflow';

function statusClass(status: PrintRequestRecord['status']) {
  if (status === 'approved') return 'bg-green-100 text-green-800';
  if (status === 'rejected') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-800';
}

export function PrintRequestsAdminView({ onPrintReceipt }: { onPrintReceipt: PrintReceiptHandler }) {
  const [requests, setRequests] = useState<PrintRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setNotice({ text: 'Supabase is not configured.', error: true });
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('print_requests')
      .select('id,type,receipt_ref,payload,requested_by,requested_at,status,decided_by,decided_at,note,printed_at')
      .order('requested_at', { ascending: false })
      .limit(200);
    if (error) {
      setNotice({ text: `Could not load print requests: ${error.message}`, error: true });
      setLoading(false);
      return;
    }
    try {
      setRequests((data ?? []).map(parsePrintRequestRecord));
      setNotice(null);
    } catch (parseError) {
      setNotice({ text: parseError instanceof Error ? parseError.message : 'Could not parse print requests.', error: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 20_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const decide = async (request: PrintRequestRecord, decision: 'approved' | 'rejected', note: string | null) => {
    if (!supabase) return setNotice({ text: 'Supabase is not configured.', error: true });
    setBusyId(request.id);
    setNotice(null);
    try {
      const { data, error } = await supabase.rpc('decide_print_request', {
        p_request_id: request.id,
        p_decision: decision,
        p_note: note,
      });
      if (error) throw new Error(error.message);
      if (decision === 'approved') {
        if (typeof data !== 'object' || data === null || !('payload' in data)) {
          throw new Error('Approval succeeded but no receipt snapshot was returned.');
        }
        const snapshot = parsePrintSnapshot(data.payload);
        await onPrintReceipt(request.type, snapshot, { approvedRequestId: request.id });
      }
      setNotice({
        text: decision === 'approved' ? 'Request approved. The receipt was sent to this computer’s print dialog.' : 'Request rejected.',
        error: false,
      });
      await refresh();
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'Could not decide or print this request.',
        error: true,
      });
      await refresh();
    } finally {
      setBusyId('');
    }
  };

  const approve = (request: PrintRequestRecord) => {
    void decide(request, 'approved', null);
  };

  const reject = (request: PrintRequestRecord) => {
    const note = window.prompt('Optional note for the requester:');
    if (note === null) return;
    void decide(request, 'rejected', note.trim() || null);
  };

  const printAgain = async (request: PrintRequestRecord) => {
    setBusyId(request.id);
    setNotice(null);
    try {
      const snapshot = parsePrintSnapshot(request.payload);
      await onPrintReceipt(request.type, snapshot, { approvedRequestId: request.id });
      setNotice({ text: 'Receipt sent to this computer’s print dialog again.', error: false });
      await refresh();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not print this receipt again.', error: true });
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="mx-auto max-w-6xl space-y-4">
      <header className="rounded-card border border-border bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black text-text">Print Requests</h2>
        <p className="mt-1 text-sm text-muted">Approve or reject receipt requests. Approved requests remain available to print again.</p>
      </header>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={`visual-toast rounded-control border px-4 py-3 text-sm ${notice.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>{notice.text}</p>}
      <div className="overflow-x-auto rounded-card border border-border bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border bg-surface text-[11px] font-bold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Receipt</th>
              <th className="px-5 py-3">Requester</th>
              <th className="px-5 py-3">Requested</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Note</th>
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">Loading requests…</td></tr>
              : requests.length === 0 ? <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">No print requests.</td></tr>
                : requests.map((request) => (
                  <tr key={request.id}>
                    <td className="px-5 py-4 capitalize">{request.type}</td>
                    <td className="px-5 py-4 font-mono">{request.receipt_ref}</td>
                    <td className="px-5 py-4 font-mono text-xs">{request.requested_by}</td>
                    <td className="px-5 py-4">{new Date(request.requested_at).toLocaleString()}</td>
                    <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusClass(request.status)}`}>{request.status}</span></td>
                    <td className="max-w-56 px-5 py-4 text-muted">{request.note || '—'}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex gap-2">
                        {request.status === 'pending' && <>
                          <button type="button" disabled={busyId === request.id} onClick={() => approve(request)} className="inline-flex items-center gap-1 rounded-control bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Printer className="h-3.5 w-3.5" />Approve and print</button>
                          <button type="button" disabled={busyId === request.id} onClick={() => reject(request)} className="inline-flex items-center gap-1 rounded-control border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50"><XCircle className="h-3.5 w-3.5" />Reject</button>
                        </>}
                        {request.status === 'approved' && <button type="button" disabled={busyId === request.id} onClick={() => void printAgain(request)} className="inline-flex items-center gap-1 rounded-control border border-primary/30 px-3 py-2 text-xs font-bold text-primary disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Print again</button>}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Requests refresh every 20 seconds. A cancelled print dialog leaves the request approved.</p>
    </section>
  );
}
