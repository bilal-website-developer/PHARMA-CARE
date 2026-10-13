import assert from 'node:assert/strict';
import test from 'node:test';
import { BatchStatus, DrugClass } from '../types/pharmacy';
import { getRequiredSmallestUnits, isPosCatalogResponse } from './posCatalogLogic';

const product = {
  id: 'medicine-1',
  code: 'MED-001',
  barcode: null,
  brandName: 'Medicine One',
  genericName: 'Generic One',
  strength: '10 mg',
  category: 'Pain Relief',
  company: 'Example Pharma',
  drugClass: DrugClass.OTC,
  units: [{
    id: 'unit-1',
    name: 'Pack',
    conversionFactor: 10,
    isDefaultSaleUnit: true,
    pricePerUnitPaisa: 5000,
  }],
  batches: [{
    id: 'batch-1',
    batchNumber: 'LOT-1',
    expiryDate: '2027-12-31',
    receivedDate: '2026-10-01',
    quantitySmallestUnit: 20,
    status: BatchStatus.ACTIVE,
  }],
};

test('POS catalog response guard accepts safe catalog rows', () => {
  assert.equal(isPosCatalogResponse([product]), true);
  assert.equal(isPosCatalogResponse([]), true);
});

test('POS catalog response guard rejects malformed or cost-bearing fields', () => {
  assert.equal(isPosCatalogResponse([{ ...product, units: [] }]), false);
  assert.equal(isPosCatalogResponse([{
    ...product,
    batches: [{ ...product.batches[0], costPaisaPerUnit: 100 }],
  }]), false);
  assert.equal(isPosCatalogResponse([{
    ...product,
    units: [{ ...product.units[0], supplierName: 'Supplier' }],
  }]), false);
  assert.equal(isPosCatalogResponse([{
    ...product,
    batches: [{ ...product.batches[0], quantitySmallestUnit: '20' }],
  }]), false);
});

test('converts POS cart units into base tablet quantities', () => {
  assert.equal(getRequiredSmallestUnits(1, 1), 1);
  assert.equal(getRequiredSmallestUnits(1, 10), 10);
  assert.equal(getRequiredSmallestUnits(1, 100), 100);
  assert.equal(getRequiredSmallestUnits(2, 10), 20);
  assert.throws(() => getRequiredSmallestUnits(0, 10), RangeError);
  assert.throws(() => getRequiredSmallestUnits(2, Number.MAX_SAFE_INTEGER), RangeError);
});
