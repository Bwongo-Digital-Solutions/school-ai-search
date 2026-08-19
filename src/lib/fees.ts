import { buildApiUrl, supabase } from './supabase';
import type { UserProfile } from '@/types/auth';

/**
 * The single way to reach POST /api/functions/fees.
 *
 * Every fees action is admin-gated on the identity supplied here, so routing all of them through
 * one helper means no screen can forget to send it. Note that the server trusts this value — it
 * matches the existing update_role convention and is not a security boundary.
 */
export const callFees = async <T>(
  action: string,
  payload: Record<string, unknown>,
  user: UserProfile | null,
): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>('fees', {
    body: {
      action,
      requesterRole: user?.role,
      actorEmail: user?.auth_email,
      actorName: user?.display_name,
      ...payload,
    },
  });

  // The fees endpoint reports refusals and validation failures as { error }, so surface them as
  // exceptions and let each screen's runAction wrapper show the message.
  if (error) throw error;
  return data as T;
};

/** Admin-only fee documents are GETs, so the role rides in the query string. */
export const feeDocumentUrl = (path: string, user: UserProfile | null, params: Record<string, string> = {}) => {
  const search = new URLSearchParams({ requesterRole: user?.role || '', ...params });
  return buildApiUrl(`${path}?${search.toString()}`);
};
