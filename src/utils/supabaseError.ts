type ErrorDetails = {
  code?: unknown;
  message?: unknown;
};

export function getSupabaseErrorMessage(error: unknown, fallback: string): string {
  const details: ErrorDetails = error && typeof error === 'object'
    ? error as ErrorDetails
    : {};
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';
  const detail = message ? ` Details: ${message}` : '';

  if (code === 'PGRST205' || code === '42P01') {
    return `A required database table is missing or unavailable in the API schema. Apply the pending database migrations and refresh the Supabase API schema.${detail}`;
  }
  if (code === 'PGRST202' || code === '42883') {
    return `A required database function is missing or unavailable in the API schema. Apply the pending database migrations and refresh the Supabase API schema.${detail}`;
  }
  if (code === '42703') {
    return `The database is missing a column required by this page. Apply the pending database migrations.${detail}`;
  }
  if (code === '42501') {
    return `Supabase denied this request. Check the signed-in user's active status, module permissions, and database policies.${detail}`;
  }

  return message || (error instanceof Error ? error.message : fallback);
}
