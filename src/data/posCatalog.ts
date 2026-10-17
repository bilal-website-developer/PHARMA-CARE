import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';
import { isPosCatalogResponse, toPosCatalogProducts, type PosCatalogProduct } from './posCatalogLogic';
import { isDemoDataLoadedLocally, getDemoPosCatalog } from './demoDataManager';
import { BatchStatus, DrugClass } from '../types/pharmacy';

export async function loadPosCatalog(): Promise<PosCatalogProduct[]> {
  const isDemoActive = isDemoDataLoadedLocally();

  if (!supabase) {
    return getDemoPosCatalog();
  }

  try {
    const { data, error } = await supabase.rpc('pos_catalog');

    let liveProducts: PosCatalogProduct[] = [];
    if (!error && isPosCatalogResponse(data)) {
      liveProducts = toPosCatalogProducts(data);
    }

    // If pos_catalog() returned empty (e.g. medicines in DB lack medicine_units rows),
    // query medicines directly and synthesize default units for items with available stock
    if (liveProducts.length === 0) {
      try {
        const { data: dbMeds } = await supabase
          .from('medicines')
          .select(`
            id, code, barcode, brand_name, generic_name, strength, category, company, drug_class,
            stock_batches (id, batch_number, expiry_date, received_date, quantity_remaining, status, mrp_paisa),
            medicine_units (id, name, conversion_factor, is_default_sale_unit, price_paisa)
          `)
          .eq('is_active', true);

        if (dbMeds && dbMeds.length > 0) {
          const today = new Date().toISOString().slice(0, 10);
          const synthesized: PosCatalogProduct[] = [];

          for (const m of dbMeds as any[]) {
            const rawBatches = Array.isArray(m.stock_batches) ? m.stock_batches : [];
            const validBatches = rawBatches.filter(
              (b: any) =>
                b &&
                typeof b.quantity_remaining === 'number' &&
                b.quantity_remaining > 0 &&
                (!b.expiry_date || b.expiry_date >= today) &&
                (!b.status || b.status === 'ACTIVE' || b.status === 'NEAR_EXPIRY')
            );

            if (validBatches.length === 0) continue;

            const rawUnits = Array.isArray(m.medicine_units) ? m.medicine_units : [];
            let units = rawUnits.map((u: any) => ({
              id: u.id,
              name: u.name,
              conversionFactor: u.conversion_factor || 1,
              isDefaultSaleUnit: Boolean(u.is_default_sale_unit),
              pricePerUnitPaisa: u.price_paisa || 0,
            }));

            // If no units configured in database, synthesize a default 1-Pack unit from batch MRP
            if (units.length === 0) {
              const defaultMrp = validBatches[0]?.mrp_paisa ?? 1000;
              units = [
                {
                  id: `${m.id}-default-unit`,
                  name: 'Pack',
                  conversionFactor: 1,
                  isDefaultSaleUnit: true,
                  pricePerUnitPaisa: defaultMrp,
                },
              ];
            } else if (!units.some((u: any) => u.isDefaultSaleUnit)) {
              units[0].isDefaultSaleUnit = true;
            }

            synthesized.push({
              id: m.id,
              code: m.code,
              barcode: m.barcode || null,
              brandName: m.brand_name,
              genericName: m.generic_name || '',
              strength: m.strength || null,
              category: m.category || 'General',
              company: m.company || 'Unknown',
              drugClass: (m.drug_class as DrugClass) || DrugClass.OTC,
              units,
              batches: validBatches.map((b: any) => ({
                id: b.id,
                productId: m.id,
                batchNumber: b.batch_number || 'BATCH-1',
                expiryDate: b.expiry_date || '2027-12-31',
                receivedDate: b.received_date || today,
                quantitySmallestUnit: b.quantity_remaining,
                status: (b.status as BatchStatus.ACTIVE) || BatchStatus.ACTIVE,
              })),
            });
          }

          if (synthesized.length > 0) {
            liveProducts = synthesized;
          }
        }
      } catch (fallbackErr) {
        console.warn('Direct catalog query fallback failed:', fallbackErr);
      }
    }

    // Always merge demo products if demo is active OR if live catalog is completely empty
    if (isDemoActive || liveProducts.length === 0) {
      const demoProducts = getDemoPosCatalog();
      const liveCodes = new Set(liveProducts.map((p) => p.code));
      const missingDemo = demoProducts.filter((dp) => !liveCodes.has(dp.code));
      return [...liveProducts, ...missingDemo];
    }

    return liveProducts;
  } catch (err) {
    return getDemoPosCatalog();
  }
}
