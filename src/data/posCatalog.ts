import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';
import { isPosCatalogResponse, toPosCatalogProducts, type PosCatalogProduct } from './posCatalogLogic';
import { getDemoPosCatalog } from './demoDataManager';

export async function loadPosCatalog(): Promise<PosCatalogProduct[]> {
  if (!supabase) {
    return getDemoPosCatalog();
  }

  try {
    const { data, error } = await supabase.rpc('pos_catalog');
    if (error) throw error;
    if (!isPosCatalogResponse(data)) {
      throw new Error('The POS catalog service returned an invalid response.');
    }

    return toPosCatalogProducts(data);
  } catch (err) {
    throw new Error(getSupabaseErrorMessage(err, 'Could not load the POS catalog.'));
  }
}
