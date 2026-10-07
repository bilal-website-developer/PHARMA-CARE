import React, { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Lightbulb, Sparkles, X } from 'lucide-react';
import {
  BillingTemplate,
  ReceiptFormat,
  ReceiptData,
  renderReceipt,
  withReceiptTheme,
} from '../utils/receipt';

interface TemplatePreviewModalProps {
  initialTemplate: BillingTemplate;
  initialFormat: ReceiptFormat;
  canApply: boolean;
  onApply: (template: BillingTemplate, format: ReceiptFormat) => void;
  onClose: () => void;
}

const SAMPLE_RECEIPT: ReceiptData = {
  storeName: 'PharmaCare',
  invoiceNo: 'INV-240810',
  dateTime: '07/10/2026, 12:15 pm',
  cashierName: 'Sample Pharmacist',
  customerName: 'Walk-in Customer',
  paymentMode: 'CASH',
  status: 'PAID',
  items: [
    {
      name: 'Panadol 500mg',
      batchNo: 'P500-A',
      expiry: '08/2027',
      qty: 2,
      unit: 'strips',
      unitPrice: 45000,
      lineTotal: 90000,
    },
    {
      name: 'Augmentin 625mg',
      batchNo: 'A625-B',
      expiry: '11/2027',
      qty: 1,
      unit: 'pack',
      unitPrice: 285000,
      lineTotal: 285000,
    },
    {
      name: 'Brufen 400mg',
      batchNo: 'B400-C',
      expiry: '06/2028',
      qty: 1,
      unit: 'strip',
      unitPrice: 65000,
      lineTotal: 65000,
    },
  ],
  subtotal: 440000,
  discount: 0,
  total: 440000,
  paid: 440000,
  change: 0,
  balanceDue: 0,
  footerEnglish: 'Thank you for your business.',
  footerUrdu: 'شکریہ! دوبارہ تشریف لائیں',
};

const TEMPLATES: Array<{ id: BillingTemplate; description: string; icon: React.ReactNode }> = [
  {
    id: 'simple',
    description: 'Minimal & clean. No logo area, compact spacing. Fast to print.',
    icon: <FileText size={18} />,
  },
  {
    id: 'classic',
    description: 'Standard receipt style with logo, dashed lines and item table. Recommended.',
    icon: <FileText size={18} />,
  },
  {
    id: 'professional',
    description: 'Full invoice look: letterhead, invoice number box, PAID stamp, signature line.',
    icon: <FileText size={18} />,
  },
  {
    id: 'modern',
    description: 'Elegant & spacious. Clean sans-serif font, thin borders, cards for totals.',
    icon: <Sparkles size={18} />,
  },
];

const FORMATS: Array<{ id: ReceiptFormat; label: string }> = [
  { id: 'thermal58', label: 'Thermal 58mm' },
  { id: 'thermal80', label: 'Thermal 80mm' },
  { id: 'a4', label: 'A4 Page' },
];

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({
  initialTemplate,
  initialFormat,
  canApply,
  onApply,
  onClose,
}) => {
  const [format, setFormat] = useState(initialFormat);
  const [template, setTemplate] = useState(initialTemplate);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const receiptHtml = useMemo(
    () => withReceiptTheme(renderReceipt(template, format, SAMPLE_RECEIPT)),
    [template, format]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-text/60 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="template-preview-title"
        aria-modal="true"
        role="dialog"
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-card border border-border bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between bg-text px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <Sparkles aria-hidden="true" size={19} className="text-accent" />
            <div>
              <h2 id="template-preview-title" className="text-base font-bold">
                Quick View Template Preview
              </h2>
              <p className="text-xs text-white/70">See how your invoice will print.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-control p-2 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={19} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[290px_minmax(0,1fr)] md:overflow-hidden">
          <div className="flex flex-col gap-5 overflow-y-auto border-b border-border p-4 md:border-b-0 md:border-r sm:p-5">
            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                Select format size
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {FORMATS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={format === id}
                    onClick={() => {
                      setLoading(true);
                      setFormat(id);
                    }}
                    className={`rounded-control border px-3 py-2 text-left text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      format === id
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-white text-text hover:bg-surface'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                Template
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={template === option.id}
                    onClick={() => setTemplate(option.id)}
                    className={`flex items-center gap-2 rounded-control border px-2.5 py-2 text-xs font-semibold capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      template === option.id
                        ? 'border-primary bg-surface text-primary'
                        : 'border-border text-muted hover:bg-surface'
                    }`}
                  >
                    {option.icon}
                    {option.id}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-card border border-border bg-surface p-3.5 text-xs">
              <h3 className="font-bold text-text">Template Specs</h3>
              <div className="flex justify-between gap-2 text-muted">
                <span>Option</span>
                <strong className="capitalize text-text">{template}</strong>
              </div>
              <div className="flex justify-between gap-2 text-muted">
                <span>Paper width</span>
                <strong className="text-right text-text">
                  {format === 'a4' ? '210mm (A4)' : `${format === 'thermal58' ? '58mm' : '80mm'} (Thermal)`}
                </strong>
              </div>
              <div className="flex justify-between gap-2 text-muted">
                <span>Layout type</span>
                <strong className="text-right text-text">
                  {format === 'a4' ? 'Portrait Sheet' : 'Continuous Roll'}
                </strong>
              </div>
            </div>

            <div className="flex gap-2 rounded-card border border-border bg-surface p-3 text-xs text-text">
              <Lightbulb aria-hidden="true" size={17} className="shrink-0 text-primary" />
              <p>The printed layout adjusts to the paper size selected for your printer.</p>
            </div>

            <div className="mt-auto space-y-2">
              <button
                type="button"
                onClick={() => onApply(template, format)}
                disabled={!canApply}
                className="flex w-full items-center justify-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={17} />
                Apply This Template
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-control border border-border bg-white px-4 py-2 text-sm font-semibold text-text hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="relative flex min-h-[420px] items-start justify-center overflow-auto bg-surface p-4 sm:p-6 md:min-h-0">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80">
                <span className="animate-pulse text-sm font-semibold text-muted">Preparing receipt preview…</span>
              </div>
            )}
            <iframe
              key={`${template}-${format}`}
              title={`${template} ${format} receipt preview`}
              srcDoc={receiptHtml}
              onLoad={() => setLoading(false)}
              className="border-0 bg-white shadow-lg"
              style={{
                width: format === 'thermal58' ? 220 : format === 'thermal80' ? 320 : 580,
                height: format === 'a4' ? 820 : 700,
                maxWidth: '100%',
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
};
