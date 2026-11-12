import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { UserRole } from '../types/pharmacy';
import { invokeManageUsers } from './ManageUsersView';
import { supabase } from '../utils/supabase';
import { filterTrashBinEvents, parseTrashBinEvent, searchTrashBinEvents, TrashBinEvent, TrashFilter } from '../utils/trashBin';

const FILTERS: Array<{ value: TrashFilter; label: string }> = [
  { value: 'all', label: 'All activity' },
  { value: 'profile', label: 'Users' },
  { value: 'medicine', label: 'Products' },
  { value: 'supplier', label: 'Suppliers' },
  { value: 'purchase', label: 'Purchases' },
];

const ENTITY_LABELS: Record<TrashBinEvent['entity_type'], string> = {
  profile: 'User',
  medicine: 'Product',
  supplier: 'Supplier',
  purchase: 'Purchase',
};

const ACTION_LABELS: Record<TrashBinEvent['action'], string> = {
  deleted: 'Deleted',
  deactivated: 'Deactivated',
  voided: 'Voided',
  restored: 'Restored',
};

export function TrashBinView({ currentRole }: { currentRole: UserRole }) {
  const [events, setEvents] = useState<TrashBinEvent[]>([]);
  const [filter, setFilter] = useState<TrashFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setSelectedEventId('');
    setNotice(null);
    if (!supabase) {
      setNotice({ text: 'Supabase is not configured.', error: true });
      setLoading(false);
      return false;
    }
    try {
      const { data, error } = await supabase.rpc('trash_bin_events_list');
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) throw new Error('Trash Bin returned an invalid activity list.');
      setEvents(data.map(parseTrashBinEvent));
      setNotice(null);
      return true;
    } catch (caught) {
      setNotice({
        text: `Could not load Trash Bin activity: ${caught instanceof Error ? caught.message : 'Unexpected error.'}`,
        error: true,
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleEvents = useMemo(
    () => searchTrashBinEvents(filterTrashBinEvents(events, filter), search),
    [events, filter, search],
  );
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId);
  const selectableEventCount = visibleEvents.filter((event) => event.can_permanently_delete).length;

  const restore = async (event: TrashBinEvent) => {
    if (!event.can_restore || !supabase) return;
    setBusyId(event.id);
    setNotice(null);
    try {
      if (event.entity_type === 'profile') {
        const result = await invokeManageUsers<{ message: string }>({
          action: 'restore',
          id: event.entity_id,
        });
        setNotice({ text: result.message || `${event.display_name} restored.`, error: false });
      } else if (event.entity_type === 'medicine') {
        const { error } = await supabase.rpc('restore_trash_medicine', {
          p_medicine_id: event.entity_id,
        });
        if (error) throw new Error(error.message);
        setNotice({ text: `${event.display_name} restored.`, error: false });
      } else if (event.entity_type === 'supplier') {
        const { error } = await supabase.rpc('restore_trash_supplier', {
          p_supplier_id: event.entity_id,
        });
        if (error) throw new Error(error.message);
        setNotice({ text: `${event.display_name} restored.`, error: false });
      } else {
        return;
      }
      await refresh();
    } catch (caught) {
      setNotice({
        text: caught instanceof Error ? caught.message : 'Could not restore this item.',
        error: true,
      });
    } finally {
      setBusyId('');
    }
  };

  const permanentlyDeleteSelected = async () => {
    if (!selectedEvent?.can_permanently_delete || !supabase || busyId) return;
    const event = selectedEvent;
    if (!window.confirm(
      `Permanently delete "${event.display_name}"? This cannot be undone. Items with transaction history cannot be deleted.`,
    )) return;

    setBusyId(event.id);
    setNotice(null);
    try {
      if (event.entity_type === 'profile') {
        const result = await invokeManageUsers<{ message: string }>({
          action: 'permanently_delete',
          event_id: event.id,
        });
        if (await refresh()) {
          setNotice({ text: result.message || `${event.display_name} permanently deleted.`, error: false });
        }
      } else {
        const { error } = await supabase.rpc('trash_bin_permanently_delete', {
          p_event_id: event.id,
        });
        if (error) throw new Error(error.message);
        if (await refresh()) {
          setNotice({ text: `${event.display_name} permanently deleted.`, error: false });
        }
      }
    } catch (caught) {
      setNotice({
        text: caught instanceof Error ? caught.message : 'Could not permanently delete this item.',
        error: true,
      });
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="mx-auto max-w-6xl">
      <div className="overflow-hidden rounded-card border border-border bg-white shadow-sm">
        <header className="flex h-9 items-center gap-2 border-b border-border px-3">
          <span aria-hidden="true" className="h-3.5 w-3.5 rounded-[4px] bg-primary" />
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Trash Bin</h2>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <nav aria-label="Filter Trash Bin activity" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => {
                  setSelectedEventId('');
                  setFilter(item.value);
                }}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  filter === item.value
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-white text-text hover:bg-surface'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <label className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSelectedEventId('');
                  setSearch(event.target.value);
                }}
                aria-label="Search Trash Bin activity"
                placeholder="Search"
                className="h-8 w-32 rounded-control border border-border bg-white pl-8 pr-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/15 sm:w-36"
              />
            </label>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh Trash Bin activity"
              title="Refresh"
              className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-border text-text transition-colors hover:bg-surface disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <p className="text-xs text-muted">
            Select one row using the circle at its left, then permanently delete it. Purchases remain in audit history.
            {!loading && selectableEventCount === 0 && ' No visible items are currently eligible for permanent deletion.'}
          </p>
          <button
            type="button"
            disabled={!selectedEvent?.can_permanently_delete || busyId !== ''}
            onClick={() => void permanentlyDeleteSelected()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-danger px-3 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete permanently
          </button>
        </div>

        {notice && (
          <p role={notice.error ? 'alert' : 'status'} className={`border-b px-3 py-2 text-xs ${notice.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-primary/30 bg-primary/5 text-text'}`}>
            {notice.text}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] table-fixed text-left text-xs">
            <colgroup>
              <col className="w-[5%]" />
              <col className="w-[12%]" />
              <col className="w-[31%]" />
              <col className="w-[19%]" />
              <col className="w-[17%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead className="border-b border-border bg-surface text-[10px] font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-3 py-2">Select</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">Loading activity…</td></tr>
              ) : visibleEvents.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">No matching Trash Bin activity.</td></tr>
              ) : visibleEvents.map((event) => {
                const canRestore = event.can_restore
                  && (event.entity_type !== 'profile' || currentRole === UserRole.SUPER_ADMIN);
                return (
                  <tr
                    key={event.id}
                    className={`hover:bg-surface/60 ${selectedEventId === event.id ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="radio"
                        name="trash-bin-selection"
                        checked={selectedEventId === event.id}
                        onChange={() => setSelectedEventId(event.id)}
                        disabled={busyId !== '' || !event.can_permanently_delete}
                        aria-label={
                          event.can_permanently_delete
                            ? `Select ${ENTITY_LABELS[event.entity_type].toLowerCase()}: ${event.display_name} for permanent deletion`
                            : `${event.display_name} cannot be permanently deleted by this account`
                        }
                        title={
                          event.can_permanently_delete
                            ? `Select ${event.display_name}`
                            : 'This item is not eligible or you do not have permission to permanently delete it.'
                        }
                        className="h-4 w-4 accent-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                    <td className="truncate px-3 py-2">{ENTITY_LABELS[event.entity_type]}</td>
                    <td className="truncate px-3 py-2 font-medium text-text" title={event.display_name}>{event.display_name}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{ACTION_LABELS[event.action]}</span>
                        {canRestore && (
                          <button
                            type="button"
                            disabled={busyId !== ''}
                            onClick={() => void restore(event)}
                            aria-label={`Restore ${ENTITY_LABELS[event.entity_type].toLowerCase()}: ${event.display_name}`}
                            title={busyId === event.id ? 'Restoring…' : 'Restore'}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                          >
                            <RotateCcw className={`h-3.5 w-3.5 ${busyId === event.id ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="truncate px-3 py-2" title={event.actor_name}>{event.actor_name || 'Unknown user'}</td>
                    <td className="truncate px-3 py-2" title={new Date(event.created_at).toLocaleString()}>
                      {new Date(event.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">Purchase voids remain in the audit history and cannot be restored or permanently deleted. User deletion follows account-role restrictions. Search also checks the event reason.</p>
    </section>
  );
}
