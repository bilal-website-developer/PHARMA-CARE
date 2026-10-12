import { Barcode, X } from 'lucide-react';

interface BarcodeScannerTestProps {
  open: boolean;
  scanValue: string;
  lastRawValue: string;
  lastScanned: string;
  lastScanDurationMs: number | null;
  onClose: () => void;
}

const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm font-semibold text-text hover:bg-surface/80';

export function BarcodeScannerTest({
  open,
  scanValue,
  lastRawValue,
  lastScanned,
  lastScanDurationMs,
  onClose,
}: BarcodeScannerTestProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-scanner-test-title"
        className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="barcode-scanner-test-title" className="flex items-center gap-2 text-lg font-black text-text">
              <Barcode size={18} />
              Scanner test
            </h2>
            <p className="mt-1 text-sm text-muted">Scan a barcode ending with Enter. Fast scans appear below.</p>
          </div>
          <button type="button" className={BUTTON} aria-label="Close scanner test" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="rounded-control border border-border bg-surface p-3" aria-live="polite">
          {lastScanned ? (
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="font-semibold text-muted">Raw input</dt>
                <dd className="break-all font-mono text-text">{lastRawValue}</dd>
              </div>
              <div>
                <dt className="font-semibold text-muted">Parsed value</dt>
                <dd className="break-all font-mono text-text">{lastScanned}</dd>
              </div>
              <div className="flex gap-4">
                <div><dt className="font-semibold text-muted">Characters</dt><dd className="text-text">{lastRawValue.length}</dd></div>
                <div><dt className="font-semibold text-muted">Scan time</dt><dd className="text-text">{lastScanDurationMs ?? '—'} ms</dd></div>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">{scanValue ? `Reading ${scanValue.length} character(s)…` : 'Waiting for a scan…'}</p>
          )}
        </div>
      </section>
    </div>
  );
}
