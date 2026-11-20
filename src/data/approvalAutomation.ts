import { supabase } from '../utils/supabase';

export interface ApprovalAutomationSettings {
  autoApprovePrintRequests: boolean;
  autoProcessReturns: boolean;
}

export function parseApprovalAutomationSettings(value: unknown): ApprovalAutomationSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned invalid approval automation settings.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.autoApprovePrintRequests !== 'boolean'
    || typeof record.autoProcessReturns !== 'boolean') {
    throw new Error('The server returned invalid approval automation settings.');
  }
  return {
    autoApprovePrintRequests: record.autoApprovePrintRequests,
    autoProcessReturns: record.autoProcessReturns,
  };
}

export async function loadApprovalAutomationSettings(): Promise<ApprovalAutomationSettings> {
  if (!supabase) throw new Error('Supabase is not configured; approval automation is unavailable.');
  const { data, error } = await supabase.rpc('get_approval_automation_settings');
  if (error) throw new Error(`Could not load approval automation settings: ${error.message}`);
  return parseApprovalAutomationSettings(data);
}

export async function updateApprovalAutomationSettings(
  settings: ApprovalAutomationSettings,
): Promise<ApprovalAutomationSettings> {
  if (!supabase) throw new Error('Supabase is not configured; approval automation is unavailable.');
  const { data, error } = await supabase.rpc('update_approval_automation_settings', {
    p_auto_approve_print_requests: settings.autoApprovePrintRequests,
    p_auto_process_returns: settings.autoProcessReturns,
  });
  if (error) throw new Error(`Could not save approval automation settings: ${error.message}`);
  return parseApprovalAutomationSettings(data);
}
