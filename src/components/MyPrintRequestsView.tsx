import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, FileText, Filter, Printer, RefreshCw, XCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { parsePrintRequestRecord, PrintRequestRecord } from '../utils/printRequestTypes';

function statusClass(status: PrintRequestRecord['status']) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  if (status === 'rejected') return 'bg-rose-50 text-rose-700 border border-rose-200';
  return 'bg-amber-50 text-amber-700 border border-amber-200';
}

export function MyPrintRequestsView({ userId }: { userId: string }) {
  const [requests, setRequests] = useState<PrintRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusToast, setStatusToast] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const knownStatuses = useRef<Map<string, PrintRequestRecord['status']> | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await supabase
      .from('print_requests')
      .select('id,type,receipt_ref,payload,requested_by,requested_at,status,decided_by,decided_at,note,printed_at')
      .eq('requested_by', userId)
      .order('requested_at', { ascending: false })
      .limit(100);
    if (queryError) {
      setError(`Could not load print requests: ${queryError.message}`);
      setLoading(false);
      return;
    }

    try {
      const parsed = (data ?? []).map(parsePrintRequestRecord);
      const nextStatuses = new Map(parsed.map((request) => [request.id, request.status]));
      const previous = knownStatuses.current;
      if (previous) {
        const changed = parsed.find((request) => {
          const oldStatus = previous.get(request.id);
          return oldStatus !== undefined && oldStatus !== request.status;
        });
        if (changed) {
          setStatusToast(
            `Your ${changed.type} print request ${changed.receipt_ref} was ${changed.status}.${changed.note ? ` Admin note: ${changed.note}` : ''}`,
          );
        }
      }
      knownStatuses.current = nextStatuses;
      setRequests(parsed);
      setError('');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Could not parse print requests.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 20_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const counts = useMemo(() => {
    return {
      all: requests.length,
      pending: requests.filter((r) => r.status === 'pending').length,
      approved: requests.filter((r) => r.status === 'approved').length,
      rejected: requests.filter((r) => r.status === 'rejected').length,
    };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  return (
    <section className="space-y-3">
      {/* Slim Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-white px-4 py-2.5 shadow-xs">
        <div>
          <h2 className="text-base font-black text-text">My Print Requests</h2>
          <p className="text-xs text-muted">Approval status and supervisor notes for your reprint requests.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">Auto-refreshes 20s</span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text hover:bg-border/30 disabled:opacity-50"
            title="Refresh requests"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Filter Chips Row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-bold text-muted uppercase tracking-wider">
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

      {statusToast && (
        <p role="status" className="visual-toast rounded-control border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-text">
          {statusToast}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {/* Dense Table */}
      <div className="overflow-x-auto rounded-card border border-border bg-white shadow-xs">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="border-b border-border bg-surface text-[10px] font-bold uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Receipt</th>
              <th className="px-4 py-2">Requested</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Admin Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && requests.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                    <span>Loading requests…</span>
                  </div>
                </td>
              </tr>
            ) : filteredRequests.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <div className="mx-auto flex max-w-xs flex-col items-center text-muted">
                    <div className="mb-2 rounded-full bg-surface p-3 border border-border">
                      <FileText className="h-6 w-6 text-muted" />
                    </div>
                    <p className="text-xs font-bold text-text">No print requests found</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {statusFilter !== 'all'
                        ? `No requests matching status "${statusFilter}".`
                        : 'You haven’t submitted any receipt print requests yet.'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredRequests.map((request) => (
                <tr key={request.id} className="hover:bg-surface/50 transition-colors">
                  <td className="px-4 py-2.5 capitalize font-medium text-text">
                    <span className="inline-flex items-center gap-1.5">
                      <Printer className="h-3.5 w-3.5 text-muted" />
                      {request.type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono font-bold text-text">{request.receipt_ref}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {new Date(request.requested_at).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${statusClass(request.status)}`}>
                      {request.status === 'approved' && <CheckCircle2 className="h-2.5 w-2.5" />}
                      {request.status === 'pending' && <Clock className="h-2.5 w-2.5" />}
                      {request.status === 'rejected' && <XCircle className="h-2.5 w-2.5" />}
                      {request.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {request.note ? (
                      <span className="italic text-text">{request.note}</span>
                    ) : (
                      <span className="text-border">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
