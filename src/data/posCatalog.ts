import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';
import { isPosCatalogResponse, toPosCatalogProducts } from './posCatalogLogic';
import type { PosCatalogProduct } from './posCatalogLogic';

export async function loadPosCatalog(): Promise<PosCatalogProduct[]> {
  if (!supabase) {
    throw new Error(getSupabaseErrorMessage(
      new Error('Supabase is not configured.'),
      'Could not load the POS catalog.',
    ));
  }

  const { data, error } = await supabase.rpc('pos_catalog');
  if (error) {
    throw new Error(getSupabaseErrorMessage(error, 'Could not load the POS catalog.'));
  }
  if (!isPosCatalogResponse(data)) {
    throw new Error(getSupabaseErrorMessage(
      new Error('The POS catalog service returned an invalid response.'),
      'Could not load the POS catalog.',
    ));
  }

  return toPosCatalogProducts(data);
}
