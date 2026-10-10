import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, Columns3, MoreHorizontal } from 'lucide-react';
import { getExpiryDisplay, getStockBarState, type ExpiryVariant } from './inventoryUiLogic';

const PANEL = 'rounded-xl border border-border bg-surface shadow-xs';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export function KpiCard({
  label,
  value,
  detail,
  icon,
  valueClassName = 'text-primary',
  compact = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  valueClassName?: string;
  compact?: boolean;
}) {
  const cardClassName = compact
    ? 'rounded-[14px] border border-border bg-surface p-3.5 shadow-[0_1px_8px_rgba(11,59,42,0.08)]'
    : `${PANEL} p-4`;
  return (
    <article className={`${cardClassName} min-w-0`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
        {icon && <span aria-hidden="true" className="shrink-0 text-primary">{icon}</span>}
      </div>
      <p className={`${compact ? 'my-1 text-[23px]' : 'mt-1 text-2xl'} font-black ${valueClassName}`}>{value}</p>
      {detail && <p className={compact ? 'text-[11px] text-muted' : 'mt-1 text-xs text-muted'}>{detail}</p>}
    </article>
  );
}

const STATUS_CLASSES = {
  ok: 'bg-emerald-100 text-emerald-800',
  green: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  amber: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  red: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
  blue: 'bg-blue-100 text-blue-800',
  neutral: 'bg-gray-100 text-gray-700',
} as const;

export type StatusVariant = keyof typeof STATUS_CLASSES;

export function StatusChip({ variant, children }: { variant: StatusVariant; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_CLASSES[variant]}`}>
      {children}
    </span>
  );
}

const STOCK_CLASSES = {
  out: 'bg-red-600',
  low: 'bg-amber-500',
  ok: 'bg-emerald-600',
} as const;

export function StockBar({ quantity, reorderLevel }: { quantity: number; reorderLevel: number }) {
  const state = getStockBarState(quantity, reorderLevel);
  const levelText = state.level === 'out' ? 'Out of stock' : state.level === 'low' ? 'Low stock' : 'Stock level OK';
  return (
    <div className="min-w-24 space-y-1">
      <div
        role="progressbar"
        aria-label={`${levelText}: ${quantity} in stock; reorder level ${reorderLevel}`}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, reorderLevel)}
        aria-valuenow={Math.min(quantity, Math.max(1, reorderLevel))}
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div className={`h-full rounded-full ${STOCK_CLASSES[state.level]}`} style={{ width: `${state.percentage}%` }} />
      </div>
      <span className="text-[11px] text-muted">{quantity.toLocaleString()} / {reorderLevel.toLocaleString()} reorder</span>
    </div>
  );
}

const EXPIRY_VARIANTS: Record<ExpiryVariant, StatusVariant> = {
  danger: 'danger',
  warning: 'warning',
  ok: 'ok',
  neutral: 'neutral',
};

export function ExpiryChip({
  expiryDate,
  quantity,
  today,
}: {
  expiryDate?: string | null;
  quantity: number;
  today?: Date;
}) {
  const display = getExpiryDisplay(expiryDate, quantity, today);
  return <StatusChip variant={EXPIRY_VARIANTS[display.variant]}>{display.label}</StatusChip>;
}

export function FilterChip({
  children,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text">
      {children}
      {onRemove && <button type="button" onClick={onRemove} aria-label={removeLabel ?? 'Remove filter'} className={`${FOCUS} rounded-full text-muted hover:text-text`}>×</button>}
    </span>
  );
}

export interface FilterOption<Value extends string = string> {
  label: string;
  value: Value;
}

export function FilterSelect<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly FilterOption<Value>[];
  onChange: (value: Value) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-semibold text-text">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          const selected = options.find((option) => option.value === event.target.value);
          if (selected) onChange(selected.value);
        }}
        className={`${FOCUS} rounded-control border border-border bg-surface px-3 py-2`}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function SegmentedTabs<Value extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: Value;
  tabs: readonly (FilterOption<Value> & { disabled?: boolean; panelId?: string })[];
  onChange: (value: Value) => void;
}) {
  const tabRefs = useRef(new Map<Value, HTMLButtonElement>());
  const selectAndFocus = (nextValue: Value) => {
    onChange(nextValue);
    tabRefs.current.get(nextValue)?.focus();
  };
  const activateRelative = (currentIndex: number, direction: -1 | 1) => {
    for (let step = 1; step <= tabs.length; step += 1) {
      const nextIndex = (currentIndex + direction * step + tabs.length) % tabs.length;
      if (!tabs[nextIndex].disabled) {
        selectAndFocus(tabs[nextIndex].value);
        return;
      }
    }
  };

  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-control border border-border bg-surface p-1">
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          ref={(element) => {
            if (element) tabRefs.current.set(tab.value, element);
            else tabRefs.current.delete(tab.value);
          }}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={tab.panelId}
          tabIndex={value === tab.value ? 0 : -1}
          disabled={tab.disabled}
          onClick={() => onChange(tab.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              activateRelative(index, 1);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              activateRelative(index, -1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              const first = tabs.find((item) => !item.disabled);
              if (first) selectAndFocus(first.value);
            } else if (event.key === 'End') {
              event.preventDefault();
              const last = [...tabs].reverse().find((item) => !item.disabled);
              if (last) selectAndFocus(last.value);
            }
          }}
          className={`${FOCUS} whitespace-nowrap rounded px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${value === tab.value ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  render: (row: Row) => ReactNode;
  sortable?: boolean;
  sortDirection?: 'ascending' | 'descending' | 'none';
  onSort?: () => void;
  hideable?: boolean;
  initiallyHidden?: boolean;
}

export interface DataTableAction<Row> {
  label: string;
  onSelect: (row: Row) => void;
  disabled?: (row: Row) => boolean;
}

export interface DataTablePagination {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  totalCount?: number;
}

function RowActions<Row>({ row, actions }: { row: Row; actions: readonly DataTableAction<Row>[] }) {
  if (!actions.length) return null;
  return (
    <details className="relative inline-block text-left">
      <summary aria-label="Row actions" className={`${FOCUS} flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-control border border-border text-muted hover:bg-surface`}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 min-w-40 rounded-control border border-border bg-surface p-1 shadow-lg">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled?.(row) ?? false}
            onClick={(event) => {
              action.onSelect(row);
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}
            className={`${FOCUS} block w-full rounded px-3 py-2 text-left text-sm text-text hover:bg-white/60 disabled:opacity-50`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export function DataTable<Row>({
  label,
  rows,
  columns,
  getRowId,
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'Try changing the filters or add a record.',
  pagination,
  selectedIds,
  onSelectionChange,
  actions = [],
  layout = 'responsive',
  hiddenColumnIds,
  onHiddenColumnIdsChange,
  compact = false,
}: {
  label: string;
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  getRowId: (row: Row) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  pagination?: DataTablePagination;
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  actions?: readonly DataTableAction<Row>[];
  layout?: 'responsive' | 'table' | 'cards';
  hiddenColumnIds?: readonly string[];
  onHiddenColumnIdsChange?: (ids: string[]) => void;
  compact?: boolean;
}) {
  const [internalHiddenColumns, setInternalHiddenColumns] = useState<Set<string>>(
    () => new Set(columns.filter((column) => column.initiallyHidden).map((column) => column.id)),
  );
  const hiddenColumns = new Set(hiddenColumnIds ?? internalHiddenColumns);
  const updateHiddenColumns = (update: (current: Set<string>) => Set<string>) => {
    const next = update(hiddenColumns);
    setInternalHiddenColumns(next);
    onHiddenColumnIdsChange?.([...next]);
  };
  const visibleColumns = columns.filter((column) => !hiddenColumns.has(column.id));
  const selectableIds = rows.map(getRowId);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds?.includes(id));
  const someSelected = selectableIds.some((id) => selectedIds?.includes(id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [allSelected, someSelected]);

  const toggleRow = (id: string, checked: boolean) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange([...next]);
  };
  const actionCell = (row: Row) => actions.length > 0 ? <RowActions row={row} actions={actions} /> : null;

  return (
    <section aria-label={label} className={`${compact ? 'rounded-[14px] border border-border bg-surface p-1.5 shadow-[0_1px_8px_rgba(11,59,42,0.08)]' : PANEL} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-sm font-bold text-text">{label}</p>
        <details className="relative">
          <summary className={`${FOCUS} flex cursor-pointer list-none items-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-semibold text-text`}>
            <Columns3 size={15} aria-hidden="true" /> Columns
          </summary>
          <fieldset className="absolute right-0 z-20 mt-1 min-w-48 space-y-2 rounded-control border border-border bg-surface p-3 shadow-lg">
            <legend className="px-1 text-xs font-bold text-muted">Visible columns</legend>
            {columns.filter((column) => column.hideable !== false).map((column) => (
              <label key={column.id} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={!hiddenColumns.has(column.id)}
                    onChange={(event) => updateHiddenColumns((previous) => {
                    const next = new Set(previous);
                    if (event.target.checked) next.delete(column.id);
                    else next.add(column.id);
                    return next;
                  })}
                  className="h-4 w-4 accent-green-700"
                />
                {column.header}
              </label>
            ))}
          </fieldset>
        </details>
      </div>

      {loading ? (
        <Skeleton label={`Loading ${label.toLowerCase()}`} lines={5} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className={`${layout === 'cards' ? 'hidden' : layout === 'table' ? 'block' : 'hidden sm:block'} max-h-[65vh] overflow-auto`}>
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface text-xs font-bold uppercase tracking-wide text-muted">
                <tr>
                  {onSelectionChange && (
                    <th scope="col" className={compact ? 'px-2.5 py-2' : 'px-4 py-3'}>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        aria-label={`Select all ${label}`}
                        checked={allSelected}
                        onChange={(event) => {
                          const selected = new Set(selectedIds);
                          selectableIds.forEach((id) => event.target.checked ? selected.add(id) : selected.delete(id));
                          onSelectionChange([...selected]);
                        }}
                        className="h-4 w-4 accent-green-700"
                      />
                    </th>
                  )}
                  {visibleColumns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={column.sortable ? column.sortDirection ?? 'none' : undefined}
                      className={`whitespace-nowrap ${compact ? 'px-2.5 py-2' : 'px-4 py-3'}`}
                    >
                      {column.sortable && column.onSort ? (
                        <button type="button" onClick={column.onSort} className={`${FOCUS} inline-flex items-center gap-1 rounded text-left`}>
                          {column.header}
                          {column.sortDirection && column.sortDirection !== 'none' && <ChevronUp aria-hidden="true" size={13} className={column.sortDirection === 'descending' ? 'rotate-180' : ''} />}
                        </button>
                      ) : column.header}
                    </th>
                  ))}
                  {actions.length > 0 && <th scope="col" className={`${compact ? 'px-2.5 py-2' : 'px-4 py-3'} text-right`}>Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const id = getRowId(row);
                  return (
                    <tr key={id} className="text-text hover:bg-white/40">
                      {onSelectionChange && (
                        <td className={compact ? 'px-2.5 py-2' : 'px-4 py-3'}>
                          <input type="checkbox" aria-label={`Select row ${id}`} checked={selectedIds?.includes(id) ?? false} onChange={(event) => toggleRow(id, event.target.checked)} className="h-4 w-4 accent-green-700" />
                        </td>
                      )}
                      {visibleColumns.map((column) => <td key={column.id} className={`${compact ? 'px-2.5 py-2' : 'px-4 py-3'} align-top`}>{column.render(row)}</td>)}
                      {actions.length > 0 && <td className={`${compact ? 'px-2.5 py-2' : 'px-4 py-3'} text-right`}>{actionCell(row)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={`${layout === 'table' ? 'hidden' : layout === 'cards' ? 'block' : 'space-y-3 p-3 sm:hidden'} ${layout === 'cards' ? 'space-y-3 p-3' : ''}`}>
            {rows.map((row) => {
              const id = getRowId(row);
              return (
                <article key={id} className="rounded-control border border-border bg-white/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    {onSelectionChange && <input type="checkbox" aria-label={`Select row ${id}`} checked={selectedIds?.includes(id) ?? false} onChange={(event) => toggleRow(id, event.target.checked)} className="mt-1 h-4 w-4 accent-green-700" />}
                    {actions.length > 0 && actionCell(row)}
                  </div>
                  <dl className="mt-2 space-y-2">
                    {visibleColumns.map((column) => (
                      <div key={column.id} className="grid grid-cols-[minmax(5rem,35%)_1fr] gap-3 border-t border-border/70 pt-2">
                        <dt className="text-xs font-bold text-muted">{column.header}</dt>
                        <dd className="min-w-0 break-words text-sm text-text">{column.render(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
        </>
      )}

      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted">
            Page {pagination.page} of {Math.max(1, pagination.pageCount)}
            {pagination.totalCount !== undefined && ` · ${pagination.totalCount.toLocaleString()} total`}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous page" disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(pagination.page - 1)} className={`${FOCUS} rounded-control border border-border p-2 text-text disabled:opacity-50`}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" aria-label="Next page" disabled={pagination.page >= pagination.pageCount} onClick={() => pagination.onPageChange(pagination.page + 1)} className={`${FOCUS} rounded-control border border-border p-2 text-text disabled:opacity-50`}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function BulkActionBar({
  selectedCount,
  actions,
  onClear,
}: {
  selectedCount: number;
  actions: readonly { label: string; onClick: () => void; disabled?: boolean; icon?: ReactNode }[];
  onClear?: () => void;
}) {
  if (selectedCount <= 0) return null;
  return (
    <div role="region" aria-label="Bulk actions" className={`${PANEL} sticky bottom-3 z-20 flex flex-wrap items-center gap-2 p-3 shadow-lg`}>
      <p className="mr-auto text-sm font-bold text-text">{selectedCount.toLocaleString()} selected</p>
      {actions.map((action) => (
        <button key={action.label} type="button" disabled={action.disabled} onClick={action.onClick} className={`${FOCUS} inline-flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-semibold text-text hover:bg-white/50 disabled:opacity-50`}>
          {action.icon}{action.label}
        </button>
      ))}
      {onClear && <button type="button" onClick={onClear} className={`${FOCUS} rounded-control px-3 py-2 text-sm font-semibold text-muted`}>Clear selection</button>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
      <p className="font-bold text-text">{title}</p>
      {description && <p className="max-w-lg text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ label = 'Loading', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="space-y-3 p-4">
      {Array.from({ length: Math.max(1, Math.floor(lines)) }, (_, index) => (
        <div key={index} className={`h-4 animate-pulse rounded bg-border ${index === 0 ? 'w-2/3' : 'w-full'}`} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current();
      if (event.key === 'Tab') {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description" className={`${PANEL} w-full max-w-md space-y-4 p-5 shadow-xl`}>
        <h2 id="confirm-dialog-title" className="text-lg font-black text-text">{title}</h2>
        <div id="confirm-dialog-description" className="text-sm text-muted">{description}</div>
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className={`${FOCUS} rounded-control border border-border px-4 py-2 text-sm font-bold text-text hover:bg-white/50`}>{cancelLabel}</button>
          <button ref={confirmRef} type="button" onClick={onConfirm} className={`${FOCUS} rounded-control px-4 py-2 text-sm font-bold text-white ${destructive ? 'bg-red-700 hover:bg-red-800' : 'bg-primary hover:opacity-90'}`}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
