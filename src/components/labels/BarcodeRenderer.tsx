import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { isValidForFormat, type BarcodeFormat } from '../../utils/labelUtils';

interface BarcodeRendererProps extends React.ComponentPropsWithoutRef<'div'> {
  value: string;
  format?: BarcodeFormat;
  height?: number;
  displayValue?: boolean;
}

export function BarcodeRenderer({
  value,
  format = 'CODE128',
  height = 48,
  displayValue = true,
  className,
  ...props
}: BarcodeRendererProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const barcodeValue = value.trim();
  const isValid = barcodeValue.length > 0 && isValidForFormat(barcodeValue, format);

  useEffect(() => {
    const element = svgRef.current;
    if (!element || !isValid) {
      return;
    }

    try {
      JsBarcode(element, barcodeValue, {
        format,
        displayValue,
        height,
        margin: 4,
        lineColor: '#111111',
        background: '#ffffff',
        width: 1.9,
      });
    } catch (error) {
      console.error('Could not render barcode.', error);
    }
  }, [barcodeValue, displayValue, format, height, isValid]);

  if (!barcodeValue) {
    return (
      <div {...props} className={['text-xs font-medium text-red-600', className].filter(Boolean).join(' ')}>
        Barcode value is required.
      </div>
    );
  }

  if (!isValid) {
    return (
      <div {...props} role="alert" className={['text-xs font-medium text-red-600', className].filter(Boolean).join(' ')}>
        Invalid {format} barcode value.
      </div>
    );
  }

  return (
    <div {...props} className={['w-full overflow-hidden', className].filter(Boolean).join(' ')}>
      <svg ref={svgRef} aria-label={`Barcode ${barcodeValue}`} className="block h-auto max-w-full" />
    </div>
  );
}
