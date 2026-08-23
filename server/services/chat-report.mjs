/**
 * Turning an AI chat conversation into something a teacher can keep: a branded PDF to download,
 * print, or email to a colleague or parent.
 *
 * Reached through POST /api/functions/chat-report for sending, and GET /api/chat-reports/:id.pdf
 * for downloading and printing. Both are gated to teaching staff, matching the chat itself — a
 * report is a transcript of school records, so whoever may not use the assistant may not read its
 * output either.
 */
import { buildChatReportPdf } from '../reports/chat-report.mjs';
import { loadSchoolSettings } from './settings.mjs';
import { emailEnabled, sendEmail } from './email.mjs';

const TEACHING_ROLES = ['admin', 'teacher'];

const trimmed = (value) => String(value ?? '').trim();

// Deliberately permissive: the point is to catch a typo like "name@" or a missing domain, not to
// adjudicate the RFC. A wrong-but-plausible address is the provider's problem to bounce.
const isEmailAddress = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed(value));

const slugify = (value) =>
  String(value || 'ai-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'ai-report';

/**
 * Loads a conversation with its messages and renders the PDF.
 * Shared by the download route and the send action, so an emailed report is byte-identical to a
 * downloaded one.
 */
export const renderChatReport = async (database, conversationId, { generatedBy } = {}) => {
  const { rows: conversations } = await database.query(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE id = $1',
    [trimmed(conversationId)],
  );
  const conversation = conversations[0];
  if (!conversation) return null;

  const { rows: messages } = await database.query(
    'SELECT role, content, metadata, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversation.id],
  );

  const settings = await loadSchoolSettings(database);
  const pdf = await buildChatReportPdf({
    school: settings,
    themeColor: settings.theme_color,
    conversation,
    messages,
    generatedBy,
  });

  return { conversation, messages, pdf, filename: `${slugify(conversation.title)}.pdf` };
};

const sendReport = async ({ database, body, actor, httpClient }) => {
  const recipient = trimmed(body.recipient);
  if (!isEmailAddress(recipient)) return { error: 'Enter a valid email address' };

  const report = await renderChatReport(database, body.conversationId, {
    generatedBy: actor.name || actor.email,
  });
  if (!report) return { error: 'Conversation not found' };

  const settings = await loadSchoolSettings(database);
  const schoolName = settings.school_name || 'the school';
  const note = trimmed(body.note);
  const title = report.conversation.title || 'AI assistant report';

  const result = await sendEmail(
    {
      to: recipient,
      subject: `${title} — ${schoolName}`,
      text: [
        note,
        note ? '' : null,
        `Attached is an AI assistant report from ${schoolName}, prepared by ${actor.name || actor.email}.`,
        '',
        'Answers are drawn from school records and the curriculum library; check anything',
        'consequential against the source before acting on it.',
      ]
        .filter((line) => line !== null)
        .join('\n'),
      attachments: [{ filename: report.filename, content: report.pdf }],
    },
    { httpClient },
  );

  if (!result.sent) {
    // Distinguish "this deployment cannot send" from "the provider rejected it" — the fix differs.
    return {
      error: emailEnabled()
        ? `The report could not be sent: ${result.error || 'the email provider rejected it'}`
        : 'Email is not configured on this deployment, so the report was not sent. Download it instead, ' +
          'or ask an administrator to set EMAIL_MODE and EMAIL_API_KEY.',
    };
  }

  return { sent: true, recipient, filename: report.filename };
};

const ACTIONS = { send: sendReport };

export const CHAT_REPORT_ACTIONS = Object.keys(ACTIONS);

export const handleChatReportFunction = async (database, body = {}, httpClient = fetch) => {
  if (!TEACHING_ROLES.includes(body.requesterRole)) return { error: 'Unauthorized' };

  const handler = ACTIONS[body.action];
  if (!handler) return { error: `Unsupported chat report action: ${body.action}` };

  const actor = {
    email: trimmed(body.actorEmail),
    name: trimmed(body.actorName),
    role: body.requesterRole,
  };

  return handler({ database, body, actor, httpClient });
};
