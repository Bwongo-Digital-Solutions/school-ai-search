import { buildApiUrl, supabase } from './supabase';
import type { UserProfile } from '@/types/auth';
import type { CurriculumFramework } from '@/types/teaching';

/**
 * The single way to reach the teaching endpoints — lesson planner, digital examiner, curriculum
 * library and MCP registry.
 *
 * Each of those is role-gated on the identity supplied here, so routing every call through one
 * helper means no screen can forget to send it. As with callFees, the server trusts this value: it
 * follows the existing convention rather than being a security boundary of its own.
 */
const callTeachingFunction = async <T>(
  endpoint: string,
  action: string,
  payload: Record<string, unknown>,
  user: UserProfile | null,
): Promise<T> => {
  const { data, error } = await supabase.functions.invoke<T>(endpoint, {
    body: {
      action,
      requesterRole: user?.role,
      actorEmail: user?.auth_email,
      actorName: user?.display_name,
      ...payload,
    },
  });

  // These endpoints report refusals and validation failures as { error }; surface them as
  // exceptions so each screen's runAction wrapper shows the message.
  if (error) throw error;
  return data as T;
};

export const callLessonPlanner = <T>(
  action: string,
  payload: Record<string, unknown>,
  user: UserProfile | null,
) => callTeachingFunction<T>('lesson-planner', action, payload, user);

export const callDigitalExaminer = <T>(
  action: string,
  payload: Record<string, unknown>,
  user: UserProfile | null,
) => callTeachingFunction<T>('digital-examiner', action, payload, user);

export const callCurriculum = <T>(
  action: string,
  payload: Record<string, unknown>,
  user: UserProfile | null,
) => callTeachingFunction<T>('curriculum', action, payload, user);

export const callMcp = <T>(action: string, payload: Record<string, unknown>, user: UserProfile | null) =>
  callTeachingFunction<T>('mcp', action, payload, user);

/** Teaching documents are GETs, so the role rides in the query string, as the fee documents do. */
export const teachingDocumentUrl = (path: string, user: UserProfile | null) => {
  const search = new URLSearchParams({ requesterRole: user?.role || '' });
  return buildApiUrl(`${path}?${search.toString()}`);
};

/**
 * The examination frameworks the school supports. A plain GET with no body, cached for the session
 * because the catalogue is static configuration, not data.
 */
let frameworkCache: CurriculumFramework[] | null = null;

export const loadCurriculumFrameworks = async (): Promise<CurriculumFramework[]> => {
  if (frameworkCache) return frameworkCache;

  try {
    const response = await fetch(buildApiUrl('/api/curriculum-frameworks'));
    if (!response.ok) return [];

    const json = await response.json();
    frameworkCache = json?.data?.frameworks || [];
    return frameworkCache;
  } catch {
    // A missing catalogue leaves the pickers empty rather than breaking the screen.
    return [];
  }
};

/** Maps a numeric grade level onto the year label a framework uses (grade 10 → "S3" or "Year 10"). */
export const yearLabelFor = (framework: CurriculumFramework | undefined, gradeLevel: number | null) => {
  if (!framework || gradeLevel == null || framework.yearLabels.length === 0) {
    return gradeLevel == null ? '' : `Grade ${gradeLevel}`;
  }

  const index = gradeLevel - framework.startGrade;
  const clamped = Math.min(Math.max(index, 0), framework.yearLabels.length - 1);
  return framework.yearLabels[clamped];
};

/** Grade options labelled the way the chosen framework names its years. */
export const gradeOptionsFor = (framework: CurriculumFramework | undefined) => {
  if (!framework) {
    return Array.from({ length: 13 }, (_, index) => ({
      value: String(index + 1),
      label: `Grade ${index + 1}`,
    }));
  }

  return framework.yearLabels.map((label, index) => ({
    value: String(framework.startGrade + index),
    label,
  }));
};
