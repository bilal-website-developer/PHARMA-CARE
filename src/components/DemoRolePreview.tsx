import React from 'react';
import { ArrowRight, FlaskConical, ShieldAlert } from 'lucide-react';
import { ROLE_LABELS, UserRole } from '../types/pharmacy';
import { DEMO_PREVIEW_ROLES, getDemoRolePages } from '../utils/demoPreview';

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Platform administration and shop management',
  [UserRole.ADMIN]: 'Shop operations, reports, and staff management',
  [UserRole.MANAGER]: 'Inventory, purchasing, and daily operations',
  [UserRole.CASHIER]: 'Point of sale, customers, and sales history',
  [UserRole.ACCOUNTANT]: 'Sales, purchase history, expenses, and reports',
};

interface DemoRolePreviewProps {
  onOpenDemo?: (role: UserRole) => void;
  onOpenDemoAccount?: (role: UserRole) => void;
  savedDemoAccount?: { role: UserRole; email: string };
  notice?: string;
  onSignOut?: () => void;
}

const DEMO_ACCOUNT_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.ACCOUNTANT,
];

export function DemoRolePreview({
  onOpenDemo,
  onOpenDemoAccount,
  savedDemoAccount,
  notice,
  onSignOut,
}: DemoRolePreviewProps) {
  const visibleRoles = onOpenDemo ? DEMO_PREVIEW_ROLES : DEMO_ACCOUNT_ROLES;

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <header className="rounded-card border border-border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-control bg-primary/10 text-primary">
            <FlaskConical size={22} />
          </span>
          <div>
            <h2 className="text-xl font-black text-text">Role Demo</h2>
            <p className="mt-1 text-sm text-muted">
              {onOpenDemo
                ? 'Sign in to the dedicated demo shop or try the separate local sample workspace.'
                : 'Continue to your saved demo-shop account or sign in with another demo role.'}
            </p>
          </div>
          </div>
          {onSignOut && <button
            type="button"
            onClick={onSignOut}
            className="shrink-0 rounded-control border border-border px-3 py-2 text-xs font-bold text-text hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign out completely
          </button>}
        </div>
      </header>

      <div role="note" className="flex items-start gap-3 rounded-control border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
        <p>
          Demo account cards use real Supabase sign-in for your dedicated demo shop. This browser remembers the active authenticated session, not your password; use “Return to Demo Hub” to leave an account without signing out. Only one Supabase account can be active at a time, and permissions always come from its signed-in profile. The local sample workspace remains separate and never writes to Supabase.
        </p>
      </div>
      {notice && <p role="status" className="rounded-control border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text">{notice}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleRoles.map((role) => {
          const pageCount = getDemoRolePages(role).length;
          return (
            <article key={role} className="rounded-card border border-border bg-white p-5 shadow-sm">
              <h3 className="text-base font-bold text-text">Demo {ROLE_LABELS[role]}</h3>
              <p className="mt-1 text-sm text-muted">{ROLE_DESCRIPTIONS[role]}</p>
              <p className="mt-1 text-xs text-muted">{pageCount} pages in this role's access</p>
              {role !== UserRole.SUPER_ADMIN && onOpenDemoAccount && (
                <button
                  type="button"
                  onClick={() => onOpenDemoAccount(role)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-sm font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {savedDemoAccount?.role === role
                    ? `Continue as ${savedDemoAccount.email}`
                    : `Sign in to Demo ${ROLE_LABELS[role]}`}
                  <ArrowRight size={15} />
                </button>
              )}
              {onOpenDemo && (
                <button
                  type="button"
                  onClick={() => onOpenDemo(role)}
                  className="mt-2 w-full rounded-control border border-border px-3 py-2 text-xs font-semibold text-text hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Open isolated sample
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
