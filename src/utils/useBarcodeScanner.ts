import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseBarcodeScannerOptions {
  enabled?: boolean;
  timeoutMs?: number;
  minLength?: number;
}

export function normalizeScannedValue(value: string): string {
  return value.replace(/\s+/g, '').trim();
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
}: UseBarcodeScannerOptions = {}) {
  const [scanValue, setScanValue] = useState('');
  const [lastScanned, setLastScanned] = useState('');
  const timeoutRef = useRef<number | undefined>(undefined);
  const bufferRef = useRef('');

  const flushBuffer = useCallback(() => {
    const normalized = normalizeScannedValue(bufferRef.current);
    bufferRef.current = '';
    setScanValue('');

    if (normalized.length >= minLength) {
      setLastScanned(normalized);
      return;
    }

    setLastScanned('');
  }, [minLength]);

  const resetScan = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
    bufferRef.current = '';
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

      if (event.key === 'Enter' || event.key === 'Tab') {
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

      bufferRef.current += event.key;
      setScanValue(bufferRef.current);

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        flushBuffer();
      }, timeoutMs);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, flushBuffer, resetScan, timeoutMs]);

  return {
    scanValue,
    lastScanned,
    resetScan,
    clearBuffer: resetScan,
  };
}
