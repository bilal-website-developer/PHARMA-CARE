import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseBarcodeScannerOptions {
  enabled?: boolean;
  timeoutMs?: number;
  minLength?: number;
  maxScanDurationMs?: number;
}

export interface BarcodeScanParseOptions {
  minLength?: number;
  maxScanDurationMs?: number;
}

export function normalizeScannedValue(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

export function parseBarcodeScan(
  value: string,
  durationMs: number,
  { minLength = 3, maxScanDurationMs = 1000 }: BarcodeScanParseOptions = {},
): string | null {
  const normalized = normalizeScannedValue(value);
  if (
    normalized.length < minLength
    || !Number.isFinite(durationMs)
    || durationMs < 0
    || durationMs > maxScanDurationMs
  ) {
    return null;
  }

  return normalized;
}

export function findProductByScan<T extends { barcode?: string | null; code?: string | null }>(
  products: readonly T[],
  scannedValue: string,
): T | undefined {
  const normalized = normalizeScannedValue(scannedValue);
  if (!normalized) {
    return undefined;
  }

  return products.find((product) => {
    const barcode = normalizeScannedValue(product.barcode ?? '');
    const code = normalizeScannedValue(product.code ?? '');
    return barcode === normalized || code === normalized;
  });
}

export function useBarcodeScanner({
  enabled = true,
  timeoutMs = 100,
  minLength = 3,
  maxScanDurationMs = 1000,
}: UseBarcodeScannerOptions = {}) {
  const [scanValue, setScanValue] = useState('');
  const [lastScanned, setLastScanned] = useState('');
  const [lastRawValue, setLastRawValue] = useState('');
  const [lastScanDurationMs, setLastScanDurationMs] = useState<number | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);
  const bufferRef = useRef('');
  const scanStartedAtRef = useRef<number | null>(null);

  const flushBuffer = useCallback(() => {
    const rawValue = bufferRef.current;
    const scanStartedAt = scanStartedAtRef.current;
    const durationMs = scanStartedAt === null ? Number.NaN : performance.now() - scanStartedAt;
    const parsed = parseBarcodeScan(rawValue, durationMs, { minLength, maxScanDurationMs });
    bufferRef.current = '';
    scanStartedAtRef.current = null;
    setScanValue('');
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }

    if (parsed) {
      setLastRawValue(rawValue);
      setLastScanDurationMs(Math.round(durationMs));
      setLastScanned(parsed);
      return;
    }

    setLastScanned('');
  }, [maxScanDurationMs, minLength]);

  const resetScan = useCallback(() => {
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
    bufferRef.current = '';
    scanStartedAtRef.current = null;
    setScanValue('');
    setLastScanned('');
  }, []);

  useEffect(() => {
    if (!enabled) {
      resetScan();
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        resetScan();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === 'Enter') {
        if (bufferRef.current.trim()) {
          flushBuffer();
        }
        return;
      }

      if (event.key === 'Backspace') {
        bufferRef.current = bufferRef.current.slice(0, -1);
        setScanValue(bufferRef.current);
        return;
      }

      if (event.key.length !== 1) {
        return;
      }

      if (scanStartedAtRef.current === null) {
        scanStartedAtRef.current = performance.now();
      }
      bufferRef.current += event.key;
      setScanValue(bufferRef.current);

      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        bufferRef.current = '';
        scanStartedAtRef.current = null;
        timeoutRef.current = undefined;
        setScanValue('');
      }, timeoutMs);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, flushBuffer, resetScan, timeoutMs]);

  return {
    scanValue,
    lastScanned,
    lastRawValue,
    lastScanDurationMs,
    resetScan,
    clearBuffer: resetScan,
  };
}
