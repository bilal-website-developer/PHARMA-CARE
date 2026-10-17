import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Minus,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { parsePrintSnapshot, PrintSnapshot } from '../utils/printSnapshot';
import { parsePrintRequestRecord, PrintRequestRecord } from '../utils/printRequestTypes';
import { PrintReceiptHandler } from '../utils/printWorkflow';
import { EditableReceiptLine, recalculateEditableReceipt } from '../utils/printRequestEditor';

function statusBadge(status: PrintRequestRecord['status']) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
        <CheckCircle2 className="h-2.5 w-2.5" />
        Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
        <XCircle className="h-2.5 w-2.5" />
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
      <Clock className="h-2.5 w-2.5" />
      Pending
    </span>
  );
}

export function PrintRequestsAdminView({ onPrintReceipt }: { onPrintReceipt: PrintReceiptHandler }) {
  const [requests, setRequests] = useState<PrintRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Receipt modification modal state
  const [editingRequest, setEditingRequest] = useState<PrintRequestRecord | null>(null);
  const [draftLines, setDraftLines] = useState<EditableReceiptLine[]>([]);
  const [draftDiscount, setDraftDiscount] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [editError, setEditError] = useState('');

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
      if (!Array.isArray(data)) throw new Error('The print-request list response is invalid.');
      const parsed = data.map(parsePrintRequestRecord);
      const requesterIds = [...new Set(parsed.map((request) => request.requested_by))];
      let profileWarning: string | null = null;
      if (requesterIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id,full_name,username,email')
          .in('id', requesterIds);
        if (profileError) {
          profileWarning = `Could not load requester names: ${profileError.message}`;
        } else {
          const names = new Map(
            (profiles ?? []).map((profile) => [
              profile.id,
              profile.username || profile.full_name || profile.email || 'Unknown user',
            ])
          );
          parsed.forEach((request) => {
            request.requester_name = names.get(request.requested_by) || 'Unknown user';
          });
        }
      }
      setRequests(parsed);
      setNotice(profileWarning ? { text: profileWarning, error: true } : null);
    } catch (parseError) {
      setNotice({
        text: parseError instanceof Error ? parseError.message : 'Could not parse print requests.',
        error: true,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const editPreview = useMemo((): { snapshot: PrintSnapshot | null; error: string } | null => {
    if (!editingRequest) return null;
    const discountMatch = /^\d*(?:\.\d{0,2})?$/.test(draftDiscount);
    if (!discountMatch) return { snapshot: null, error: 'Enter a valid discount amount.' };
    const discountPaisa = Math.round(Number(draftDiscount || '0') * 100);
    try {
      return {
        snapshot: recalculateEditableReceipt(
          parsePrintSnapshot(editingRequest.payload),
          draftLines,
          discountPaisa
        ),
        error: '',
      };
    } catch (error) {
      return {
        snapshot: null,
        error: error instanceof Error ? error.message : 'The edited receipt is invalid.',
      };
    }
  }, [draftDiscount, draftLines, editingRequest]);

  const beginEdit = (request: PrintRequestRecord) => {
    try {
      const snapshot = parsePrintSnapshot(request.payload);
      if (request.type !== 'sale' || snapshot.data.kind !== 'SALE') {
        throw new Error('Only sale receipts can be modified.');
      }
      setEditingRequest(request);
      setDraftLines(snapshot.data.lines.map((line) => ({ ...line })));
      setDraftDiscount((snapshot.data.discountPaisa / 100).toFixed(2));
      setNewItemName('');
      setNewItemPrice('');
      setEditError('');
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'Could not open the receipt editor.',
        error: true,
      });
    }
  };

  const saveEdit = async () => {
    if (!editingRequest || !editPreview?.snapshot) {
      setEditError(editPreview?.error || 'Correct the receipt details before saving.');
      return;
    }
    if (!supabase) {
      setEditError('Supabase is not configured.');
      return;
    }
    setBusyId(editingRequest.id);
    setEditError('');
    try {
      const { data, error } = await supabase.rpc('modify_print_request', {
        p_request_id: editingRequest.id,
        p_lines: editPreview.snapshot.data.lines,
        p_discount_paisa: editPreview.snapshot.data.discountPaisa,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== 'object' || data === null || !('payload' in data)) {
        throw new Error('The server did not return the updated receipt snapshot.');
      }
      const updatedSnapshot = parsePrintSnapshot(data.payload);
      setRequests((current) =>
        current.map((request) =>
          request.id === editingRequest.id ? { ...request, payload: updatedSnapshot } : request
        )
      );
      setEditingRequest(null);
      setNotice({ text: 'Receipt request updated. The completed sale was not changed.', error: false });
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Could not save the receipt changes.');
    } finally {
      setBusyId('');
    }
  };

  const addItem = () => {
    const name = newItemName.trim();
    if (!name || !/^\d+(?:\.\d{0,2})?$/.test(newItemPrice)) {
      setEditError('Enter an item name and a valid price.');
      return;
    }
    const ratePaisa = Math.round(Number(newItemPrice) * 100);
    if (!Number.isSafeInteger(ratePaisa)) {
      setEditError('Item price is too large.');
      return;
    }
    setDraftLines((current) => [...current, { qty: 1, name, ratePaisa }]);
    setNewItemName('');
    setNewItemPrice('');
    setEditError('');
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 20_000);
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
        text:
          decision === 'approved'
            ? `Request ${request.receipt_ref} approved & sent to print.`
            : `Request ${request.receipt_ref} rejected.`,
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
      setNotice({ text: `Receipt ${request.receipt_ref} sent to print dialog again.`, error: false });
      await refresh();
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'Could not print this receipt again.',
        error: true,
      });
    } finally {
      setBusyId('');
    }
  };

  // Filtered list
  const filteredRequests = useMemo(() => {
    let result = requests;
    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.receipt_ref.toLowerCase().includes(q) ||
          r.requester_name?.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q) ||
          r.note?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [requests, statusFilter, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: requests.length,
      pending: requests.filter((r) => r.status === 'pending').length,
      approved: requests.filter((r) => r.status === 'approved').length,
      rejected: requests.filter((r) => r.status === 'rejected').length,
    };
  }, [requests]);

  // Bulk actions handlers
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRequests.length && filteredRequests.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRequests.map((r) => r.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleBulkApprove = async () => {
    const targets = requests.filter((r) => selectedIds.has(r.id) && r.status === 'pending');
    if (targets.length === 0) {
      setNotice({ text: 'None of the selected requests are in pending status.', error: true });
      return;
    }
    setBulkBusy(true);
    let successCount = 0;
    for (const req of targets) {
      try {
        await decide(req, 'approved', null);
        successCount++;
      } catch {
        // continue
      }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    setNotice({
      text: `Bulk approved ${successCount} of ${targets.length} pending requests.`,
      error: false,
    });
  };

  const handleBulkReject = async () => {
    const targets = requests.filter((r) => selectedIds.has(r.id) && r.status === 'pending');
    if (targets.length === 0) {
      setNotice({ text: 'None of the selected requests are in pending status.', error: true });
      return;
    }
    const note = window.prompt(`Optional note for rejecting ${targets.length} requests:`);
    if (note === null) return;
    setBulkBusy(true);
    let successCount = 0;
    for (const req of targets) {
      try {
        await decide(req, 'rejected', note.trim() || null);
        successCount++;
      } catch {
        // continue
      }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    setNotice({
      text: `Bulk rejected ${successCount} of ${targets.length} requests.`,
      error: false,
    });
  };

  return (
    <section className="space-y-3">
      {/* Slim Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-white px-4 py-2.5 shadow-xs">
        <div>
          <h2 className="text-base font-black text-text">Print Requests Admin</h2>
          <p className="text-xs text-muted">
            Approve or reject reprint requests. Approved requests can be reprinted anytime.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">Auto-refreshes 20s</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text hover:bg-border/30 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Filter Chips & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            <Filter className="h-3 w-3" /> Status:
          </span>
          {(
            [
              { key: 'all', label: 'All', count: counts.all },
              { key: 'pending', label: 'Pending', count: counts.pending },
              { key: 'approved', label: 'Approved', count: counts.approved },
              { key: 'rejected', label: 'Rejected', count: counts.rejected },
            ] as const
          ).map((chip) => {
            const isActive = statusFilter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setStatusFilter(chip.key)}
                className={`inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-primary text-white shadow-xs'
                    : 'border border-border bg-white text-muted hover:bg-surface hover:text-text'
                }`}
              >
                <span>{chip.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isActive ? 'bg-white/25 text-white' : 'bg-surface text-muted'
                  }`}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search receipt, requester, note…"
            className="h-8 w-full rounded-control border border-border bg-white pl-8 pr-3 text-xs text-text placeholder:text-muted focus:border-primary focus:outline-hidden"
          />
        </div>
      </div>

      {/* Bulk Action Bar when items selected */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-text shadow-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary">{selectedIds.size} selected</span>
            <span className="text-muted">|</span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="font-medium text-muted hover:text-text underline"
            >
              Clear selection
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleBulkApprove()}
              className="inline-flex items-center gap-1 rounded-control bg-primary px-2.5 py-1 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Bulk Approve & Print</span>
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleBulkReject()}
              className="inline-flex items-center gap-1 rounded-control border border-rose-300 bg-white px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              <span>Bulk Reject</span>
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={`visual-toast rounded-control border px-3 py-2 text-xs ${
            notice.error
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* Dense Table */}
      <div className="overflow-x-auto rounded-card border border-border bg-white shadow-xs">
        <table className="w-full min-w-[850px] text-left text-xs">
          <thead className="border-b border-border bg-surface text-[10px] font-bold uppercase tracking-wider text-muted">
            <tr>
              <th className="w-8 px-3 py-2 text-center">
                <input
                  type="checkbox"
                  aria-label="Select all requests"
                  checked={
                    filteredRequests.length > 0 && selectedIds.size === filteredRequests.length
                  }
                  onChange={toggleSelectAll}
                  className="rounded-xs border-border"
                />
              </th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Receipt</th>
              <th className="px-3 py-2">Requester</th>
              <th className="px-3 py-2">Requested</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && requests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                    <span>Loading requests…</span>
                  </div>
                </td>
              </tr>
            ) : filteredRequests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <div className="mx-auto flex max-w-xs flex-col items-center text-muted">
                    <div className="mb-2 rounded-full border border-border bg-surface p-3">
                      <FileText className="h-6 w-6 text-muted" />
                    </div>
                    <p className="text-xs font-bold text-text">No print requests found</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {searchQuery
                        ? `No requests matching "${searchQuery}".`
                        : statusFilter !== 'all'
                        ? `No requests with status "${statusFilter}".`
                        : 'No cashier print requests have been recorded yet.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredRequests.map((request) => {
                const isSelected = selectedIds.has(request.id);
                return (
                  <tr
                    key={request.id}
                    className={`transition-colors hover:bg-surface/50 ${
                      isSelected ? 'bg-primary/5' : ''
                    }`}
                  >
                    <td className="w-8 px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select request ${request.receipt_ref}`}
                        checked={isSelected}
                        onChange={() => toggleSelectOne(request.id)}
                        className="rounded-xs border-border"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium capitalize text-text">
                      <span className="inline-flex items-center gap-1.5">
                        <Printer className="h-3.5 w-3.5 text-muted" />
                        {request.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-text">{request.receipt_ref}</td>
                    <td className="px-3 py-2 text-text font-medium">{request.requester_name || 'Unknown'}</td>
                    <td className="px-3 py-2 text-muted">
                      {new Date(request.requested_at).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2">{statusBadge(request.status)}</td>
                    <td className="max-w-48 truncate px-3 py-2 text-muted" title={request.note || ''}>
                      {request.note || <span className="text-border">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {request.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              disabled={busyId === request.id || bulkBusy}
                              onClick={() => approve(request)}
                              className="inline-flex items-center gap-1 rounded-control bg-primary px-2 py-1 text-[11px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
                            >
                              <Printer className="h-3 w-3" />
                              <span>Approve</span>
                            </button>
                            {request.type === 'sale' && (
                              <button
                                type="button"
                                disabled={busyId === request.id || bulkBusy}
                                onClick={() => beginEdit(request)}
                                className="inline-flex items-center gap-1 rounded-control border border-primary/30 px-2 py-1 text-[11px] font-bold text-primary hover:bg-surface disabled:opacity-50"
                              >
                                <Pencil className="h-3 w-3" />
                                <span>Modify</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busyId === request.id || bulkBusy}
                              onClick={() => reject(request)}
                              className="inline-flex items-center gap-1 rounded-control border border-red-200 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              <XCircle className="h-3 w-3" />
                              <span>Reject</span>
                            </button>
                          </>
                        )}
                        {request.status === 'approved' && (
                          <button
                            type="button"
                            disabled={busyId === request.id || bulkBusy}
                            onClick={() => void printAgain(request)}
                            className="inline-flex items-center gap-1 rounded-control border border-primary/30 px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-primary/5 disabled:opacity-50"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Print again</span>
                          </button>
                        )}
                        {request.status === 'rejected' && (
                          <span className="text-[11px] italic text-muted">Rejected</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modify receipt request dialog */}
      {editingRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="modify-print-request-title"
            className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-card border border-border bg-white p-4 shadow-xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-border pb-2.5">
              <div>
                <h3 id="modify-print-request-title" className="text-base font-black text-text">
                  Modify Receipt Request
                </h3>
                <p className="text-xs text-muted">
                  {editingRequest.receipt_ref} · Modifies printed receipt copy only, not the completed sale record.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close editor"
                onClick={() => setEditingRequest(null)}
                className="rounded-control p-1 text-muted hover:bg-surface"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {draftLines.map((line, index) => (
                <div
                  key={`${line.name}-${index}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-control border border-border bg-surface/30 p-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-text">{line.name}</p>
                    <p className="text-[11px] text-muted">Rs. {(line.ratePaisa / 100).toFixed(2)} each</p>
                  </div>
                  <div className="inline-flex items-center rounded-control border border-border bg-white">
                    <button
                      type="button"
                      aria-label={`Decrease ${line.name} quantity`}
                      onClick={() =>
                        setDraftLines((current) =>
                          current.flatMap((item, itemIndex) =>
                            itemIndex !== index ? [item] : item.qty <= 1 ? [] : [{ ...item, qty: item.qty - 1 }]
                          )
                        )
                      }
                      className="p-1 text-muted hover:bg-surface"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="min-w-6 text-center font-bold text-xs">{line.qty}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${line.name} quantity`}
                      onClick={() =>
                        setDraftLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, qty: item.qty + 1 } : item
                          )
                        )
                      }
                      className="p-1 text-muted hover:bg-surface"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <strong className="min-w-16 text-right font-mono text-xs">
                    Rs. {((line.qty * line.ratePaisa) / 100).toFixed(2)}
                  </strong>
                  <button
                    type="button"
                    aria-label={`Remove ${line.name}`}
                    onClick={() =>
                      setDraftLines((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                    className="p-1 text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <form
              className="grid grid-cols-[minmax(0,1fr)_8rem_auto] gap-2 pt-1"
              onSubmit={(event) => {
                event.preventDefault();
                addItem();
              }}
            >
              <input
                aria-label="New item name"
                value={newItemName}
                onChange={(event) => setNewItemName(event.target.value)}
                placeholder="Add product name…"
                className="h-8 min-w-0 rounded-control border border-border px-2.5 text-xs text-text placeholder:text-muted"
              />
              <input
                aria-label="New item price"
                inputMode="decimal"
                value={newItemPrice}
                onChange={(event) => setNewItemPrice(event.target.value)}
                placeholder="Price (Rs.)"
                className="h-8 rounded-control border border-border px-2.5 text-xs text-text placeholder:text-muted"
              />
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1 rounded-control border border-primary/30 px-2.5 text-xs font-bold text-primary hover:bg-primary/5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2.5 text-xs">
              <label className="flex items-center gap-2 font-semibold text-text">
                Discount (Rs.)
                <input
                  aria-label="Receipt discount in rupees"
                  inputMode="decimal"
                  value={draftDiscount}
                  onChange={(event) => {
                    setDraftDiscount(event.target.value);
                    setEditError('');
                  }}
                  className="h-7 w-24 rounded-control border border-border px-2 font-mono text-xs"
                />
              </label>
              <p className="font-bold text-text">
                Updated Total:{' '}
                {editPreview?.snapshot
                  ? `Rs. ${(
                      (editPreview.snapshot.data.lines.reduce(
                        (sum, line) => sum + line.qty * line.ratePaisa,
                        0
                      ) -
                        editPreview.snapshot.data.discountPaisa +
                        (editPreview.snapshot.data.salesTaxPaisa ?? 0) +
                        (editPreview.snapshot.data.roundingPaisa ?? 0)) /
                      100
                    ).toFixed(2)}`
                  : '—'}
              </p>
            </div>

            {editError && (
              <p role="alert" className="rounded-control border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                {editError}
              </p>
            )}
            {editPreview?.error && (
              <p role="alert" className="text-xs text-red-700">
                {editPreview.error}
              </p>
            )}

            <footer className="flex justify-end gap-2 border-t border-border pt-2.5">
              <button
                type="button"
                onClick={() => setEditingRequest(null)}
                className="rounded-control border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyId === editingRequest.id || !editPreview?.snapshot}
                onClick={() => void saveEdit()}
                className="rounded-control bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {busyId === editingRequest.id ? 'Saving…' : 'Save Changes'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
