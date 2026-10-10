export interface ParsedProductCsvRow {
  line: number;
  values: Record<string, string>;
}

export interface ProductDuplicateIdentity {
  code: string;
  barcode: string | null;
  brand_name: string;
  generic_name: string;
  company: string;
  strength?: string | null;
  strength_present?: boolean;
}

export interface ProductImportPreviewRow extends ParsedProductCsvRow {
  errors: string[];
}

const REQUIRED_HEADERS = [
  'code',
  'brand_name',
  'generic_name',
  'category',
  'company',
  'unit_name',
  'conversion_factor',
  'price_paisa',
] as const;

export function parseProductCsv(text: string): ParsedProductCsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('The CSV file has an unclosed quoted field.');
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (rows.length < 2) throw new Error('The CSV file has a header row and at least one product row.');

  const headers = rows[0].map((value) => value.trim().replace(/^\uFEFF/, ''));
  if (new Set(headers).size !== headers.length) throw new Error('The CSV file contains duplicate column names.');
  const missingHeader = REQUIRED_HEADERS.find((header) => !headers.includes(header));
  if (missingHeader) throw new Error(`CSV is missing the required "${missingHeader}" column.`);

  return rows.slice(1).map((values, index) => ({
    line: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ''])),
  }));
}

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function duplicateIdentity(
  candidate: ProductDuplicateIdentity,
  existing: ProductDuplicateIdentity,
) {
  if (candidate.barcode) {
    return Boolean(existing.barcode)
      && normalized(candidate.barcode) === normalized(existing.barcode);
  }
  return normalized(candidate.brand_name) === normalized(existing.brand_name)
    && normalized(candidate.company) === normalized(existing.company)
    && (!candidate.strength_present
      || normalized(candidate.strength) === normalized(existing.strength));
}

export function previewProductCsv(
  rows: readonly ParsedProductCsvRow[],
  existingProducts: readonly ProductDuplicateIdentity[],
): ProductImportPreviewRow[] {
  const seen: ProductDuplicateIdentity[] = [...existingProducts];
  return rows.map(({ line, values }) => {
    const errors: string[] = [];
    const product = {
      code: values.code ?? '',
      barcode: values.barcode?.trim() || null,
      brand_name: values.brand_name ?? '',
      generic_name: values.generic_name ?? '',
      company: values.company ?? '',
      strength: values.strength ?? null,
      strength_present: Object.prototype.hasOwnProperty.call(values, 'strength'),
    };

    if (Object.values(product).some((value) => typeof value === 'string' && !value.trim())) {
      errors.push('Code, product name, generic name, and manufacturer are required.');
    }
    if (!values.category?.trim()) errors.push('Category is required.');
    if (!values.unit_name?.trim()) errors.push('Unit is required.');
    const conversionFactor = Number(values.conversion_factor);
    const pricePaisa = Number(values.price_paisa);
    const minimumStock = Number(values.min_stock_alert || 0);
    if (!Number.isSafeInteger(conversionFactor) || conversionFactor < 1 || conversionFactor > 2_147_483_647) {
      errors.push('Conversion factor must be a positive whole number.');
    }
    if (!Number.isSafeInteger(pricePaisa) || pricePaisa < 0 || pricePaisa > 2_147_483_647) {
      errors.push('Price must be a non-negative whole number of paisa.');
    }
    if (!Number.isSafeInteger(minimumStock) || minimumStock < 0 || minimumStock > 2_147_483_647) {
      errors.push('Minimum stock must be a non-negative whole number.');
    }
    if (values.drug_class && !['OTC', 'RX', 'CONTROLLED', 'NARCOTIC'].includes(values.drug_class)) {
      errors.push('Medicine classification is unsupported.');
    }
    if (values.storage_condition && !['ROOM_TEMPERATURE', 'COOL', 'COLD_REFRIGERATED'].includes(values.storage_condition)) {
      errors.push('Storage condition is unsupported.');
    }
    for (const booleanField of ['requires_prescription', 'is_active']) {
      const value = values[booleanField]?.trim().toLowerCase();
      if (value && !['true', 'false', 't', 'f', 'yes', 'no', 'y', 'n', '1', '0'].includes(value)) {
        errors.push(`${booleanField} must be a valid boolean value.`);
      }
    }
    if (seen.some((existing) => duplicateIdentity(product, existing))) {
      errors.push('This product duplicates an existing product or another row in this file.');
    } else {
      seen.push(product);
    }

    return { line, values, errors };
  });
}
