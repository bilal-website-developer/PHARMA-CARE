import React, { useEffect, useMemo, useState } from 'react';
import { FlaskConical, LogOut, Plus, ShieldAlert } from 'lucide-react';
import { ROLE_LABELS, UserRole } from '../types/pharmacy';
import { SIDEBAR_CATEGORIES } from './sidebarPages';
import {
  addDemoPreviewRecord,
  createDemoPreviewState,
  getDemoAccountName,
  getDemoRolePages,
  isDemoPreviewPageKey,
  type DemoPreviewPageKey,
  type DemoPreviewState,
} from '../utils/demoPreview';
import PharmaLogo from './PharmaLogo';

interface DemoWorkspaceProps {
  role: UserRole;
  onSignOut: () => void;
}

export function DemoWorkspace({ role, onSignOut }: DemoWorkspaceProps) {
  const [activePage, setActivePage] = useState<DemoPreviewPageKey>('dashboard');
  const [previewState, setPreviewState] = useState<DemoPreviewState>(createDemoPreviewState);
  const [newEntry, setNewEntry] = useState('');
  const pages = useMemo(() => getDemoRolePages(role), [role]);
  const activePageDefinition = pages.find((page) => page.key === activePage);
  const visibleRecordCount = Object.values(previewState.records)
    .reduce((count, records) => count + (records?.length ?? 0), 0);
  const accountName = getDemoAccountName(role);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const addEntry = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newEntry.trim();
    if (!trimmed) return;
    setPreviewState((current) => addDemoPreviewRecord(current, activePage, trimmed));
    setNewEntry('');
  };

  return (
    <div className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-surface font-inter text-text">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border bg-white px-4 py-2.5 shadow-xs sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <PharmaLogo size={2.5} layout="inline" className="shrink-0" />
          <span className="hidden h-8 border-l border-border sm:block" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-text">Demo Pharmacy</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Isolated demo workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-bold text-text">{accountName}</p>
            <p className="text-[10px] font-semibold uppercase text-muted">{ROLE_LABELS[role]} · Demo account</p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2 rounded-control border border-border bg-white px-3 py-2 text-xs font-bold text-text hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogOut size={15} />
            <span>Sign out demo</span>
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-white lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 border-b border-border p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
              {accountName.charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-text">{accountName}</p>
              <p className="text-xs text-muted">{ROLE_LABELS[role]} sample permissions</p>
            </div>
          </div>

          <nav aria-label={`${ROLE_LABELS[role]} demo pages`} className="min-h-0 flex-1 overflow-y-auto p-3">
            {SIDEBAR_CATEGORIES.map((category) => {
              const categoryPages = pages.filter((page) => page.category === category);
              if (!categoryPages.length) return null;
              return (
                <section key={category} className="mb-4 last:mb-0">
                  <h2 className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted">{category}</h2>
                  <div className="space-y-1">
                    {categoryPages.map((page) => {
                      const Icon = page.icon;
                      return (
                        <button
                          key={page.key}
                          type="button"
                          aria-current={activePage === page.key ? 'page' : undefined}
                          onClick={() => {
                            if (isDemoPreviewPageKey(page.key)) setActivePage(page.key);
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-control px-3 py-2.5 text-left text-sm font-semibold transition ${
                            activePage === page.key ? 'bg-primary text-white' : 'text-text hover:bg-surface'
                          }`}
                        >
                          <Icon size={17} className="shrink-0" />
                          <span className="truncate">{page.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </nav>

          <div className="border-t border-border p-3">
            <div role="note" className="flex items-start gap-2 rounded-control bg-surface p-3 text-[11px] leading-relaxed text-muted">
              <FlaskConical size={15} className="mt-0.5 shrink-0 text-primary" />
              <p>{pages.length} pages are available in this role's sample access.</p>
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl space-y-5">
            <div role="note" className="flex items-start gap-3 rounded-control border border-warning/40 bg-warning/10 p-4 text-sm text-text">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
              <p>
                Demo mode is isolated: your Super Admin session stays active. This screen uses sample UI and in-memory data only; it does not sign in as a real user or run live shop workflows.
              </p>
            </div>

            <header>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Welcome back, {accountName}</p>
              <h1 className="mt-1 text-2xl font-black text-text">{activePageDefinition?.label ?? 'Dashboard'}</h1>
              <p className="mt-1 text-sm text-muted">Sample {ROLE_LABELS[role]} workspace · no real shop data is loaded</p>
            </header>

            <section aria-label="Demo account summary" className="grid gap-3 sm:grid-cols-3">
              <article className="rounded-card border border-border bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-muted">Demo account</p>
                <p className="mt-1 font-bold text-text">{ROLE_LABELS[role]}</p>
              </article>
              <article className="rounded-card border border-border bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-muted">Pages in sample role</p>
                <p className="mt-1 font-bold text-text">{pages.length}</p>
              </article>
              <article className="rounded-card border border-border bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-muted">Temporary sample entries</p>
                <p className="mt-1 font-bold text-text">{visibleRecordCount}</p>
              </article>
            </section>

            <section className="space-y-4 rounded-card border border-border bg-white p-5 shadow-sm">
              <div>
                <h2 className="font-bold text-text">Sample {activePageDefinition?.label.toLowerCase() ?? 'dashboard'} data</h2>
                <p className="mt-1 text-xs text-muted">Anything added here is removed when you sign out or refresh.</p>
              </div>

              <ul aria-live="polite" className="divide-y divide-border rounded-control border border-border">
                {(previewState.records[activePage] ?? []).map((record, index) => (
                  <li key={`${activePage}-${index}`} className="px-3 py-2.5 text-sm text-text">{record}</li>
                ))}
                {(previewState.records[activePage] ?? []).length === 0 && (
                  <li className="px-3 py-4 text-sm text-muted">No sample entries on this page yet.</li>
                )}
              </ul>

              <form onSubmit={addEntry} className="flex flex-wrap gap-2">
                <label htmlFor="demo-entry" className="sr-only">Temporary demo entry</label>
                <input
                  id="demo-entry"
                  value={newEntry}
                  onChange={(event) => setNewEntry(event.target.value)}
                  maxLength={100}
                  placeholder="Type a temporary sample entry"
                  className="min-w-[220px] flex-1 rounded-control border border-border px-3 py-2 text-sm"
                />
                <button type="submit" disabled={!newEntry.trim()} className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  <Plus size={15} /> Add sample entry
                </button>
              </form>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
