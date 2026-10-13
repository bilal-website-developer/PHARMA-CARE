import { getSupabaseErrorMessage } from '../utils/supabaseError';
import { supabase } from '../utils/supabase';
import { isStockAlertsSummary, type StockAlertsSummary } from './stockAlertLogic';

export async function loadStockAlertsSummary(limit = 50): Promise<StockAlertsSummary> {
  if (!supabase) {
    throw new Error(getSupabaseErrorMessage(new Error('Supabase is not configured.'), 'Could not load stock alerts.'));
  }

  const { data, error } = await supabase.rpc('stock_alerts_summary', { p_limit: limit });
  if (error) {
    throw new Error(getSupabaseErrorMessage(error, 'Could not load stock alerts.'));
  }
  if (!isStockAlertsSummary(data)) {
    throw new Error(getSupabaseErrorMessage(
      new Error('The stock alerts service returned an invalid response.'),
      'Could not load stock alerts.',
    ));
  }
  return data;
}
