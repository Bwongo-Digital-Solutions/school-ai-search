/**
 * One student, whole — the screen a search result opens onto.
 *
 * Everything the school holds about a child in one place: who they are, whose they are, what they
 * have scored, how often they have been in, what has been paid, and every movement through the
 * school from admission to transfer. Somebody at a desk with a parent in front of them should not
 * have to visit five screens to answer a question about one student.
 *
 * What comes back depends on who is asking, and the filtering happens here rather than in the
 * browser. A section a role may not see is not queried at all, so its data never reaches the page
 * to be hidden by a stylesheet — a bursar's copy of this response simply has no discipline record
 * in it, and a teacher's has no payment history.
 *
 * The section policy is deliberately borrowed from scan-profiles.mjs rather than restated. That
 * module already answers "what may this profile see of a student", and it is answered once: two
 * lists that were supposed to agree would eventually stop agreeing.
 */
import { requireRole, resolveActor } from '../auth/actor.mjs';
import { ALL_STAFF_ROLES, TEACHING_ROLES } from '../auth/roles.mjs';
import { normaliseProfile, profileLabel, sectionsFor } from './scan-profiles.mjs';
import { loadReportData } from './student-report.mjs';
import { clubsForStudent } from './clubs.mjs';
import { requirementsForStudent } from './requirements.mjs';
import { dormitoryForStudent } from './matron.mjs';

/**
 * Sections this screen adds beyond the ones a scan can show.
 *
 * A scan happens at a gate or a dining hall and is about the next thirty seconds; this is the
 * office looking at a child's whole history, which is a different question and reaches further.
 * Both are still narrower for some roles than for others: a child's disciplinary record is the
 * business of the people who teach and run the school, and of nobody else who happens to have an
 * account here.
 */
const EXTRA_SECTIONS = {
  discipline: TEACHING_ROLES,
  // Admission, promotions and transfers — the student's passage through the school.
  movements: [...TEACHING_ROLES, 'accountant', 'bursar'],
};

const isoDay = (value) => (value ? String(value).slice(0, 10) : null);

const sectionsForSummary = (role, designation) => {
  const base = sectionsFor(role, designation);
  const extra = Object.entries(EXTRA_SECTIONS)
    .filter(([, roles]) => roles.includes(role))
    .map(([section]) => section);
  return [...base, ...extra];
};

const loadStudent = async (database, code) => {
  const { rows } = await database.query(
    'SELECT * FROM students WHERE UPPER(student_id) = UPPER($1) OR id = $1 LIMIT 1',
    [String(code ?? '').trim()],
  );
  return rows[0] || null;
};

/**
 * Build the summary for one student, as one caller may see it.
 *
 * Exported separately from the route handler so the agent tools and the PDF route can reuse it
 * without going through a dispatcher, which is how fees.mjs's ledger is already reused.
 */
export const buildStudentSummary = async (database, { code, role, designation }) => {
  const student = await loadStudent(database, code);
  if (!student) return { error: 'No student matches that ID' };

  const profile = normaliseProfile(role, designation);
  const sections = sectionsForSummary(profile.role, profile.designation);
  const wants = (section) => sections.includes(section);

  // The academic and financial picture, from the same loader the parent report is built on, so a
  // figure on this screen and a figure on that PDF cannot disagree.
  const report = await loadReportData(database, student);

  const [
    discipline,
    admissions,
    promotions,
    transfers,
    attendanceLog,
    clubs,
    requirements,
    dormitory,
  ] = await Promise.all([
    wants('discipline')
      ? database.query(
          `SELECT id, incident_date, category, severity, description, action_taken, reported_by,
                  guardian_notified, status
           FROM discipline_records WHERE student_id = $1 ORDER BY incident_date DESC`,
          [student.id],
        )
      : null,
    wants('movements')
      ? database.query(
          `SELECT id, application_number, grade_level, status, submitted_at, notes
           FROM admissions WHERE student_id = $1 ORDER BY submitted_at DESC`,
          [student.id],
        )
      : null,
    wants('movements')
      ? database.query(
          `SELECT id, from_grade_level, from_class_section, to_grade_level, to_class_section,
                  academic_year, effective_date, decision, notes, approved_by
           FROM student_promotions WHERE student_id = $1 ORDER BY effective_date DESC`,
          [student.id],
        )
      : null,
    wants('movements')
      ? database.query(
          `SELECT id, movement_type, effective_date, destination_school, reason, status, processed_by
           FROM student_transfers WHERE student_id = $1 ORDER BY effective_date DESC`,
          [student.id],
        )
      : null,
    // The register itself, not just the rate — "which days" is usually the actual question.
    wants('attendance')
      ? database.query(
          `SELECT attendance_date, status, reason FROM attendance_records
           WHERE student_id = $1 ORDER BY attendance_date DESC LIMIT 60`,
          [student.id],
        )
      : null,
    // A child's life outside the classroom. The same three functions the ID-scan card reads, so a
    // club shown at the gate and a club shown in the office are the same club.
    wants('clubs') ? clubsForStudent(database, student.id) : null,
    // The third argument is destructured, so it has to be passed even when empty — the term and
    // year then default to the current ones inside.
    wants('requirements') ? requirementsForStudent(database, student, {}) : null,
    wants('dormitory') ? dormitoryForStudent(database, student.id) : null,
  ]);

  const summary = {
    profile: { ...profile, label: profileLabel(profile.role, profile.designation) },
    sections,
    student: {
      id: student.id,
      student_id: student.student_id,
      full_name: `${student.first_name} ${student.last_name}`,
      first_name: student.first_name,
      last_name: student.last_name,
      grade_level: student.grade_level,
      class_section: student.class_section,
      status: student.status,
      lifecycle_status: student.lifecycle_status,
      photo_url: student.photo_url || '',
      gpa: student.gpa,
      attendance_rate: student.attendance_rate,
    },
  };

  if (wants('bio')) {
    summary.bio = {
      date_of_birth: isoDay(student.date_of_birth),
      gender: student.gender,
      blood_group: student.blood_group,
      address: student.address,
      email: student.email,
      phone: student.phone,
      enrollment_date: isoDay(student.enrollment_date),
      medical_record: student.medical_record,
      notes: student.notes,
    };
  }

  if (wants('class')) {
    summary.class = {
      grade_level: student.grade_level,
      class_section: student.class_section,
      subjects: student.subjects,
    };
  }

  if (wants('parents')) {
    summary.parents = {
      parent_name: student.parent_name,
      parent_phone: student.parent_phone,
      parent_email: student.parent_email,
      emergency_contact_name: student.emergency_contact_name,
      emergency_contact_phone: student.emergency_contact_phone,
      emergency_contact_relation: student.emergency_contact_relation,
    };
  }

  if (wants('academics')) {
    summary.academics = report.performance;
  }

  if (wants('attendance')) {
    summary.attendance = { ...report.attendance, entries: attendanceLog?.rows || [] };
  }

  if (wants('fees')) {
    summary.fees = report.fees;
  }

  // The family's payment history is the bursar's working record and stops there — a teacher sees
  // whether fees are cleared, not what was paid when, which is the same line scan-profiles draws.
  if (wants('payments')) {
    summary.payments = report.payments;
  }

  if (wants('discipline')) {
    summary.discipline = { entries: discipline?.rows || [] };
  }

  if (wants('movements')) {
    summary.movements = {
      admissions: admissions?.rows || [],
      promotions: promotions?.rows || [],
      transfers: transfers?.rows || [],
    };
  }

  if (wants('clubs')) {
    summary.clubs = { entries: clubs || [] };
  }

  // The count of mandatory items still owed is carried alongside the list because it is the figure
  // anyone actually asks for, and computing it twice — here and in the browser — is how the two
  // eventually disagree. The ID-scan card derives it the same way.
  if (wants('requirements')) {
    summary.requirements = {
      level: requirements?.level ?? null,
      term: requirements?.term ?? null,
      academic_year: requirements?.academic_year ?? null,
      boarder: Boolean(requirements?.boarder),
      outstanding: (requirements?.items || []).filter(
        (item) => item.mandatory && item.status === 'pending',
      ).length,
      items: requirements?.items || [],
    };
  }

  // Null is the answer for a day student, not missing data: boarding is having an active bed, so
  // there is nothing else to look up.
  if (wants('dormitory')) {
    summary.dormitory = { placement: dormitory, boarder: Boolean(dormitory) };
  }

  return summary;
};

export const handleStudentSummaryFunction = async (database, body = {}, { actor: authenticated } = {}) => {
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, ALL_STAFF_ROLES);
  if (refusal) return refusal;

  return buildStudentSummary(database, {
    code: body.code,
    role: actor?.role,
    designation: actor?.designation,
  });
};
