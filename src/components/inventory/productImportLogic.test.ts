import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProductCsv, previewProductCsv } from './productImportLogic.ts';

const headers = 'code,barcode,brand_name,generic_name,category,company,unit_name,conversion_factor,price_paisa';

test('parses quoted commas, escaped quotes, and line numbers', () => {
  const rows = parseProductCsv(`${headers}\nP-1,,"Brand, Plus","Generic ""A""",Tablets,Maker,Box,10,1250`);
  assert.equal(rows[0].line, 2);
  assert.equal(rows[0].values.brand_name, 'Brand, Plus');
  assert.equal(rows[0].values.generic_name, 'Generic "A"');
});

test('rejects malformed CSV and missing required headers', () => {
  assert.throws(() => parseProductCsv(`${headers}\nP-1,"unfinished`), /unclosed quoted field/);
  assert.throws(() => parseProductCsv('code,brand_name\nP-1,Brand'), /missing the required "generic_name" column/);
});

test('preview reports invalid numeric values and duplicate products', () => {
  const rows = parseProductCsv([
    headers,
    'P-1,,Brand,Generic,Tablets,Maker,Box,10,500',
    'P-1,,Other,Other,Tablets,Maker,Box,10,500',
    'P-2,,Brand  ,Generic,Tablets,Maker,Box,0,-1',
  ].join('\n'));
  const preview = previewProductCsv(rows, []);
  assert.equal(preview[0].errors.length, 0);
  assert.match(preview[1].errors.join(' '), /duplicates an existing product/);
  assert.match(preview[2].errors.join(' '), /Conversion factor/);
  assert.match(preview[2].errors.join(' '), /Price/);
});

test('preview identifies products already in the database by code, barcode, or name tuple', () => {
  const rows = parseProductCsv([
    headers,
    'P-1,,Other,Generic,Tablets,Maker,Box,10,500',
    'P-2,123,Other,Generic,Tablets,Maker,Box,10,500',
    'P-3,,Brand,Generic,Tablets,Maker,Box,10,500',
  ].join('\n'));
  const preview = previewProductCsv(rows, [
    { code: 'P-1', barcode: null, brand_name: 'Old', generic_name: 'Other', company: 'Maker' },
    { code: 'P-0', barcode: '123', brand_name: 'Old', generic_name: 'Other', company: 'Maker' },
    { code: 'P-0', barcode: null, brand_name: 'Brand', generic_name: 'Generic', company: 'Maker' },
  ]);
  assert.ok(preview.every((row) => row.errors.some((error) => error.includes('duplicates'))));
});
