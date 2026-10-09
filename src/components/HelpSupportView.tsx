import { useEffect, useState } from 'react';
import { Check, Copy, MessageCircle, Phone } from 'lucide-react';
import { APP_NAME } from '../constants/brand';
import { DEVELOPER } from '../config/developer';
import GlowCredit from './GlowCredit';
import packageJson from '../../package.json';

function currentTheme() {
  return document.documentElement.dataset.theme === 'night' ? 'dark' : 'light';
}

export function HelpSupportView({ username, role }: { username: string; role: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(currentTheme);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(DEVELOPER.phoneDisplay);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      window.alert('Could not copy the phone number. Please copy it manually: ' + DEVELOPER.phoneDisplay);
    }
  };

  const reportProblem = () => {
    const message = [
      `${APP_NAME} problem report`,
      `Username: ${username}`,
      `Role: ${role}`,
      `Page: ${window.location.href}`,
      `Date/time: ${new Date().toLocaleString()}`,
      `Browser: ${navigator.userAgent}`,
    ].join('\n');
    window.open(
      `https://wa.me/${DEVELOPER.phoneE164}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-black text-text">Pharma Care Help &amp; Support</h1>
        <p className="mt-1 text-sm text-muted">Contact support and find guidance for common pharmacy workflows.</p>
      </header>

      <section className="space-y-4 rounded-card border border-border bg-white p-5 shadow-sm">
        <div className="gc-card-background"><GlowCredit variant={theme} /></div>
        <div className="flex flex-wrap gap-2">
          <a href={`tel:+${DEVELOPER.phoneE164}`} className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-bold text-white"><Phone size={16} /> Call now</a>
          <a href={`https://wa.me/${DEVELOPER.phoneE164}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-control border border-border px-4 py-2.5 text-sm font-bold text-text"><MessageCircle size={16} /> WhatsApp</a>
          <button type="button" onClick={() => void copyNumber()} className="inline-flex items-center gap-2 rounded-control border border-border px-4 py-2.5 text-sm font-bold text-text">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Number copied' : 'Copy number'}</button>
          <button type="button" onClick={reportProblem} className="rounded-control border border-border px-4 py-2.5 text-sm font-bold text-text">Report a problem</button>
        </div>
        <p role="status" aria-live="polite" className="text-xs text-primary">{copied ? 'Support number copied to clipboard.' : ''}</p>
      </section>

      <section className="space-y-3 rounded-card border border-border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-text">Pharmacy usage guide</h2>
        <details className="rounded-control border border-border p-4">
          <summary className="cursor-pointer font-semibold text-text">Make a sale in POS</summary>
          <p className="mt-2 text-sm text-muted">Open POS Billing, search for a product or scan its barcode, add the required quantity, select a customer if needed, choose the payment method, and complete checkout. Eligible stock is allocated by FEFO: the batch with the earliest expiry is used first.</p>
        </details>
        <details className="rounded-control border border-border p-4">
          <summary className="cursor-pointer font-semibold text-text">Add a stock purchase</summary>
          <p className="mt-2 text-sm text-muted">Open Purchases, choose a supplier and payment type, add products to the cart, and enter the supplier invoice, quantity, rate, batch number, expiry, MRP, and any free quantity. Review the discount and total before saving. Posted purchase quantities are recorded in base units.</p>
        </details>
        <details className="rounded-control border border-border p-4">
          <summary className="cursor-pointer font-semibold text-text">Batches, stock, and expiry</summary>
          <p className="mt-2 text-sm text-muted">Stock is tracked separately for each batch using its batch number, expiry date, and remaining base-unit quantity. FEFO means eligible batches with the earliest expiry are sold first. Check expiry dates when receiving a purchase and reviewing stock.</p>
        </details>
        <details className="rounded-control border border-border p-4">
          <summary className="cursor-pointer font-semibold text-text">Add a product</summary>
          <p className="mt-2 text-sm text-muted">Open Products and choose Add Product. Enter the product’s brand and generic name, company, category, drug class, storage details, and sale units with their conversion factors. Stock batches are received through Purchases.</p>
        </details>
        <details className="rounded-control border border-border p-4">
          <summary className="cursor-pointer font-semibold text-text">Use the customer ledger</summary>
          <p className="mt-2 text-sm text-muted">Open Customer Ledger to review a customer’s balance and entries. Record payments against the customer account there; the ledger reflects invoices, payments, and returns according to the recorded transaction history.</p>
        </details>
      </section>

      <footer className="pb-2 text-center text-xs text-muted">{APP_NAME} · Version {packageJson.version}</footer>
    </section>
  );
}
