import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Supabase URL or Key not found in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key);

const DEMO_SUPPLIER = {
  name: 'Premier Distributors Ltd',
  contact: '021-35681234 / 0300-8201122',
  address: 'Plot 45, Sector 15, Korangi Industrial Area, Karachi',
  licence_or_tax_number: '3049281-7 / DTL-KHI-8891',
  payment_terms: '30 Days Credit',
  is_active: true,
};

const DEMO_MEDICINES = [
  {
    code: 'DEMO-MED-001',
    barcode: '8964000100011',
    brand_name: 'Panadol 500mg',
    generic_name: 'Paracetamol',
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
    batch: { batch_number: 'PAN-2601', expiry_date: '2027-12-31', cost_paisa: 2800, mrp_paisa: 3500, quantity: 120 },
  },
  {
    code: 'DEMO-MED-002',
    barcode: '8964000100028',
    brand_name: 'Augmentin 625mg',
    generic_name: 'Amoxicillin + Clavulanic Acid',
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
    batch: { batch_number: 'AUG-2642', expiry_date: '2027-08-31', cost_paisa: 39000, mrp_paisa: 48000, quantity: 25 },
  },
  {
    code: 'DEMO-MED-003',
    barcode: '8964000100035',
    brand_name: 'Risek 20mg Capsule',
    generic_name: 'Omeprazole',
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
    batch: { batch_number: 'RSK-2618', expiry_date: '2027-10-31', cost_paisa: 31000, mrp_paisa: 39200, quantity: 30 },
  },
  {
    code: 'DEMO-MED-004',
    barcode: '8964000100042',
    brand_name: 'Brufen 400mg',
    generic_name: 'Ibuprofen',
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
    batch: { batch_number: 'BRU-2609', expiry_date: '2027-09-30', cost_paisa: 3700, mrp_paisa: 4600, quantity: 60 },
  },
  {
    code: 'DEMO-MED-005',
    barcode: '8964000100059',
    brand_name: 'Arinac Forte',
    generic_name: 'Ibuprofen + Pseudoephedrine',
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
    batch: { batch_number: 'ARN-2615', expiry_date: '2027-11-30', cost_paisa: 2500, mrp_paisa: 3200, quantity: 50 },
  },
  {
    code: 'DEMO-MED-006',
    barcode: '8964000100066',
    brand_name: 'Flagyl 400mg',
    generic_name: 'Metronidazole',
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
    batch: { batch_number: 'FLA-2670', expiry_date: '2027-06-30', cost_paisa: 3500, mrp_paisa: 4400, quantity: 80 },
  },
  {
    code: 'DEMO-MED-007',
    barcode: '8964000100073',
    brand_name: 'Disprin 300mg Soluble',
    generic_name: 'Aspirin (Soluble)',
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
    batch: { batch_number: 'DSP-2611', expiry_date: '2027-07-31', cost_paisa: 2800, mrp_paisa: 3500, quantity: 90 },
  },
  {
    code: 'DEMO-MED-008',
    barcode: '8964000100080',
    brand_name: 'Ponstan Forte 500mg',
    generic_name: 'Mefenamic Acid',
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
    batch: { batch_number: 'PON-2655', expiry_date: '2027-12-31', cost_paisa: 4400, mrp_paisa: 5500, quantity: 45 },
  },
  {
    code: 'DEMO-MED-009',
    barcode: '8964000100097',
    brand_name: 'Gravinate 50mg',
    generic_name: 'Dimenhydrinate',
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
    batch: { batch_number: 'GRV-2620', expiry_date: '2027-05-31', cost_paisa: 2200, mrp_paisa: 2800, quantity: 40 },
  },
  {
    code: 'DEMO-MED-010',
    barcode: '8964000100103',
    brand_name: 'Surbex Z',
    generic_name: 'Zinc + B-Complex + Vitamin C',
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
    batch: { batch_number: 'SBX-2688', expiry_date: '2027-11-30', cost_paisa: 34500, mrp_paisa: 42000, quantity: 35 },
  },
  {
    code: 'DEMO-MED-011',
    barcode: '8964000100110',
    brand_name: 'CAC-1000 Plus Effervescent',
    generic_name: 'Calcium Lactate + Vitamin C + D3',
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
    batch: { batch_number: 'CAC-2604', expiry_date: '2027-09-30', cost_paisa: 31000, mrp_paisa: 38000, quantity: 40 },
  },
  {
    code: 'DEMO-MED-012',
    barcode: '8964000100127',
    brand_name: 'Softin 10mg',
    generic_name: 'Loratadine',
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
    batch: { batch_number: 'SFT-2633', expiry_date: '2027-10-31', cost_paisa: 17500, mrp_paisa: 22000, quantity: 50 },
  },
];

async function seed() {
  console.log('Seeding demo data into Supabase...');

  // 1. Supplier
  let supplierId = null;
  const { data: existingSup } = await supabase.from('suppliers').select('id').eq('name', DEMO_SUPPLIER.name).limit(1);
  if (existingSup && existingSup.length > 0) {
    supplierId = existingSup[0].id;
    console.log('Supplier already exists:', supplierId);
  } else {
    const { data: newSup, error: supErr } = await supabase.from('suppliers').insert(DEMO_SUPPLIER).select('id').single();
    if (supErr) console.error('Supplier insert error:', supErr.message);
    else {
      supplierId = newSup.id;
      console.log('Created supplier:', supplierId);
    }
  }

  // 2. Medicines + Units + Batches
  for (const med of DEMO_MEDICINES) {
    let medicineId = null;
    const { data: existingMed } = await supabase.from('medicines').select('id').eq('code', med.code).limit(1);
    if (existingMed && existingMed.length > 0) {
      medicineId = existingMed[0].id;
      console.log(`Medicine ${med.brand_name} already exists:`, medicineId);
    } else {
      const { data: newMed, error: medErr } = await supabase.from('medicines').insert({
        code: med.code,
        barcode: med.barcode,
        brand_name: med.brand_name,
        generic_name: med.generic_name,
        category: med.category,
        company: med.company,
        drug_class: med.drug_class,
        storage_condition: med.storage_condition,
        rack_location: med.rack_location,
        min_stock_alert: med.min_stock_alert,
        requires_prescription: med.requires_prescription,
        is_active: true,
      }).select('id').single();

      if (medErr) {
        console.error(`Error inserting ${med.code}:`, medErr.message);
        continue;
      }
      medicineId = newMed.id;
      console.log(`Created medicine ${med.brand_name}:`, medicineId);

      // Units
      const unitsToInsert = med.units.map((u) => ({
        medicine_id: medicineId,
        name: u.name,
        conversion_factor: u.conversion_factor,
        is_default_sale_unit: u.is_default_sale_unit,
        price_paisa: u.price_paisa,
      }));
      const { error: unitsErr } = await supabase.from('medicine_units').insert(unitsToInsert);
      if (unitsErr) console.error(`Error inserting units for ${med.code}:`, unitsErr.message);
    }

    // Batches
    if (medicineId) {
      const { data: existingBatches } = await supabase.from('stock_batches').select('id').eq('medicine_id', medicineId).limit(1);
      if (!existingBatches || existingBatches.length === 0) {
        const defaultUnit = med.units.find((u) => u.is_default_sale_unit) ?? med.units[0];
        const baseQty = med.batch.quantity * defaultUnit.conversion_factor;
        const costPerBase = Math.round(med.batch.cost_paisa / defaultUnit.conversion_factor);
        const mrpPerBase = Math.round(med.batch.mrp_paisa / defaultUnit.conversion_factor);

        const { error: batchErr } = await supabase.from('stock_batches').insert({
          medicine_id: medicineId,
          supplier_id: supplierId,
          batch_number: med.batch.batch_number,
          expiry_date: med.batch.expiry_date,
          received_date: new Date().toISOString().slice(0, 10),
          cost_paisa_per_base_unit: costPerBase,
          mrp_paisa_per_base_unit: mrpPerBase,
          quantity_received: baseQty,
          quantity_remaining: baseQty,
          status: 'ACTIVE',
        });
        if (batchErr) console.error(`Batch insert error for ${med.code}:`, batchErr.message);
        else console.log(`Created batch for ${med.brand_name} with ${baseQty} base units`);
      }
    }
  }

  console.log('Seeding completed successfully!');
}

seed().catch(console.error);
