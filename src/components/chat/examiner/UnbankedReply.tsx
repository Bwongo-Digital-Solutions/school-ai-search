import React, { useMemo, useState } from 'react';
import { Check, Copy, FileDown, ListOrdered, Text } from 'lucide-react';
import { Panel, SecondaryButton } from '../fees/shared';

/**
 * Renders a model reply that produced no bankable questions.
 *
 * The questions are usually right there in the prose — the model just wrote them out instead of
 * returning them properly. Losing that inside a dismissible error dialog wastes the work and the
 * tokens, so this parses what it can into numbered questions and offers the raw text alongside,
 * with copy and download so nothing is trapped on screen.
 *
 * The parsing mirrors salvageQuestionsFromText on the server, but is display-only: nothing here is
 * saved to the question bank, because none of it has been grounded or reviewed.
 */

interface ParsedQuestion {
  number: string;
  stem: string;
  options: string[];
  marks: number | null;
}

const NUMBERED = /^\s*(?:\*\*)?(?:Question\s*)?(\d+)[.)：:]/i;

const parseQuestions = (text: string): ParsedQuestion[] => {
  const blocks = String(text || '')
    .split(/\n(?=\s*(?:\*\*)?(?:Question\s*)?\d+[.)：:])/i)
    .map(block => block.trim())
    .filter(Boolean);

  const parsed: ParsedQuestion[] = [];

  for (const block of blocks) {
    const match = NUMBERED.exec(block);
    // Skip the model's lead-in, which is everything before the first numbered item.
    if (!match) continue;

    const cleaned = block.replace(NUMBERED, '').replace(/\*\*/g, '').trim();
    if (cleaned.length < 10) continue;

    const lines = cleaned.split(/\n/).map(line => line.trim()).filter(Boolean);
    const isOption = (line: string) => /^[A-Ha-h][.)]\s+/.test(line);

    const marksMatch = cleaned.match(/[[(]\s*(\d+)\s*marks?\s*[\])]/i);

    parsed.push({
      number: match[1],
      stem: lines
        .filter(line => !isOption(line))
        .join(' ')
        .replace(/[[(]\s*\d+\s*marks?\s*[\])]/i, '')
        .trim(),
      options: lines.filter(isOption).map(line => line.replace(/^[A-Ha-h][.)]\s+/, '').trim()),
      marks: marksMatch ? Number(marksMatch[1]) : null,
    });
  }

  return parsed.filter(question => question.stem);
};

const UnbankedReply: React.FC<{ reply: string; subject?: string }> = ({ reply, subject }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const questions = useMemo(() => parseQuestions(reply), [reply]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is unavailable outside a secure context; the text is on screen to select by hand.
    }
  };

  const download = () => {
    const lines = questions.length
      ? [
          `# Generated questions${subject ? ` — ${subject}` : ''}`,
          '',
          ...questions.flatMap(question => [
            `## ${question.number}. ${question.stem}${question.marks ? ` [${question.marks} marks]` : ''}`,
            '',
            ...question.options.map(
              (option, index) => `${String.fromCharCode(65 + index)}. ${option}`,
            ),
            '',
          ]),
        ]
      : [`# Model reply${subject ? ` — ${subject}` : ''}`, '', reply];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `questions-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel className="p-4 border-amber-200 dark:border-amber-800">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-white">
            {questions.length > 0
              ? `${questions.length} question${questions.length === 1 ? '' : 's'} the model wrote out`
              : "The model's reply"}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {questions.length > 0
              ? 'These were written as prose rather than returned properly, so they could not be added to the question bank automatically. Copy what you want, or try again with a larger model.'
              : 'Nothing here could be read as questions. Try again, or pick a larger model — small local models often cannot follow a structured format.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <SecondaryButton onClick={copy}>
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </SecondaryButton>
          <SecondaryButton onClick={download}>
            <FileDown className="w-4 h-4" /> Download
          </SecondaryButton>
        </div>
      </div>

      {questions.length > 0 && (
        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3"
        >
          {showRaw ? <ListOrdered className="w-3.5 h-3.5" /> : <Text className="w-3.5 h-3.5" />}
          {showRaw ? 'Show as questions' : 'Show the raw reply'}
        </button>
      )}

      {showRaw || questions.length === 0 ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 p-3 text-[11px] text-gray-700 dark:text-gray-300">
          {reply}
        </pre>
      ) : (
        <ol className="space-y-3">
          {questions.map(question => (
            <li
              key={question.number}
              className="flex gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-700"
            >
              <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-[11px] font-semibold flex items-center justify-center">
                {question.number}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800 dark:text-gray-100">{question.stem}</p>
                {question.options.length > 0 && (
                  <ol className="mt-1.5 space-y-0.5">
                    {question.options.map((option, index) => (
                      <li key={index} className="text-xs text-gray-600 dark:text-gray-300">
                        {String.fromCharCode(65 + index)}. {option}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              {question.marks !== null && (
                <span className="shrink-0 text-[11px] font-medium text-gray-400">[{question.marks}]</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
};

export default UnbankedReply;
