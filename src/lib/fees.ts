import { buildApiUrl, supabase } from './supabase';
import type { UserProfile } from '@/types/auth';

/**
 * The single way to reach POST /api/functions/fees.
 *
 * Every fees action is admin-only, and the server decides that from the session cookie rather than
 * from anything sent here — the `user` argument is kept because callers pass it and it keeps the
 * signature stable, but nothing about identity travels in the body any more.
 */
export const callFees = async <T>(
  action: string,
  payload: Record<string, unknown>,
  user: UserProfile | null,
): Promise<T> => {
  void user;
  const { data, error } = await supabase.functions.invoke<T>('fees', {
    body: { action, ...payload },
  });

  // The fees endpoint reports refusals and validation failures as { error }, so surface them as
  // exceptions and let each screen's runAction wrapper show the message.
  if (error) throw error;
  return data as T;
};

/**
 * Admin-only fee documents are GETs opened as ordinary links, which carry the session cookie
 * (SameSite=Lax), so the server gates them the same way it gates everything else.
 */
export const feeDocumentUrl = (path: string, user: UserProfile | null, params: Record<string, string> = {}) => {
  void user;
  const search = new URLSearchParams(params);
  const query = search.toString();
  return buildApiUrl(query ? `${path}?${query}` : path);
};
