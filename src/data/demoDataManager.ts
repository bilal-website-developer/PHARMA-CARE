import { supabase } from '../utils/supabase';
import { dispatchStockChanged } from '../utils/stockAlertsEvents';
import {
  Product,
  DrugClass,
  BatchStatus,
  Customer,
  LedgerEntry,
  CompletedSale,
  CashTransaction,
  PaymentMethod,
} from '../types/pharmacy';
import type { PosCatalogProduct } from './posCatalogLogic';
import { buildDemoStockPurchaseItems } from './demoStockPurchase';
import { planDemoMasterDataChanges, type DemoMasterDataRow } from './demoMasterData';

export const DEMO_DATA_CHANGED_EVENT = 'pharma-care.demoDataChanged';

export function dispatchDemoDataChanged() {
  window.dispatchEvent(new CustomEvent(DEMO_DATA_CHANGED_EVENT));
}

export interface DemoMedicineDefinition {
  code: string;
  barcode: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  category: string;
  company: string;
  drug_class: 'OTC' | 'RX' | 'CONTROLLED' | 'NARCOTIC';
  storage_condition: 'ROOM_TEMPERATURE' | 'COOL' | 'COLD_REFRIGERATED';
  rack_location: string;
  min_stock_alert: number;
  requires_prescription: boolean;
  units: Array<{
    name: string;
    conversion_factor: number;
    is_default_sale_unit: boolean;
    price_paisa: number;
    barcode?: string;
  }>;
  batch: {
    batch_number: string;
    expiry_date: string;
    cost_paisa: number;
    mrp_paisa: number;
    quantity: number;
  };
}

export const DEMO_SUPPLIER = {
  name: 'DEMO - Premier Distributors Ltd',
  contact: '021-35681234 / 0300-8201122',
  address: 'Plot 45, Sector 15, Korangi Industrial Area, Karachi',
  licence_or_tax_number: '3049281-7 / DTL-KHI-8891',
  payment_terms: '30 Days Credit',
  is_active: true,
};

export const DEMO_MEDICINES: DemoMedicineDefinition[] = [
  {
    code: 'DEMO-MED-001',
    barcode: '8964000100011',
    brand_name: 'Panadol 500mg',
    generic_name: 'Paracetamol',
    strength: '500mg',
    category: 'Analgesics & Antipyretics',
    company: 'GSK Pakistan',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'A-1-01',
    min_stock_alert: 50,
    requires_prescription: false,
    units: [
      { name: 'Box (200 Tabs)', conversion_factor: 200, is_default_sale_unit: false, price_paisa: 70000 },
      { name: 'Strip (10 Tabs)', conversion_factor: 10, is_default_sale_unit: true, price_paisa: 3500 },
      { name: 'Tablet (Loose)', conversion_factor: 1, is_default_sale_unit: false, price_paisa: 350 },
    ],
    batch: {
      batch_number: 'PAN-2601',
      expiry_date: '2027-12-31',
      cost_paisa: 2800,
      mrp_paisa: 3500,
      quantity: 120, // 120 strips = 1200 tabs
    },
  },
  {
    code: 'DEMO-MED-002',
    barcode: '8964000100028',
    brand_name: 'Augmentin 625mg',
    generic_name: 'Amoxicillin + Clavulanic Acid',
    strength: '625mg',
    category: 'Antibiotics',
    company: 'GSK Consumer Health',
    drug_class: 'RX',
    storage_condition: 'COOL',
    rack_location: 'B-2-04',
    min_stock_alert: 20,
    requires_prescription: true,
    units: [
      { name: 'Pack (14 Tabs)', conversion_factor: 14, is_default_sale_unit: true, price_paisa: 48000 },
      { name: 'Tablet (Loose)', conversion_factor: 1, is_default_sale_unit: false, price_paisa: 3600 },
    ],
    batch: {
      batch_number: 'AUG-2642',
      expiry_date: '2027-08-31',
      cost_paisa: 39000,
      mrp_paisa: 48000,
      quantity: 25, // 25 packs
    },
  },
  {
    code: 'DEMO-MED-003',
    barcode: '8964000100035',
    brand_name: 'Risek 20mg Capsule',
    generic_name: 'Omeprazole',
    strength: '20mg',
    category: 'Gastrointestinal / PPI',
    company: 'Getz Pharma',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'C-1-08',
    min_stock_alert: 30,
    requires_prescription: false,
    units: [
      { name: 'Pack (14 Caps)', conversion_factor: 14, is_default_sale_unit: true, price_paisa: 39200 },
      { name: 'Capsule (Loose)', conversion_factor: 1, is_default_sale_unit: false, price_paisa: 2900 },
    ],
    batch: {
      batch_number: 'RSK-2618',
      expiry_date: '2027-10-31',
      cost_paisa: 31000,
      mrp_paisa: 39200,
      quantity: 30,
    },
  },
  {
    code: 'DEMO-MED-004',
    barcode: '8964000100042',
    brand_name: 'Brufen 400mg',
    generic_name: 'Ibuprofen',
    strength: '400mg',
    category: 'NSAIDs / Pain Relief',
    company: 'Abbott Laboratories',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'A-2-10',
    min_stock_alert: 40,
    requires_prescription: false,
    units: [
      { name: 'Pack (300 Tabs)', conversion_factor: 300, is_default_sale_unit: false, price_paisa: 135000 },
      { name: 'Strip (10 Tabs)', conversion_factor: 10, is_default_sale_unit: true, price_paisa: 4600 },
      { name: 'Tablet (Loose)', conversion_factor: 1, is_default_sale_unit: false, price_paisa: 480 },
    ],
    batch: {
      batch_number: 'BRU-2609',
      expiry_date: '2027-09-30',
      cost_paisa: 3700,
      mrp_paisa: 4600,
      quantity: 60,
    },
  },
  {
    code: 'DEMO-MED-005',
    barcode: '8964000100059',
    brand_name: 'Arinac Forte',
    generic_name: 'Ibuprofen + Pseudoephedrine',
    strength: '400mg/60mg',
    category: 'Respiratory / Cold & Flu',
    company: 'Abbott Laboratories',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'A-3-05',
    min_stock_alert: 35,
    requires_prescription: false,
    units: [
      { name: 'Pack (100 Tabs)', conversion_factor: 100, is_default_sale_unit: false, price_paisa: 32000 },
      { name: 'Strip (10 Tabs)', conversion_factor: 10, is_default_sale_unit: true, price_paisa: 3200 },
    ],
    batch: {
      batch_number: 'ARN-2615',
      expiry_date: '2027-11-30',
      cost_paisa: 2500,
      mrp_paisa: 3200,
      quantity: 50,
    },
  },
  {
    code: 'DEMO-MED-006',
    barcode: '8964000100066',
    brand_name: 'Flagyl 400mg',
    generic_name: 'Metronidazole',
    strength: '400mg',
    category: 'Antiprotozoal / Antibacterial',
    company: 'Sanofi-Aventis',
    drug_class: 'RX',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'B-1-12',
    min_stock_alert: 40,
    requires_prescription: true,
    units: [
      { name: 'Pack (200 Tabs)', conversion_factor: 200, is_default_sale_unit: false, price_paisa: 84000 },
      { name: 'Strip (10 Tabs)', conversion_factor: 10, is_default_sale_unit: true, price_paisa: 4400 },
      { name: 'Tablet (Loose)', conversion_factor: 1, is_default_sale_unit: false, price_paisa: 450 },
    ],
    batch: {
      batch_number: 'FLA-2670',
      expiry_date: '2027-06-30',
      cost_paisa: 3500,
      mrp_paisa: 4400,
      quantity: 80,
    },
  },
  {
    code: 'DEMO-MED-007',
    barcode: '8964000100073',
    brand_name: 'Disprin 300mg Soluble',
    generic_name: 'Aspirin (Soluble)',
    strength: '300mg',
    category: 'Analgesics & Blood Thinner',
    company: 'Reckitt Benckiser',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'A-1-03',
    min_stock_alert: 45,
    requires_prescription: false,
    units: [
      { name: 'Pack (100 Tabs)', conversion_factor: 100, is_default_sale_unit: false, price_paisa: 35000 },
      { name: 'Strip (10 Tabs)', conversion_factor: 10, is_default_sale_unit: true, price_paisa: 3500 },
    ],
    batch: {
      batch_number: 'DSP-2611',
      expiry_date: '2027-07-31',
      cost_paisa: 2800,
      mrp_paisa: 3500,
      quantity: 90,
    },
  },
  {
    code: 'DEMO-MED-008',
    barcode: '8964000100080',
    brand_name: 'Ponstan Forte 500mg',
    generic_name: 'Mefenamic Acid',
    strength: '500mg',
    category: 'Analgesics & Anti-inflammatory',
    company: 'Pfizer Pakistan',
    drug_class: 'RX',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'A-2-08',
    min_stock_alert: 25,
    requires_prescription: true,
    units: [
      { name: 'Pack (100 Tabs)', conversion_factor: 100, is_default_sale_unit: false, price_paisa: 55000 },
      { name: 'Strip (10 Tabs)', conversion_factor: 10, is_default_sale_unit: true, price_paisa: 5500 },
    ],
    batch: {
      batch_number: 'PON-2655',
      expiry_date: '2027-12-31',
      cost_paisa: 4400,
      mrp_paisa: 5500,
      quantity: 45,
    },
  },
  {
    code: 'DEMO-MED-009',
    barcode: '8964000100097',
    brand_name: 'Gravinate 50mg',
    generic_name: 'Dimenhydrinate',
    strength: '50mg',
    category: 'Antiemetic / Motion Sickness',
    company: 'The Searle Company',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'B-3-02',
    min_stock_alert: 30,
    requires_prescription: false,
    units: [
      { name: 'Pack (100 Tabs)', conversion_factor: 100, is_default_sale_unit: false, price_paisa: 28000 },
      { name: 'Strip (10 Tabs)', conversion_factor: 10, is_default_sale_unit: true, price_paisa: 2800 },
    ],
    batch: {
      batch_number: 'GRV-2620',
      expiry_date: '2027-05-31',
      cost_paisa: 2200,
      mrp_paisa: 2800,
      quantity: 40,
    },
  },
  {
    code: 'DEMO-MED-010',
    barcode: '8964000100103',
    brand_name: 'Surbex Z',
    generic_name: 'Zinc + B-Complex + Vitamin C',
    strength: 'High Potency',
    category: 'Vitamins & Minerals',
    company: 'Abbott Laboratories',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'D-1-01',
    min_stock_alert: 15,
    requires_prescription: false,
    units: [
      { name: 'Bottle (30 Tabs)', conversion_factor: 1, is_default_sale_unit: true, price_paisa: 42000 },
    ],
    batch: {
      batch_number: 'SBX-2688',
      expiry_date: '2027-11-30',
      cost_paisa: 34500,
      mrp_paisa: 42000,
      quantity: 60,
    },
  },
  {
    code: 'DEMO-MED-011',
    barcode: '8964000100110',
    brand_name: 'CAC-1000 Plus Effervescent',
    generic_name: 'Calcium Lactate + Vitamin C + D3',
    strength: 'Orange Flavor',
    category: 'Supplements & Minerals',
    company: 'GSK Consumer Health',
    drug_class: 'OTC',
    storage_condition: 'COOL',
    rack_location: 'D-1-04',
    min_stock_alert: 20,
    requires_prescription: false,
    units: [
      { name: 'Tube (10 Tabs)', conversion_factor: 1, is_default_sale_unit: true, price_paisa: 38000 },
    ],
    batch: {
      batch_number: 'CAC-2604',
      expiry_date: '2027-09-30',
      cost_paisa: 31000,
      mrp_paisa: 38000,
      quantity: 80,
    },
  },
  {
    code: 'DEMO-MED-012',
    barcode: '8964000100127',
    brand_name: 'Softin 10mg',
    generic_name: 'Loratadine',
    strength: '10mg',
    category: 'Antihistamines / Allergy',
    company: 'Ferozsons Laboratories',
    drug_class: 'OTC',
    storage_condition: 'ROOM_TEMPERATURE',
    rack_location: 'C-2-06',
    min_stock_alert: 25,
    requires_prescription: false,
    units: [
      { name: 'Pack (10 Tabs)', conversion_factor: 10, is_default_sale_unit: true, price_paisa: 22000 },
      { name: 'Tablet (Loose)', conversion_factor: 1, is_default_sale_unit: false, price_paisa: 2300 },
    ],
    batch: {
      batch_number: 'SFT-2633',
      expiry_date: '2027-10-31',
      cost_paisa: 17500,
      mrp_paisa: 22000,
      quantity: 50,
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDemoMasterDataRow(value: unknown): value is DemoMasterDataRow {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.is_active === 'boolean';
}

async function ensureDemoMasterData(client: NonNullable<typeof supabase>): Promise<void> {
  const { data, error } = await client.rpc('master_data_overview');
  if (error) throw new Error(`Could not check demo categories and manufacturers: ${error.message}`);
  if (
    !isRecord(data)
    || !Array.isArray(data.categories)
    || !data.categories.every(isDemoMasterDataRow)
    || !Array.isArray(data.manufacturers)
    || !data.manufacturers.every(isDemoMasterDataRow)
  ) {
    throw new Error('The master-data overview returned an invalid response.');
  }

  const seed = async (
    kind: 'category' | 'manufacturer',
    records: DemoMasterDataRow[],
    requiredNames: string[],
  ) => {
    const plan = planDemoMasterDataChanges(requiredNames, records);
    const save = async (id: string | null, name: string) => {
      const { data: savedId, error: saveError } = await client.rpc(
        kind === 'category' ? 'save_category' : 'save_brand',
        kind === 'category'
          ? { p_category_id: id, p_name: name, p_is_active: true }
          : { p_brand_id: id, p_name: name, p_is_active: true },
      );
      if (saveError) {
        const action = id ? 'activate' : 'create';
        throw new Error(`Could not ${action} demo ${kind} "${name}": ${saveError.message}`);
      }
      if (typeof savedId !== 'string' || !savedId) {
        throw new Error(`The database did not return an ID for demo ${kind} "${name}".`);
      }
    };

    for (const row of plan.activateRows) await save(row.id, row.name);
    for (const name of plan.createNames) await save(null, name);
  };

  await seed('category', data.categories, DEMO_MEDICINES.map((medicine) => medicine.category));
  await seed('manufacturer', data.manufacturers, DEMO_MEDICINES.map((medicine) => medicine.company));
}

export const DEMO_CUSTOMERS: Customer[] = [
  {
    id: 'demo-cust-1',
    name: 'Muhammad Aslam',
    phone: '0300-1234567',
    cnic: '35201-1234567-1',
    creditLimitPaisa: 2500000, // Rs 25,000
    currentBalancePaisa: 420000, // Rs 4,200 due
    address: 'House 14, Street 3, Lahore',
  },
  {
    id: 'demo-cust-2',
    name: 'Dr. Shahida Parveen',
    phone: '0321-9876543',
    cnic: '35202-9876543-2',
    creditLimitPaisa: 5000000, // Rs 50,000
    currentBalancePaisa: 1250000, // Rs 12,500 due
    address: 'City Clinic, Jail Road, Lahore',
  },
  {
    id: 'demo-cust-3',
    name: 'Haji Abdul Rasheed',
    phone: '0333-4567890',
    cnic: '35201-4567890-3',
    creditLimitPaisa: 1500000, // Rs 15,000
    currentBalancePaisa: 0, // Nil
    address: 'Shop 4, Main Bazar',
  },
  {
    id: 'demo-cust-4',
    name: 'Chaudhry Nadeem Akhtar',
    phone: '0302-7654321',
    cnic: '35203-7654321-5',
    creditLimitPaisa: 3000000, // Rs 30,000
    currentBalancePaisa: 890000, // Rs 8,900 due
    address: 'Model Town Block C',
  },
];

export const DEMO_LEDGER_ENTRIES: Record<string, LedgerEntry[]> = {
  'demo-cust-1': [
    {
      id: 'demo-led-1',
      customerId: 'demo-cust-1',
      date: new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10),
      type: 'INVOICE',
      referenceNo: 'INV-2026-0042',
      description: 'Monthly Maintenance Meds (Augmentin, Risek)',
      debitPaisa: 540000,
      creditPaisa: 0,
      runningBalancePaisa: 540000,
    },
    {
      id: 'demo-led-2',
      customerId: 'demo-cust-1',
      date: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
      type: 'PAYMENT',
      referenceNo: 'RCP-8012',
      description: 'Cash received on counter',
      debitPaisa: 0,
      creditPaisa: 300000,
      runningBalancePaisa: 240000,
    },
    {
      id: 'demo-led-3',
      customerId: 'demo-cust-1',
      date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      type: 'INVOICE',
      referenceNo: 'INV-2026-0089',
      description: 'Panadol & Flagyl strips',
      debitPaisa: 180000,
      creditPaisa: 0,
      runningBalancePaisa: 420000,
    },
  ],
  'demo-cust-2': [
    {
      id: 'demo-led-4',
      customerId: 'demo-cust-2',
      date: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10),
      type: 'INVOICE',
      referenceNo: 'INV-2026-0031',
      description: 'Clinic Emergency Tray Stock',
      debitPaisa: 2000000,
      creditPaisa: 0,
      runningBalancePaisa: 2000000,
    },
    {
      id: 'demo-led-5',
      customerId: 'demo-cust-2',
      date: new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10),
      type: 'PAYMENT',
      referenceNo: 'RCP-7994',
      description: 'Online Transfer / Cheque',
      debitPaisa: 0,
      creditPaisa: 750000,
      runningBalancePaisa: 1250000,
    },
  ],
  'demo-cust-4': [
    {
      id: 'demo-led-6',
      customerId: 'demo-cust-4',
      date: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10),
      type: 'INVOICE',
      referenceNo: 'INV-2026-0055',
      description: 'Family Prescription (Surbex Z, CAC-1000, Arinac)',
      debitPaisa: 890000,
      creditPaisa: 0,
      runningBalancePaisa: 890000,
    },
  ],
};

export const DEMO_SALES: CompletedSale[] = [
  {
    id: 'demo-sale-1',
    invoiceNumber: 'INV-2026-0101',
    timestamp: new Date().toISOString(),
    cashierName: 'Ahmad (Admin)',
    customerName: 'Walk-in Customer',
    items: [
      {
        productId: 'DEMO-MED-001',
        productName: 'Panadol 500mg',
        genericName: 'Paracetamol',
        batchId: 'demo-b-pan',
        batchNumber: 'PAN-2601',
        expiryDate: '2027-12-31',
        drugClass: DrugClass.OTC,
        unitName: 'Strip (10 Tabs)',
        unitId: 'unit-pan-strip',
        conversionFactor: 10,
        quantityInUnit: 2,
        mrpPaisaPerUnit: 3500,
        costPaisaPerUnit: 2800,
        discountPercent: 0,
        lineTotalPaisa: 7000,
      },
      {
        productId: 'DEMO-MED-003',
        productName: 'Risek 20mg Capsule',
        genericName: 'Omeprazole',
        batchId: 'demo-b-rsk',
        batchNumber: 'RSK-2618',
        expiryDate: '2027-10-31',
        drugClass: DrugClass.OTC,
        unitName: 'Pack (14 Caps)',
        unitId: 'unit-rsk-pack',
        conversionFactor: 14,
        quantityInUnit: 1,
        mrpPaisaPerUnit: 39200,
        costPaisaPerUnit: 31000,
        discountPercent: 0,
        lineTotalPaisa: 39200,
      },
    ],
    subtotalPaisa: 46200,
    discountPaisa: 1200,
    totalPaisa: 45000, // Rs 450.00
    paymentMethod: PaymentMethod.CASH,
    amountTenderedPaisa: 50000,
    changePaisa: 5000,
  },
  {
    id: 'demo-sale-2',
    invoiceNumber: 'INV-2026-0102',
    timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    cashierName: 'Ahmad (Admin)',
    customerName: 'Dr. Shahida Parveen',
    customerPhone: '0321-9876543',
    customerId: 'demo-cust-2',
    items: [
      {
        productId: 'DEMO-MED-002',
        productName: 'Augmentin 625mg',
        genericName: 'Amoxicillin + Clavulanic Acid',
        batchId: 'demo-b-aug',
        batchNumber: 'AUG-2642',
        expiryDate: '2027-08-31',
        drugClass: DrugClass.RX,
        unitName: 'Pack (14 Tabs)',
        unitId: 'unit-aug-pack',
        conversionFactor: 14,
        quantityInUnit: 2,
        mrpPaisaPerUnit: 48000,
        costPaisaPerUnit: 39000,
        discountPercent: 5,
        lineTotalPaisa: 91200,
      },
      {
        productId: 'DEMO-MED-005',
        productName: 'Arinac Forte',
        genericName: 'Ibuprofen + Pseudoephedrine',
        batchId: 'demo-b-arn',
        batchNumber: 'ARN-2615',
        expiryDate: '2027-11-30',
        drugClass: DrugClass.OTC,
        unitName: 'Strip (10 Tabs)',
        unitId: 'unit-arn-strip',
        conversionFactor: 10,
        quantityInUnit: 3,
        mrpPaisaPerUnit: 3200,
        costPaisaPerUnit: 2500,
        discountPercent: 0,
        lineTotalPaisa: 9600,
      },
    ],
    subtotalPaisa: 105600,
    discountPaisa: 4800,
    totalPaisa: 100800, // Rs 1,008.00
    paymentMethod: PaymentMethod.CREDIT,
    amountTenderedPaisa: 0,
    changePaisa: 0,
  },
  {
    id: 'demo-sale-3',
    invoiceNumber: 'INV-2026-0103',
    timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
    cashierName: 'Ahmad (Admin)',
    customerName: 'Muhammad Aslam',
    customerPhone: '0300-1234567',
    customerId: 'demo-cust-1',
    items: [
      {
        productId: 'DEMO-MED-010',
        productName: 'Surbex Z',
        genericName: 'Zinc + B-Complex + Vitamin C',
        batchId: 'demo-b-sbx',
        batchNumber: 'SBX-2688',
        expiryDate: '2027-11-30',
        drugClass: DrugClass.OTC,
        unitName: 'Bottle (30 Tabs)',
        unitId: 'unit-sbx-btl',
        conversionFactor: 1,
        quantityInUnit: 1,
        mrpPaisaPerUnit: 42000,
        costPaisaPerUnit: 34500,
        discountPercent: 0,
        lineTotalPaisa: 42000,
      },
      {
        productId: 'DEMO-MED-011',
        productName: 'CAC-1000 Plus Effervescent',
        genericName: 'Calcium Lactate + Vitamin C + D3',
        batchId: 'demo-b-cac',
        batchNumber: 'CAC-2604',
        expiryDate: '2027-09-30',
        drugClass: DrugClass.OTC,
        unitName: 'Tube (10 Tabs)',
        unitId: 'unit-cac-tube',
        conversionFactor: 1,
        quantityInUnit: 1,
        mrpPaisaPerUnit: 38000,
        costPaisaPerUnit: 31000,
        discountPercent: 0,
        lineTotalPaisa: 38000,
      },
    ],
    subtotalPaisa: 80000,
    discountPaisa: 0,
    totalPaisa: 80000, // Rs 800.00
    paymentMethod: PaymentMethod.EASYPAISA,
    amountTenderedPaisa: 80000,
    changePaisa: 0,
  },
];

export const DEMO_CASH_TRANSACTIONS: CashTransaction[] = [
  {
    id: 'demo-tx-1',
    time: '09:00 AM',
    type: 'OPENING_FLOAT',
    description: 'Morning Drawer Opening Float',
    amountPaisa: 1500000, // Rs 15,000
    isOutflow: false,
    handledBy: 'Ahmad',
  },
  {
    id: 'demo-tx-2',
    time: '11:20 AM',
    type: 'SALE',
    description: 'POS Bill INV-2026-0101 (Panadol & Risek)',
    amountPaisa: 45000, // Rs 450
    isOutflow: false,
    handledBy: 'Ahmad',
  },
  {
    id: 'demo-tx-3',
    time: '01:45 PM',
    type: 'EXPENSE',
    description: 'Staff Lunch & Tea Voucher',
    amountPaisa: 85000, // Rs 850
    isOutflow: true,
    handledBy: 'Ahmad',
  },
  {
    id: 'demo-tx-4',
    time: '03:10 PM',
    type: 'CREDIT_RECOVERY',
    description: 'Payment from Muhammad Aslam (RCP-8012)',
    amountPaisa: 300000, // Rs 3,000
    isOutflow: false,
    handledBy: 'Ahmad',
  },
];

const DEMO_FLAG_KEY = 'pharma-care.demoDataLoaded';

export function isDemoDataLoadedLocally(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function getDemoCustomers(): Customer[] {
  return DEMO_CUSTOMERS;
}

export function getDemoLedgerEntries(): Record<string, LedgerEntry[]> {
  return DEMO_LEDGER_ENTRIES;
}

export function getDemoSales(): CompletedSale[] {
  return DEMO_SALES;
}

export function getDemoTransactions(): CashTransaction[] {
  return DEMO_CASH_TRANSACTIONS;
}

export function getDemoProducts(): Product[] {
  return DEMO_MEDICINES.map((med) => ({
    id: med.code,
    code: med.code,
    barcode: med.barcode,
    brandName: med.brand_name,
    genericName: med.generic_name,
    strength: med.strength,
    category: med.category,
    company: med.company,
    drugClass: DrugClass[med.drug_class as keyof typeof DrugClass] ?? DrugClass.OTC,
    storageCondition: med.storage_condition,
    rackLocation: med.rack_location,
    minStockAlert: med.min_stock_alert,
    requiresPrescription: med.requires_prescription,
    units: med.units.map((u, uIdx) => ({
      id: `${med.code}-unit-${uIdx}`,
      name: u.name,
      conversionFactor: u.conversion_factor,
      isDefaultSaleUnit: u.is_default_sale_unit,
      pricePerUnitPaisa: u.price_paisa,
    })),
    batches: [
      {
        id: `${med.code}-batch-1`,
        productId: med.code,
        batchNumber: med.batch.batch_number,
        expiryDate: med.batch.expiry_date,
        receivedDate: '2026-03-01',
        costPricePaisa: med.batch.cost_paisa,
        mrpPaisa: med.batch.mrp_paisa,
        quantitySmallestUnit: med.batch.quantity * (med.units.find((u) => u.is_default_sale_unit)?.conversion_factor ?? 1),
        status: BatchStatus.ACTIVE,
        supplierName: DEMO_SUPPLIER.name,
      },
    ],
  }));
}

export function getDemoPosCatalog(): PosCatalogProduct[] {
  return DEMO_MEDICINES.map((med) => {
    const defaultUnit = med.units.find((u) => u.is_default_sale_unit) ?? med.units[0];
    const baseQuantity = med.batch.quantity * defaultUnit.conversion_factor;

    return {
      id: med.code,
      code: med.code,
      barcode: med.barcode,
      brandName: med.brand_name,
      genericName: med.generic_name,
      strength: med.strength,
      category: med.category,
      company: med.company,
      drugClass: DrugClass[med.drug_class as keyof typeof DrugClass] ?? DrugClass.OTC,
      units: med.units.map((u, uIdx) => ({
        id: `${med.code}-u-${uIdx}`,
        name: u.name,
        conversionFactor: u.conversion_factor,
        isDefaultSaleUnit: u.is_default_sale_unit,
        pricePerUnitPaisa: u.price_paisa,
      })),
      batches: [
        {
          id: `${med.code}-b-1`,
          productId: med.code,
          batchNumber: med.batch.batch_number,
          expiryDate: med.batch.expiry_date,
          receivedDate: '2026-03-01',
          quantitySmallestUnit: baseQuantity,
          status: BatchStatus.ACTIVE,
        },
      ],
    };
  });
}

export async function checkDemoDataStatus(): Promise<{ loaded: boolean; count: number }> {
  const localLoaded = isDemoDataLoadedLocally();
  if (!supabase) {
    return { loaded: localLoaded, count: localLoaded ? DEMO_MEDICINES.length : 0 };
  }
  const { data: demoMeds, error } = await supabase
    .from('medicines')
    .select('id, is_active')
    .like('code', 'DEMO-MED-%');
  if (error) throw new Error(`Could not check demo data status: ${error.message}`);
  const activeDemoMeds = (demoMeds ?? []).filter((medicine) => medicine.is_active);
  return { loaded: activeDemoMeds.length > 0, count: activeDemoMeds.length };
}

export async function loadDemoData(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    if (supabase) {
      await ensureDemoMasterData(supabase);

      const { data: existingSuppliers, error: supplierQueryError } = await supabase
        .from('suppliers')
        .select('id, is_active')
        .eq('name', DEMO_SUPPLIER.name)
        .limit(1);
      if (supplierQueryError) throw new Error(`Could not check the demo supplier: ${supplierQueryError.message}`);

      const existingSupplier = existingSuppliers?.[0];
      if (existingSupplier && !existingSupplier.is_active) {
        const { error } = await supabase.rpc('activate_supplier', {
          p_supplier_id: existingSupplier.id,
        });
        if (error) throw new Error(`Could not activate the demo supplier: ${error.message}`);
      }
      if (!existingSupplier) {
        const { error } = await supabase.rpc('save_supplier', {
          p_supplier_id: null,
          p_name: DEMO_SUPPLIER.name,
          p_contact: DEMO_SUPPLIER.contact,
          p_address: DEMO_SUPPLIER.address,
          p_licence_or_tax_number: DEMO_SUPPLIER.licence_or_tax_number,
          p_payment_terms: DEMO_SUPPLIER.payment_terms,
        });
        if (error) throw new Error(`Could not create the demo supplier: ${error.message}`);
      }

      const { data: suppliers, error: supplierReloadError } = await supabase
        .from('suppliers')
        .select('id')
        .eq('name', DEMO_SUPPLIER.name)
        .eq('is_active', true)
        .limit(1);
      if (supplierReloadError) throw new Error(`Could not load the demo supplier: ${supplierReloadError.message}`);
      const supplierId = suppliers?.[0]?.id;
      if (!supplierId) throw new Error('The demo supplier could not be resolved after saving.');

      const { data: existingMeds, error: medicineQueryError } = await supabase
        .from('medicines')
        .select('id, code, is_active')
        .like('code', 'DEMO-MED-%');
      if (medicineQueryError) throw new Error(`Could not check demo medicines: ${medicineQueryError.message}`);

      const medicinesByCode = new Map((existingMeds ?? []).map((medicine) => [medicine.code, medicine]));
      const medicineIds = new Map<string, string>();
      const inactiveIds: string[] = [];
      for (const medicine of DEMO_MEDICINES) {
        const existing = medicinesByCode.get(medicine.code);
        if (existing) {
          medicineIds.set(medicine.code, existing.id);
          if (!existing.is_active) inactiveIds.push(existing.id);
          continue;
        }

        const { data: savedId, error } = await supabase.rpc('save_medicine', {
          p_medicine_id: null,
          p_values: {
            code: medicine.code,
            barcode: medicine.barcode,
            brand_name: medicine.brand_name,
            generic_name: medicine.generic_name,
            strength: medicine.strength,
            category: medicine.category,
            company: medicine.company,
            drug_class: medicine.drug_class,
            storage_condition: medicine.storage_condition,
            rack_location: medicine.rack_location,
            min_stock_alert: medicine.min_stock_alert,
            requires_prescription: medicine.requires_prescription,
            is_active: true,
          },
          p_units: medicine.units.map((unit) => ({
            name: unit.name,
            conversion_factor: unit.conversion_factor,
            is_default_sale_unit: unit.is_default_sale_unit,
            price_paisa: unit.price_paisa,
            barcode: unit.barcode ?? null,
          })),
        });
        if (error) throw new Error(`Could not create ${medicine.brand_name}: ${error.message}`);
        if (typeof savedId !== 'string' || !savedId) {
          throw new Error(`The database did not return an ID for ${medicine.brand_name}.`);
        }
        medicineIds.set(medicine.code, savedId);
      }

      if (inactiveIds.length > 0) {
        const { error } = await supabase.rpc('products_bulk_update', {
          ids: inactiveIds,
          action: 'activate',
          value: '',
        });
        if (error) throw new Error(`Could not activate demo medicines: ${error.message}`);
      }

      const ids = [...medicineIds.values()];
      const { data: units, error: unitQueryError } = await supabase
        .from('medicine_units')
        .select('id, medicine_id, name, is_default_sale_unit')
        .in('medicine_id', ids);
      if (unitQueryError) throw new Error(`Could not load demo sale units: ${unitQueryError.message}`);

      const { data: purchaseCatalog, error: catalogError } = await supabase.rpc('purchase_catalog');
      if (catalogError) throw new Error(`Could not check current demo stock: ${catalogError.message}`);
      if (!Array.isArray(purchaseCatalog)) {
        throw new Error('The purchase catalog returned an invalid response.');
      }
      const stockByMedicine = new Map<string, number>();
      for (const row of purchaseCatalog) {
        if (typeof row !== 'object' || row === null) continue;
        const catalogRow = row as { id?: unknown; stock?: unknown };
        if (typeof catalogRow.id !== 'string') continue;
        const stock = typeof catalogRow.stock === 'number' ? catalogRow.stock : Number(catalogRow.stock);
        if (Number.isFinite(stock)) stockByMedicine.set(catalogRow.id, stock);
      }

      const stockItems = buildDemoStockPurchaseItems(DEMO_MEDICINES, medicineIds, units ?? [], stockByMedicine);

      if (stockItems.length > 0) {
        const { error } = await supabase.rpc('post_purchase', {
          p_supplier_id: supplierId,
          p_invoice_number: null,
          p_purchase_date: new Date().toISOString().slice(0, 10),
          p_paid_paisa: 0,
          p_notes: 'Initial inventory for Pharma Care demo data.',
          p_discount_paisa: 0,
          p_payment_type: 'cash',
          p_items: stockItems,
        });
        if (error) throw new Error(`Could not add initial demo stock: ${error.message}`);
      }
    }

    try {
      localStorage.setItem(DEMO_FLAG_KEY, 'true');
    } catch {
      // The database-backed demo records remain available if local UI preferences cannot be saved.
    }

    dispatchStockChanged();
    dispatchDemoDataChanged();
    return { success: true, count: DEMO_MEDICINES.length };
  } catch (err) {
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : 'Failed to load demo data',
    };
  }
}

export async function removeDemoData(): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  try {
    let deletedCount = 0;

    if (supabase) {
      const { data: demoMeds, error: medsError } = await supabase
        .from('medicines')
        .select('id')
        .like('code', 'DEMO-MED-%');
      if (medsError) throw new Error(medsError.message);

      if (demoMeds?.length) {
        const ids = demoMeds.map((medicine) => medicine.id);
        const { error: bulkError } = await supabase.rpc('products_bulk_update', {
          ids,
          action: 'deactivate',
          value: '',
        });
        if (bulkError) throw new Error(bulkError.message);
        deletedCount = ids.length;
      }

      const { data: suppliers, error: suppliersError } = await supabase
        .from('suppliers')
        .select('id')
        .eq('name', DEMO_SUPPLIER.name)
        .eq('is_active', true)
        .limit(1);
      if (suppliersError) throw new Error(suppliersError.message);

      const demoSupplier = suppliers?.[0];
      if (demoSupplier) {
        const { error: deactivateError } = await supabase.rpc('deactivate_supplier', {
          p_supplier_id: demoSupplier.id,
        });
        if (deactivateError) throw new Error(deactivateError.message);
      }
    }

    try {
      localStorage.removeItem(DEMO_FLAG_KEY);
    } catch {
      // ignore
    }

    dispatchStockChanged();
    dispatchDemoDataChanged();
    return { success: true, deletedCount: supabase ? deletedCount : DEMO_MEDICINES.length };
  } catch (err) {
    return {
      success: false,
      deletedCount: 0,
      error: err instanceof Error ? err.message : 'Failed to remove demo data',
    };
  }
}
