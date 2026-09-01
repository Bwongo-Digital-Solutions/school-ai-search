/**
 * The parent-facing report: gathering it, sending it, and remembering that it was sent.
 *
 * Staff hand these out at the school gate and over WhatsApp, and the question that follows
 * a week later is always "did this family actually get it?". Every delivery therefore
 * writes an audit_logs row — the same table the settings service uses — and `last_sent`
 * hands that back so the app can say so on the student's card.
 *
 * A share to WhatsApp leaves the phone through Android's share sheet, so the server never
 * sees it happen: the app reports it afterwards through `record_share`. That record says
 * the report was handed over, not that anybody read it, and the wording in the app is
 * chosen to keep that distinction honest.
 */
import { randomUUID } from 'node:crypto';

import { loadSchoolSettings } from './settings.mjs';
import { sendEmail } from './email.mjs';
import { buildParentReportPdf, REPORT_SECTIONS } from '../reports/parent-report.mjs';
import { requireRole, resolveActor } from '../auth/actor.mjs';
import { TEACHING_ROLES } from '../auth/roles.mjs';

const trimmed = (value) => String(value ?? '').trim();

/** Unknown names are dropped rather than rejected, so a stale app cannot fail a send. */
export const normaliseSections = (value) => {
  const requested = Array.isArray(value)
    ? value
    : trimmed(value)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
  const kept = REPORT_SECTIONS.filter((name) => requested.includes(name));
  return kept.length ? kept : REPORT_SECTIONS;
};

const loadStudent = async (database, code) => {
  const { rows } = await database.query(
    'SELECT * FROM students WHERE UPPER(student_id) = UPPER($1) OR id = $1 LIMIT 1',
    [trimmed(code)],
  );
  return rows[0] || null;
};

/**
 * Everything the report can draw, fetched in one go. Sections are gathered independently so
 * a student with no marks still gets a report that says as much.
 */
export const loadReportData = async (database, student) => {
  const [grades, attendance, invoices, payments] = await Promise.all([
    database.query(
      `
        SELECT g.score, g.max_score, g.grade, g.remarks, s.name AS subject
        FROM gradebook_entries g
        LEFT JOIN subjects_catalog s ON s.id = g.subject_id
        WHERE g.student_id = $1
        ORDER BY s.name ASC NULLS LAST
      `,
      [student.id],
    ),
    database.query(
      'SELECT status FROM attendance_records WHERE student_id = $1',
      [student.id],
    ),
    database.query(
      'SELECT total_amount, balance_due, currency FROM invoices WHERE student_id = $1',
      [student.id],
    ),
    database.query(
      `
        SELECT p.amount, p.currency, p.payment_method, p.reference, p.paid_at, r.receipt_number
        FROM payments p
        LEFT JOIN receipts r ON r.payment_id = p.id
        WHERE p.student_id = $1
        ORDER BY p.paid_at DESC
      `,
      [student.id],
    ),
  ]);

  const subjects = grades.rows.map((row) => ({
    subject: row.subject || 'Subject',
    score: Number(row.score) || 0,
    max_score: Number(row.max_score) || 100,
    grade: row.grade,
    remarks: row.remarks,
  }));
  const average = subjects.length
    ? subjects.reduce((sum, row) => sum + (row.max_score ? (row.score / row.max_score) * 100 : 0), 0) / subjects.length
    : 0;

  const counts = attendance.rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const total = attendance.rows.length;
  // Late and excused both put the child in school, so neither counts against the rate.
  const present = (counts.present || 0) + (counts.late || 0) + (counts.excused || 0);

  const invoiced = invoices.rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const balance = invoices.rows.reduce((sum, row) => sum + Number(row.balance_due || 0), 0);
  const paidTotal = payments.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const currency = invoices.rows[0]?.currency || payments.rows[0]?.currency || 'UGX';

  return {
    performance: { subjects, average },
    attendance: { counts, total, rate: total ? (present / total) * 100 : 0 },
    fees: {
      currency,
      invoice_count: invoices.rows.length,
      total_invoiced: invoiced,
      total_paid: paidTotal,
      balance_due: balance,
    },
    payments: {
      currency,
      count: payments.rows.length,
      total_paid: paidTotal,
      entries: payments.rows.map((row) => ({
        amount: Number(row.amount || 0),
        currency: row.currency || currency,
        method: row.payment_method || '',
        reference: row.reference || '',
        paid_at: row.paid_at,
        receipt_number: row.receipt_number || '',
      })),
    },
    info: {
      date_of_birth: student.date_of_birth,
      gender: student.gender,
      enrollment_date: student.enrollment_date,
      blood_group: student.blood_group,
      parent_name: student.parent_name,
      parent_phone: student.parent_phone,
      parent_email: student.parent_email,
      emergency_contact_name: student.emergency_contact_name,
    },
  };
};

/** Builds the PDF and the filename it should travel under. */
export const renderReport = async (database, { code, sections, generatedBy }) => {
  const student = await loadStudent(database, code);
  if (!student) return { error: 'No student matches that ID' };

  const settings = await loadSchoolSettings(database);
  const data = await loadReportData(database, student);
  const wanted = normaliseSections(sections);

  const pdf = await buildParentReportPdf({
    school: settings.school_name,
    tagline: settings.tagline,
    themeColor: settings.theme_color,
    schoolLogo: settings.logo,
    schoolAddress: settings.address,
    contactPhone: settings.contact_phone,
    contactEmail: settings.contact_email,
    student: {
      full_name: `${student.first_name} ${student.last_name}`,
      student_number: student.student_id,
      grade_level: student.grade_level,
      class_section: student.class_section,
      status: student.status,
    },
    sections: wanted,
    ...data,
    generatedBy: trimmed(generatedBy),
  });

  return {
    student,
    settings,
    sections: wanted,
    pdf,
    filename: `${student.student_id}-report.pdf`,
  };
};

const recordDelivery = async (database, { student, channel, target, sections, actor, note }) =>
  database.query(
    `
      INSERT INTO audit_logs (
        id, user_email, user_name, user_role, action, entity_type, entity_id, entity_name, changes
      ) VALUES ($1, $2, $3, $4, 'student_report_sent', 'student', $5, $6, $7)
    `,
    [
      randomUUID(),
      trimmed(actor.email),
      trimmed(actor.name),
      trimmed(actor.role) || 'staff',
      student.id,
      `${student.first_name} ${student.last_name}`,
      JSON.stringify({ channel, target, sections, note: note || '' }),
    ],
  );

/** The most recent hand-over of a report for this student, whatever the channel. */
const lastSent = async ({ database, body }) => {
  const student = await loadStudent(database, body.code);
  if (!student) return { error: 'No student matches that ID' };

  const { rows } = await database.query(
    `
      SELECT user_name, user_email, changes, created_at
      FROM audit_logs
      WHERE action = 'student_report_sent' AND entity_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [student.id],
  );

  if (!rows[0]) return { last_sent: null };
  const changes = rows[0].changes || {};
  return {
    last_sent: {
      at: rows[0].created_at,
      by: rows[0].user_name || rows[0].user_email || 'staff',
      channel: changes.channel || 'unknown',
      target: changes.target || '',
      sections: changes.sections || [],
    },
  };
};

/**
 * Emails the report to the parent, with the PDF attached, and records that it went. A send
 * that the mail provider refuses is reported as a failure and not logged as a delivery —
 * a log that cannot be trusted is worse than no log.
 */
const sendByEmail = async ({ database, body, actor }) => {
  const to = trimmed(body.to);
  if (!to || !to.includes('@')) return { error: 'A parent email address is required' };

  const rendered = await renderReport(database, {
    code: body.code,
    sections: body.sections,
    generatedBy: actor.name || actor.email,
  });
  if (rendered.error) return rendered;

  const { student, settings, pdf, filename, sections } = rendered;
  const studentName = `${student.first_name} ${student.last_name}`;
  const subject = `${studentName} — school report from ${settings.school_name}`;
  const body_text =
    `Dear parent or guardian,\n\n` +
    `Please find attached the current school report for ${studentName} (${student.student_id}).\n\n` +
    `${settings.school_name}`;

  /* sendEmail reports rather than throws, and in mock mode — no EMAIL_API_KEY — it
     deliberately returns sent:false so a caller cannot claim a delivery that never
     happened. Nothing is logged unless the provider actually took the message. */
  const result = await sendEmail({
    to,
    subject,
    text: body_text,
    html: `<p>Dear parent or guardian,</p><p>Please find attached the current school report for <strong>${studentName}</strong> (${student.student_id}).</p><p>${settings.school_name}</p>`,
    attachments: [{ filename, content: Buffer.from(pdf) }],
  });

  if (!result.sent) {
    return {
      error:
        result.mode === 'mock'
          ? 'Email is not configured on this server, so nothing was sent. Share the report instead.'
          : `The report could not be emailed: ${result.error || 'the mail provider refused it'}`,
    };
  }

  await recordDelivery(database, {
    student,
    channel: 'email',
    target: to,
    sections,
    actor,
    note: body.note,
  });

  return { sent: { channel: 'email', to, sections, filename } };
};

/**
 * Logs a hand-over the server did not perform — the app shared the PDF through the phone's
 * share sheet, which is how it reaches WhatsApp.
 */
const recordShare = async ({ database, body, actor }) => {
  const student = await loadStudent(database, body.code);
  if (!student) return { error: 'No student matches that ID' };

  const channel = trimmed(body.channel) || 'share';
  await recordDelivery(database, {
    student,
    channel,
    target: trimmed(body.target),
    sections: normaliseSections(body.sections),
    actor,
    note: body.note,
  });

  return { recorded: { channel, at: new Date().toISOString() } };
};

const ACTIONS = {
  send_email: sendByEmail,
  record_share: recordShare,
  last_sent: lastSent,
};

export const STUDENT_REPORT_ACTIONS = Object.keys(ACTIONS);

/**
 * Reports carry a family's marks, attendance and payment history, so they are for staff who
 * already hold the roster.
 *
 * This used to read the role straight off the request body — the last service still doing so after
 * the rest moved to session-derived actors. A caller could name their own role, which made the
 * check decorative. It now goes through `resolveActor`, so the role comes from the `users` row
 * behind the session cookie; `body.requesterRole` is honoured only when there is no request to
 * authenticate at all, which is the internal/test path.
 */
export const handleStudentReportFunction = async (database, body = {}, { actor: authenticated } = {}) => {
  const actor = resolveActor(authenticated, body);
  const refusal = requireRole(actor, TEACHING_ROLES);
  if (refusal) return refusal;

  const handler = ACTIONS[body.action];
  if (!handler) return { error: `Unsupported report action: ${body.action}` };

  // The resolved actor, not the three body fields it used to be rebuilt from. Who is recorded as
  // having sent a family's marks out of the school comes from their session for the same reason the
  // permission to do so does — a delivery record naming whoever the request said it was is not a
  // record of anything.
  return handler({ database, body, actor });
};

export default { handleStudentReportFunction, renderReport, loadReportData, normaliseSections };
