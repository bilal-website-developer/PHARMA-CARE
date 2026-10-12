import { useEffect, useMemo, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Printer, X } from 'lucide-react';
import { BarcodeRenderer } from './BarcodeRenderer';
import {
  isValidForFormat,
  MAX_LABELS_PER_PRODUCT,
  validateLabelQuantities,
  type BarcodeFormat,
} from '../../utils/labelUtils';

export type LabelSize = '30x20' | '50x30' | '58x40' | 'a4';
export type LabelFieldKey = 'name' | 'strength' | 'generic' | 'expiry' | 'mrp';

export interface LabelPrintItem {
  id: string;
  brand_name: string;
  generic_name: string;
  strength: string | null;
  code: string;
  barcode: string | null;
  price_paisa: number | null;
  expiry: string | null;
  copies?: number;
}

interface LabelPrintDialogProps {
  open: boolean;
  products: LabelPrintItem[];
  onClose: () => void;
}

const LABEL_SIZES: Record<LabelSize, { label: string; columns: number; rows: number; mmLabelWidth: number; mmLabelHeight: number }> = {
  '30x20': { label: '30 × 20 mm', columns: 3, rows: 6, mmLabelWidth: 30, mmLabelHeight: 20 },
  '50x30': { label: '50 × 30 mm', columns: 2, rows: 4, mmLabelWidth: 50, mmLabelHeight: 30 },
  '58x40': { label: '58 × 40 mm', columns: 2, rows: 3, mmLabelWidth: 58, mmLabelHeight: 40 },
  a4: { label: 'A4 sheet', columns: 2, rows: 5, mmLabelWidth: 72, mmLabelHeight: 48 },
};

const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY = 'inline-flex items-center justify-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm font-semibold text-text hover:bg-surface/80 disabled:opacity-50';
const FIELD = 'w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

function safeText(value: string | null | undefined) {
  return (value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function normalizeBarcodeValue(value: string | null | undefined, fallback: string) {
  const trimmed = safeText(value);
  return trimmed || fallback;
}

function defaultFormatForBarcode(value: string): BarcodeFormat {
  return value.replace(/\D/g, '').length === 13 ? 'EAN13' : 'CODE128';
}

export function LabelPrintDialog({ open, products, onClose }: LabelPrintDialogProps) {
  const [size, setSize] = useState<LabelSize>('50x30');
  const [copiesByProduct, setCopiesByProduct] = useState<Record<string, string>>({});
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormat>('CODE128');
  const [printError, setPrintError] = useState('');
  const [showFields, setShowFields] = useState<Record<LabelFieldKey, boolean>>({
    name: true,
    strength: true,
    generic: false,
    expiry: false,
    mrp: true,
  });

  useEffect(() => {
    setCopiesByProduct(Object.fromEntries(products.map((product) => [
      product.id,
      String(product.copies ?? 1),
    ])));
    setPrintError('');
  }, [products]);

  const quantities = products.map((product) => ({
    id: product.id,
    name: product.brand_name,
    quantity: Number(copiesByProduct[product.id] ?? product.copies ?? 1),
  }));
  const quantityError = validateLabelQuantities(quantities);
  const missingBarcode = products.find((product) => !product.barcode?.trim());
  const validationError = quantityError
    ?? (missingBarcode ? `${missingBarcode.brand_name} has no barcode. Make a barcode before printing.` : '');

  const previewRows = useMemo(() => {
    return products.flatMap((product) => {
      const copies = Number(copiesByProduct[product.id] ?? product.copies ?? 1);
      if (!Number.isInteger(copies) || copies < 1 || copies > MAX_LABELS_PER_PRODUCT) return [];
      return Array.from({ length: copies }, (_, index) => ({ ...product, key: `${product.id}-${index}` }));
    });
  }, [copiesByProduct, products]);

  const toggleField = (field: LabelFieldKey) => {
    setShowFields((current) => ({ ...current, [field]: !current[field] }));
  };

  const printLabels = () => {
    if (validationError) {
      setPrintError(validationError);
      return;
    }
    const printWindow = window.open('', '_blank', 'width=980,height=700');
    if (!printWindow) {
      setPrintError('The print window was blocked. Allow pop-ups for this site and try again.');
      return;
    }
    setPrintError('');

    const labelCount = previewRows.length;
    const sheetSize = LABEL_SIZES[size];
    const itemsHtml = previewRows.map((product) => {
      const barcodeValue = normalizeBarcodeValue(product.barcode, '');
      const resolvedFormat = barcodeFormat;
      const isValid = isValidForFormat(barcodeValue, resolvedFormat);
      const svgMarkup = (() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        if (!isValid) {
          return '<div class="label-error">Invalid barcode</div>';
        }
        JsBarcode(svg, barcodeValue, {
          format: resolvedFormat,
          displayValue: false,
          height: 28,
          margin: 0,
          width: 1.7,
          lineColor: '#111111',
          background: '#ffffff',
        });
        return svg.outerHTML;
      })();

      const expiryText = showFields.expiry ? (product.expiry ? `Exp: ${safeText(product.expiry)}` : 'Exp: —') : '';
      const priceText = showFields.mrp && product.price_paisa !== null ? `MRP ${new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(product.price_paisa / 100)}` : '';
      const metaParts = [
        showFields.strength && product.strength ? safeText(product.strength) : '',
        showFields.generic ? safeText(product.generic_name) : '',
      ].filter(Boolean);

      return `
        <article class="label-item" aria-label="${safeText(product.brand_name)} label">
          ${showFields.name ? `<div class="label-head">${safeText(product.brand_name)}</div>` : ''}
          ${metaParts.length ? `<div class="label-meta">${metaParts.join(' • ')}</div>` : ''}
          <div class="label-barcode">${svgMarkup}</div>
          <div class="label-code">${safeText(barcodeValue)}</div>
          <div class="label-foot">${[expiryText, priceText].filter(Boolean).join(' • ')}</div>
        </article>
      `;
    }).join('');

    const css = `
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: white; color: #111; font-family: Arial, Helvetica, sans-serif; }
        body { padding: 4mm; }
        .sheet { display: grid; grid-template-columns: repeat(${sheetSize.columns}, minmax(0, 1fr)); gap: 3mm; }
        .label-item {
          width: 100%;
          min-height: ${sheetSize.mmLabelHeight}mm;
          border: 1px solid #111;
          padding: 2mm 2.5mm;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          break-inside: avoid;
          overflow: hidden;
        }
        .label-head { font-size: 9pt; font-weight: 700; line-height: 1.2; margin-bottom: 1mm; }
        .label-meta, .label-code, .label-foot { font-size: 7pt; line-height: 1.2; }
        .label-barcode { width: 100%; display: flex; justify-content: center; align-items: center; margin: 1mm 0; }
        .label-barcode svg { max-width: 100%; height: auto; }
        .label-error { color: #b42332; font-size: 7pt; font-weight: 700; }
        @page { size: ${size === 'a4' ? 'A4 portrait' : `${sheetSize.mmLabelWidth}mm ${sheetSize.mmLabelHeight}mm`}; margin: 0; }
        @media print { html, body { width: 100%; margin: 0; } .sheet { gap: 3mm; } .label-item { break-inside: avoid; } }
      </style>
    `;

    printWindow.document.write(`<!doctype html><html><head><title>Print product labels</title>${css}</head><body><main class="sheet">${itemsHtml}</main><script>window.onload = () => window.print();</script></body></html>`);
    printWindow.document.close();

    if (labelCount === 0) {
      printWindow.close();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="label-print-title">
      <section className="w-full max-w-4xl rounded-xl border border-border bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 id="label-print-title" className="text-lg font-black text-text">Print product labels</h3>
            <p className="text-sm text-muted">{products.length} product{products.length === 1 ? '' : 's'} • {previewRows.length} label{previewRows.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" className={SECONDARY} aria-label="Close label print dialog" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-text">
              Label size
              <select className={`${FIELD} mt-1`} value={size} onChange={(event) => setSize(event.target.value as LabelSize)}>
                {Object.entries(LABEL_SIZES).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-semibold text-text">
              Barcode format
              <select className={`${FIELD} mt-1`} value={barcodeFormat} onChange={(event) => setBarcodeFormat(event.target.value as BarcodeFormat)}>
                <option value="CODE128">Code 128</option>
                <option value="EAN13">EAN-13</option>
                <option value="UPC">UPC-A</option>
                <option value="CODE39">Code 39</option>
                <option value="ITF">ITF-14</option>
              </select>
            </label>

            <fieldset className="max-h-48 space-y-2 overflow-y-auto rounded-control border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-text">Labels per product</legend>
              {products.map((product) => (
                <label key={product.id} className="flex items-center justify-between gap-3 text-sm text-text">
                  <span className="min-w-0 truncate">{product.brand_name}</span>
                  <input
                    aria-label={`Labels for ${product.brand_name}`}
                    className={`${FIELD} w-24`}
                    type="number"
                    min={1}
                    max={MAX_LABELS_PER_PRODUCT}
                    step={1}
                    value={copiesByProduct[product.id] ?? product.copies ?? 1}
                    onChange={(event) => setCopiesByProduct((current) => ({
                      ...current,
                      [product.id]: event.target.value,
                    }))}
                  />
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-muted">1–{MAX_LABELS_PER_PRODUCT} labels per product; print jobs allow up to 1,000 labels.</p>

            <div>
              <p className="text-sm font-semibold text-text">Fields to show</p>
              <div className="mt-2 grid gap-2 text-sm text-text">
                {(Object.keys(showFields) as LabelFieldKey[]).map((field) => (
                  <label key={field} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={showFields[field]} onChange={() => toggleField(field)} />
                    {field.charAt(0).toUpperCase() + field.slice(1)}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-control border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-black text-text">Live preview</h4>
              <span className="text-xs text-muted">{previewRows.length} label(s)</span>
            </div>

            <div className="grid gap-2 overflow-hidden rounded-control border border-border bg-white p-2" style={{ gridTemplateColumns: `repeat(${LABEL_SIZES[size].columns}, minmax(0, 1fr))` }}>
              {previewRows.slice(0, Math.min(previewRows.length, 12)).map((product) => {
                const barcodeValue = normalizeBarcodeValue(product.barcode, '');
                const resolvedFormat = barcodeFormat === 'CODE128' || barcodeFormat === 'UPC' || barcodeFormat === 'CODE39' || barcodeFormat === 'ITF' || barcodeFormat === 'EAN13'
                  ? barcodeFormat
                  : defaultFormatForBarcode(barcodeValue);
                const priceLabel = showFields.mrp && product.price_paisa !== null ? `MRP ${new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(product.price_paisa / 100)}` : '';
                return (
                  <div key={product.key} className="rounded-md border border-slate-200 p-2 text-center" style={{ minHeight: `${LABEL_SIZES[size].mmLabelHeight * 0.9}mm` }}>
                    {showFields.name && <div className="text-[9px] font-bold">{safeText(product.brand_name)}</div>}
                    {(showFields.strength || showFields.generic) && (
                      <div className="text-[7px] text-muted">{[showFields.strength && product.strength ? `• ${safeText(product.strength)}` : '', showFields.generic ? safeText(product.generic_name) : ''].filter(Boolean).join(' • ')}</div>
                    )}
                    <div className="mt-1 flex justify-center">
                      <BarcodeRenderer value={barcodeValue} format={resolvedFormat} height={28} displayValue={false} className="max-w-full" />
                    </div>
                    {showFields.expiry && <div className="text-[7px] text-muted">{product.expiry ? `Exp: ${safeText(product.expiry)}` : 'Exp: —'}</div>}
                    {priceLabel && <div className="text-[7px] font-semibold">{priceLabel}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {(validationError || printError) && (
          <p role="alert" className="mt-3 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {printError || validationError}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={onClose}>Close</button>
          <button type="button" className={BUTTON} disabled={Boolean(validationError)} onClick={printLabels}><Printer size={16} /> Print labels</button>
        </div>
      </section>
    </div>
  );
}
