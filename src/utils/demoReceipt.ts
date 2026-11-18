export const DEMO_RECEIPTS_PATH = '/demo/receipts';

export interface DemoReceiptLine {
  name: string;
  unit: string;
  quantity: number;
  pricePaisa: number;
  lineTotalPaisa: number;
  returnStatus: 'not_returned' | 'partially_returned' | 'returned';
}

export interface DemoReceipt {
  invoiceNumber: string;
  dateTime: string;
  status: string;
  items: DemoReceiptLine[];
  discountPaisa: number;
  totalPaisa: number;
  paidPaisa: number;
  changePaisa: number;
  creditDuePaisa: number | null;
}

export const DEMO_RECEIPTS: readonly DemoReceipt[] = [
  {
    invoiceNumber: 'DEMO-INV-1042',
    dateTime: '18 Nov 2026, 10:30 AM',
    status: 'Paid',
    items: [
      { name: 'Paracetamol 500 mg', unit: 'Strip', quantity: 2, pricePaisa: 8500, lineTotalPaisa: 17000, returnStatus: 'not_returned' },
      { name: 'Vitamin C 500 mg', unit: 'Bottle', quantity: 1, pricePaisa: 32000, lineTotalPaisa: 32000, returnStatus: 'not_returned' },
    ],
    discountPaisa: 2000,
    totalPaisa: 47000,
    paidPaisa: 50000,
    changePaisa: 3000,
    creditDuePaisa: null,
  },
  {
    invoiceNumber: 'DEMO-INV-1041',
    dateTime: '18 Nov 2026, 09:45 AM',
    status: 'Credit',
    items: [
      { name: 'Cough Syrup 120 ml', unit: 'Bottle', quantity: 1, pricePaisa: 18500, lineTotalPaisa: 18500, returnStatus: 'not_returned' },
      { name: 'Oral Rehydration Salts', unit: 'Sachet', quantity: 4, pricePaisa: 2500, lineTotalPaisa: 10000, returnStatus: 'not_returned' },
    ],
    discountPaisa: 0,
    totalPaisa: 28500,
    paidPaisa: 10000,
    changePaisa: 0,
    creditDuePaisa: 18500,
  },
  {
    invoiceNumber: 'DEMO-INV-1038',
    dateTime: '17 Nov 2026, 04:15 PM',
    status: 'Partially returned',
    items: [
      { name: 'Antacid Tablets', unit: 'Pack', quantity: 2, pricePaisa: 12500, lineTotalPaisa: 25000, returnStatus: 'partially_returned' },
      { name: 'Adhesive Bandages', unit: 'Box', quantity: 1, pricePaisa: 9000, lineTotalPaisa: 9000, returnStatus: 'not_returned' },
    ],
    discountPaisa: 1000,
    totalPaisa: 33000,
    paidPaisa: 33000,
    changePaisa: 0,
    creditDuePaisa: null,
  },
];

export function buildDemoReceiptUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('The demo receipt URL needs a valid website address.');
  }
  const isLocalHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if ((!isLocalHttp && url.protocol !== 'https:')
    || url.username || url.password || url.search || url.hash) {
    throw new Error('The demo receipt URL must use an HTTPS website address.');
  }
  return `${url.origin}${DEMO_RECEIPTS_PATH}`;
}
