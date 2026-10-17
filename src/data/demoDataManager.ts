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
  name: 'Premier Distributors Ltd',
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
  try {
    const { data: demoMeds, error } = await supabase
      .from('medicines')
      .select('id, is_active')
      .like('code', 'DEMO-%');

    if (error || !demoMeds) {
      return { loaded: localLoaded, count: localLoaded ? DEMO_MEDICINES.length : 0 };
    }

    const activeDemoMeds = demoMeds.filter((m) => m.is_active);
    const hasData = activeDemoMeds.length > 0 || localLoaded;
    return { loaded: hasData, count: activeDemoMeds.length || (localLoaded ? DEMO_MEDICINES.length : 0) };
  } catch {
    return { loaded: localLoaded, count: localLoaded ? DEMO_MEDICINES.length : 0 };
  }
}

export async function loadDemoData(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let createdCount = 0;

    if (supabase) {
      // 1. Ensure Demo Supplier exists and is active
      try {
        const { data: existingSuppliers } = await supabase
          .from('suppliers')
          .select('id, is_active')
          .eq('name', DEMO_SUPPLIER.name)
          .limit(1);

        if (existingSuppliers && existingSuppliers.length > 0) {
          if (!existingSuppliers[0].is_active) {
            await supabase.rpc('activate_supplier', { p_supplier_id: existingSuppliers[0].id });
          }
        } else {
          await supabase.rpc('save_supplier', {
            p_supplier_id: null,
            p_name: DEMO_SUPPLIER.name,
            p_contact: DEMO_SUPPLIER.contact,
            p_address: DEMO_SUPPLIER.address,
            p_licence_or_tax_number: DEMO_SUPPLIER.licence_or_tax_number,
            p_payment_terms: DEMO_SUPPLIER.payment_terms,
          });
        }
      } catch (e) {
        console.warn('Could not insert or activate demo supplier in Supabase:', e);
      }

      // 2. Reactivate existing demo medicines in DB or insert them
      try {
        const { data: existingMeds } = await supabase
          .from('medicines')
          .select('id, code, is_active')
          .like('code', 'DEMO-%');

        if (existingMeds && existingMeds.length > 0) {
          const inactiveIds = existingMeds.filter((m) => !m.is_active).map((m) => m.id);
          if (inactiveIds.length > 0) {
            await supabase.rpc('products_bulk_update', {
              ids: inactiveIds,
              action: 'activate',
              value: '',
            });
          }
          createdCount = existingMeds.length;
        } else {
          // If none exist in DB, create them via save_medicine RPC
          for (const med of DEMO_MEDICINES) {
            try {
              const { data: savedId } = await supabase.rpc('save_medicine', {
                p_medicine_id: null,
                p_values: {
                  code: med.code,
                  barcode: med.barcode,
                  brand_name: med.brand_name,
                  generic_name: med.generic_name,
                  strength: med.strength,
                  category: med.category,
                  company: med.company,
                  drug_class: med.drug_class,
                  storage_condition: med.storage_condition,
                  rack_location: med.rack_location,
                  min_stock_alert: med.min_stock_alert,
                  requires_prescription: med.requires_prescription,
                  is_active: true,
                },
                p_units: med.units.map((u) => ({
                  name: u.name,
                  conversion_factor: u.conversion_factor,
                  is_default_sale_unit: u.is_default_sale_unit,
                  price_paisa: u.price_paisa,
                  barcode: u.barcode ?? null,
                })),
              });
              if (savedId) createdCount++;
            } catch (insErr) {
              console.warn(`Failed to insert demo medicine ${med.code}:`, insErr);
            }
          }
        }
      } catch (medErr) {
        console.warn('Could not ensure demo medicines in Supabase:', medErr);
      }
    }

    try {
      localStorage.setItem(DEMO_FLAG_KEY, 'true');
    } catch {
      // ignore
    }

    dispatchStockChanged();
    dispatchDemoDataChanged();
    return { success: true, count: createdCount || DEMO_MEDICINES.length };
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
      // 1. Find demo medicine IDs in DB
      try {
        const { data: demoMeds } = await supabase
          .from('medicines')
          .select('id')
          .like('code', 'DEMO-%');

        if (demoMeds && demoMeds.length > 0) {
          const ids = demoMeds.map((m) => m.id);

          // Use the authorized SECURITY DEFINER RPC products_bulk_update to deactivate demo medicines
          const { error: bulkErr } = await supabase.rpc('products_bulk_update', {
            ids,
            action: 'deactivate',
            value: '',
          });

          if (!bulkErr) {
            deletedCount = ids.length;
          } else {
            // Fallback attempt direct delete if table permissions permit
            const { error: delErr } = await supabase.from('medicines').delete().in('id', ids);
            if (!delErr) deletedCount = ids.length;
          }
        }
      } catch (medErr) {
        console.warn('Demo medicine deactivation warning:', medErr);
      }

      // 2. Deactivate demo supplier
      try {
        const { data: sups } = await supabase
          .from('suppliers')
          .select('id, is_active')
          .eq('name', DEMO_SUPPLIER.name)
          .eq('is_active', true)
          .limit(1);

        if (sups && sups.length > 0) {
          await supabase.rpc('deactivate_supplier', { p_supplier_id: sups[0].id });
        }
      } catch (supErr) {
        console.warn('Demo supplier deactivation warning:', supErr);
      }
    }

    try {
      localStorage.removeItem(DEMO_FLAG_KEY);
    } catch {
      // ignore
    }

    dispatchStockChanged();
    dispatchDemoDataChanged();
    return { success: true, deletedCount: deletedCount || DEMO_MEDICINES.length };
  } catch (err) {
    return {
      success: false,
      deletedCount: 0,
      error: err instanceof Error ? err.message : 'Failed to remove demo data',
    };
  }
}
