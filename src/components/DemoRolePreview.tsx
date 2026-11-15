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
  onOpenDemo: (role: UserRole) => void;
}

export function DemoRolePreview({ onOpenDemo }: DemoRolePreviewProps) {
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <header className="rounded-card border border-border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-control bg-primary/10 text-primary">
            <FlaskConical size={22} />
          </span>
          <div>
            <h2 className="text-xl font-black text-text">Role Demo</h2>
            <p className="mt-1 text-sm text-muted">Open a full-screen demo workspace with sample data and role-specific navigation.</p>
          </div>
        </div>
      </header>

      <div role="note" className="flex items-start gap-3 rounded-control border border-warning/40 bg-warning/10 p-4 text-sm text-text">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning" />
        <p>
          Demo sessions use isolated sample data. Your Super Admin login stays active underneath, and signing out of a demo returns you to it. This does not sign in to a real account or change real permissions.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DEMO_PREVIEW_ROLES.map((role) => {
          const pageCount = getDemoRolePages(role).length;
          return (
            <button
              key={role}
              type="button"
              onClick={() => onOpenDemo(role)}
              className="rounded-card border border-border bg-white p-5 text-left shadow-sm transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="text-base font-bold text-text">Demo {ROLE_LABELS[role]}</span>
              <span className="mt-1 block text-sm text-muted">{ROLE_DESCRIPTIONS[role]}</span>
              <span className="mt-1 block text-xs text-muted">{pageCount} pages in this role's sample access</span>
              <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary">
                Open demo account <ArrowRight size={15} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
