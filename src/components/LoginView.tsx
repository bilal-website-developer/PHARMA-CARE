import React, { useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Pill,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import { UserRole } from '../types/pharmacy';

export interface AuthSession {
  userId: string;
  displayName: string;
  role: UserRole;
}

export function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === 'string' &&
    typeof record.displayName === 'string' &&
    typeof record.role === 'string' &&
    Object.values(UserRole).includes(record.role as UserRole)
  );
}

interface LoginViewProps {
  demoEnabled: boolean;
  localDemoMode: boolean;
  onLogin: (session: AuthSession) => void;
}

const DEMO_ROLES = [
  {
    role: UserRole.ADMIN,
    title: 'Admin',
    roleCode: 'admin',
    description: 'System Administrator',
  },
  {
    role: UserRole.PHARMACIST,
    title: 'Pharmacist / Manager',
    roleCode: 'pharmacist',
    description: 'Dr. Tariq Khan (Pharmacist)',
  },
  {
    role: UserRole.CASHIER,
    title: 'Cashier',
    roleCode: 'cashier',
    description: 'Bilal Cashier (POS 1)',
  },
  {
    role: UserRole.INVENTORY,
    title: 'Inventory / Purchase',
    roleCode: 'inventory',
    description: 'Kamran (Inventory Manager)',
  },
  {
    role: UserRole.ACCOUNTANT,
    title: 'Accountant',
    roleCode: 'accountant',
    description: 'Sajid (Head Accountant)',
  },
] as const;

export const LoginView: React.FC<LoginViewProps> = ({
  demoEnabled,
  localDemoMode,
  onLogin,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingRole, setLoadingRole] = useState<UserRole | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'demo' | 'manual'>(() =>
    demoEnabled ? 'demo' : 'manual'
  );

  useEffect(() => {
    setActiveTab(demoEnabled ? 'demo' : 'manual');
  }, [demoEnabled]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error('Invalid username or password');
      const result = (await response.json()) as { user?: unknown };
      if (!isAuthSession(result.user)) {
        throw new Error('Invalid username or password');
      }
      setPassword('');
      onLogin(result.user);
    } catch {
      setError('Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (role: UserRole) => {
    if (loadingRole) return;
    setLoadingRole(role);
    setError('');
    if (localDemoMode) {
      const demoRole = DEMO_ROLES.find((candidate) => candidate.role === role);
      if (!demoRole) {
        setError('This demo role is unavailable.');
        setLoadingRole(null);
        return;
      }
      onLogin({
        userId: `local-demo:${role.toLowerCase()}`,
        displayName: demoRole.description,
        role,
      });
      return;
    }

    try {
      const response = await fetch('/api/auth/demo-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: role.toLowerCase() }),
      });
      if (!response.ok) throw new Error('Demo login failed');
      const result = (await response.json()) as { user?: unknown };
      if (!isAuthSession(result.user) || result.user.role !== role) {
        throw new Error('Demo login failed');
      }
      onLogin(result.user);
    } catch {
      setError('Demo login is unavailable. Please try again.');
      setLoadingRole(null);
    }
  };

  const resetForm = () => {
    setUsername('');
    setPassword('');
    setError('');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-3 py-4 font-inter text-text sm:px-5">
      <div className="w-full max-w-md">
        <header className="mb-3 space-y-1.5 text-center">
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-card bg-primary text-white">
            <Pill aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold">PharmaCare</h1>
          <p className="text-xs text-muted">Sign in to PharmaCare</p>
        </header>

        {demoEnabled && (
          <div
            role="status"
            className="mb-2 rounded-control border border-warning bg-warning/15 px-3 py-2 text-center text-xs font-semibold text-text"
          >
            DEMO MODE: sample data only
          </div>
        )}

        <section className="overflow-hidden rounded-card border border-border bg-white shadow-lg">
          <div className="h-1.5 bg-primary" />
          <div className="p-4 sm:p-5">
            {demoEnabled && (
              <div
                className="mb-4 flex border-b border-border"
                role="tablist"
                aria-label="Login options"
              >
                <button
                  id="demo-tab"
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'demo'}
                  aria-controls="demo-panel"
                  onClick={() => {
                    setActiveTab('demo');
                    setError('');
                  }}
                  className={`flex-1 border-b-2 px-2 pb-2.5 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    activeTab === 'demo'
                      ? 'border-primary font-bold text-primary'
                      : 'border-transparent font-medium text-muted'
                  }`}
                >
                  1-Click Demo Login
                </button>
                <button
                  id="manual-tab"
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'manual'}
                  aria-controls="manual-panel"
                  onClick={() => {
                    setActiveTab('manual');
                    setError('');
                  }}
                  className={`flex-1 border-b-2 px-2 pb-2.5 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    activeTab === 'manual'
                      ? 'border-primary font-bold text-primary'
                      : 'border-transparent font-medium text-muted'
                  }`}
                >
                  Manual Credentials
                </button>
              </div>
            )}

            {demoEnabled && activeTab === 'demo' ? (
              <div id="demo-panel" role="tabpanel" aria-labelledby="demo-tab">
                <p className="mb-3 text-sm leading-5 text-muted">
                  Click any role to test role-aware navigation and menu restrictions.
                </p>
                <div className="space-y-2">
                  {DEMO_ROLES.map((demoRole) => {
                    const isLoading = loadingRole === demoRole.role;
                    return (
                      <button
                        key={demoRole.role}
                        type="button"
                        disabled={loadingRole !== null}
                        onClick={() => void handleDemoLogin(demoRole.role)}
                        className="group w-full rounded-card border border-border bg-surface p-3 text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-70"
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-primary">{demoRole.title}</span>
                              <span className="rounded-full border border-border bg-white px-2 py-0.5 text-[11px] font-semibold text-muted">
                                {demoRole.roleCode}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs text-muted">
                              {demoRole.description}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-primary">
                            {isLoading ? 'Signing in…' : 'Login ->'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {error && (
                  <p role="alert" className="mt-4 text-sm font-medium text-danger">
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <form
                id="manual-panel"
                role={demoEnabled ? 'tabpanel' : undefined}
                aria-labelledby={demoEnabled ? 'manual-tab' : undefined}
                onSubmit={handleSubmit}
                onReset={(event) => {
                  event.preventDefault();
                  resetForm();
                }}
                className="space-y-5"
              >
                <div>
                  <label htmlFor="username" className="mb-1.5 block text-xs font-bold tracking-wide">
                    USERNAME / EMAIL
                  </label>
                  <div className="relative">
                    <UserRound
                      aria-hidden="true"
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      id="username"
                      name="username"
                      autoComplete="username"
                      required
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="w-full rounded-control border border-border bg-white py-2.5 pl-10 pr-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="mb-1.5 block text-xs font-bold tracking-wide">
                    PASSWORD
                  </label>
                  <div className="relative">
                    <LockKeyhole
                      aria-hidden="true"
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onKeyUp={(event) => setCapsLock(event.getModifierState('CapsLock'))}
                      onKeyDown={(event) => setCapsLock(event.getModifierState('CapsLock'))}
                      className="w-full rounded-control border border-border bg-white py-2.5 pl-10 pr-11 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {capsLock && (
                    <p className="mt-1 text-xs font-medium text-warning">Caps Lock is on.</p>
                  )}
                </div>

                {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

                <div className="border-t border-border pt-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex items-center justify-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
                    >
                      <Check size={17} aria-hidden="true" />
                      {loading ? 'Signing in…' : 'Sign In to System'}
                    </button>
                    <button
                      type="reset"
                      disabled={loading}
                      className="flex items-center justify-center gap-2 rounded-control bg-danger px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      Reset Form
                    </button>
                  </div>
                </div>
                <p className="text-center text-xs text-muted">
                  Forgot your password? Contact your administrator.
                </p>
              </form>
            )}
          </div>

          <footer className="border-t border-border bg-surface px-4 py-3 text-center text-xs font-medium text-muted">
            Strict Multi-Role Security &amp; Audit Trail Active
          </footer>
        </section>

        <p className="mt-4 text-center text-[11px] text-muted">PharmaCare · Version 1.0.0</p>
      </div>
    </main>
  );
};
