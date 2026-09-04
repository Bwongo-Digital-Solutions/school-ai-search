import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarkdownRenderer from '../MarkdownRenderer';
import { Panel, PrimaryButton, SecondaryButton } from '../fees/shared';
import styles from '../tabs.module.scss';
import editorStyles from './question-editor.module.scss';
import { Button } from '@carbon/react';
import { Checkmark, Copy, DocumentDownload, Edit, Link, ListBulleted, ListNumbered, Redo, Save, TextBold, TextFont, TextItalic, Undo, View } from '@carbon/react/icons';

/**
 * The editing surface for whatever the Digital Examiner produced.
 *
 * Everything the model wrote arrives here as Markdown — questions it returned properly, questions it
 * wrote out as prose, and the prose around them. It is ordinary text in an ordinary editor, so a
 * teacher can fix a stem, add an option, delete a question or write a new one by hand, and then save
 * the lot to the question bank.
 *
 * Deliberately a plain `textarea` rather than a rich-text widget: the saved format *is* Markdown, so
 * what is typed is what is stored, and the toolbar only inserts the same characters a teacher could
 * type. That keeps the document identical to what the server parses back, which is what makes Save
 * predictable.
 */

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Parses the text and writes it to the question bank. Omitted when there is nothing to save to. */
  onSave?: () => void;
  busy?: boolean;
  title?: string;
  hint?: string;
  /** Shown next to the buttons after a save — "5 saved · 2 updated". */
  status?: string;
  filenamePrefix?: string;
  tone?: 'normal' | 'warning';
}

/** Counts the numbered headings, which is what the server reads back as questions. */
const countQuestions = (markdown: string) =>
  (markdown.match(/^\s*#{0,6}\s*(?:\*\*)?(?:Question\s*)?\d+[.)：:]/gim) || []).length;

/**
 * Preview text is model-generated, so raw HTML in it is escaped rather than rendered. The meta
 * comments that carry each question's id are stripped too: they are bookkeeping, not prose, and a
 * preview is meant to show the teacher the paper.
 */
const forPreview = (markdown: string) =>
  markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

type Command =
  | { kind: 'wrap'; before: string; after: string; placeholder: string }
  | { kind: 'prefix'; prefix: string | ((index: number) => string) };

const COMMANDS = {
  bold: { kind: 'wrap', before: '**', after: '**', placeholder: 'bold text' },
  italic: { kind: 'wrap', before: '*', after: '*', placeholder: 'italic text' },
  link: { kind: 'wrap', before: '[', after: '](https://)', placeholder: 'link text' },
  heading: { kind: 'prefix', prefix: '## ' },
  bullet: { kind: 'prefix', prefix: '- ' },
  numbered: { kind: 'prefix', prefix: (index: number) => `${index + 1}. ` },
} satisfies Record<string, Command>;

type CommandName = keyof typeof COMMANDS;

const QuestionEditor: React.FC<Props> = ({
  value,
  onChange,
  onSave,
  busy,
  title,
  hint,
  status,
  filenamePrefix = 'questions',
  tone = 'normal',
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  // Undo history is kept here rather than left to the browser: every toolbar command replaces the
  // textarea's value programmatically, which clears the native undo stack in most browsers.
  const history = useRef<string[]>([value]);
  const position = useRef(0);
  const lastTyped = useRef(0);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });

  const syncDepth = () => {
    setDepth({ undo: position.current, redo: history.current.length - 1 - position.current });
  };

  const push = useCallback((next: string, coalesce: boolean) => {
    const now = Date.now();
    // Consecutive keystrokes collapse into one history entry, so Undo steps back a phrase at a time
    // rather than a character at a time.
    const merge = coalesce && now - lastTyped.current < 700 && position.current > 0;
    lastTyped.current = coalesce ? now : 0;

    history.current = history.current.slice(0, position.current + (merge ? 0 : 1));
    history.current.push(next);
    position.current = history.current.length - 1;
    syncDepth();
  }, []);

  const apply = useCallback(
    (next: string, options: { coalesce?: boolean } = {}) => {
      push(next, Boolean(options.coalesce));
      onChange(next);
    },
    [onChange, push],
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      const target = position.current + direction;
      if (target < 0 || target >= history.current.length) return;
      position.current = target;
      lastTyped.current = 0;
      syncDepth();
      onChange(history.current[target]);
    },
    [onChange],
  );

  // A new draft arriving from outside — a fresh generation, or the ids the server hands back after a
  // save — starts its own history. Edits made here always match the top of the stack, so this only
  // fires for a replacement, never for the editor's own changes.
  useEffect(() => {
    if (value === history.current[position.current]) return;
    history.current = [value];
    position.current = 0;
    lastTyped.current = 0;
    syncDepth();
  }, [value]);

  /**
   * Applies a toolbar command to the selection.
   *
   * Works entirely through selectionStart/selectionEnd — no contentEditable, no execCommand — so the
   * text stays the single source of truth and the caret lands where a typist expects it.
   */
  const run = useCallback(
    (name: CommandName) => {
      const field = textareaRef.current;
      if (!field) return;

      const start = field.selectionStart;
      const end = field.selectionEnd;
      const selected = value.slice(start, end);
      const command = COMMANDS[name] as Command;

      if (command.kind === 'wrap') {
        const body = selected || command.placeholder;
        const next = `${value.slice(0, start)}${command.before}${body}${command.after}${value.slice(end)}`;
        apply(next);
        // Select the wrapped text so typing replaces the placeholder straight away.
        const from = start + command.before.length;
        window.requestAnimationFrame(() => {
          field.focus();
          field.setSelectionRange(from, from + body.length);
        });
        return;
      }

      // Line commands cover every line the selection touches, including the one the caret sits on.
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEndIndex = value.indexOf('\n', end);
      const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
      const block = value.slice(lineStart, lineEnd);

      const lines = block.split('\n');
      const prefixOf = (index: number) =>
        typeof command.prefix === 'function' ? command.prefix(index) : command.prefix;

      // Pressing the same button again removes the marker, the way a list button normally behaves.
      const alreadyPrefixed = lines.every(
        (line, index) => line.trim() === '' || line.startsWith(prefixOf(index)),
      );

      const rewritten = lines
        .map((line, index) => {
          if (line.trim() === '') return line;
          return alreadyPrefixed ? line.slice(prefixOf(index).length) : `${prefixOf(index)}${line}`;
        })
        .join('\n');

      const next = `${value.slice(0, lineStart)}${rewritten}${value.slice(lineEnd)}`;
      apply(next);
      window.requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(lineStart, lineStart + rewritten.length);
      });
    },
    [apply, value],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      step(event.shiftKey ? 1 : -1);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      step(1);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      run('bold');
      return;
    }
    if (modifier && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      run('italic');
      return;
    }
    if (modifier && event.key.toLowerCase() === 's' && onSave) {
      event.preventDefault();
      onSave();
      return;
    }

    // Tab indents rather than jumping out of the field — this is a document, not a form control.
    if (event.key === 'Tab') {
      event.preventDefault();
      const field = event.currentTarget;
      const start = field.selectionStart;
      const next = `${value.slice(0, start)}  ${value.slice(field.selectionEnd)}`;
      apply(next);
      window.requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(start + 2, start + 2);
      });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is unavailable outside a secure context; the text is on screen to select by hand.
    }
  };

  const download = () => {
    const blob = new Blob([value], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const total = useMemo(() => countQuestions(value), [value]);

  const toolbarButton = (
    name: CommandName | 'undo' | 'redo',
    Icon: React.ElementType,
    label: string,
    action: () => void,
    disabled = false,
  ) => (
    <Button
      key={name}
      hasIconOnly
      kind="ghost"
      size="sm"
      renderIcon={Icon}
      iconDescription={label}
      tooltipPosition="bottom"
      onClick={action}
      disabled={disabled || preview}
    />
  );

  return (
    <Panel
      className={tone === 'warning' ? styles.padWarn : styles.pad}
    >
      <div className={styles.betweenTop}>
        <div className={styles.rowMain}>
          <p className={styles.subheading}>
            {title || 'Draft questions'}
          </p>
          <p className={styles.note}>
            {hint ||
              'Edit anything here — stems, options, answers, marks. Save writes it back to the question bank.'}
          </p>
        </div>

        <div className={styles.actions}>
          {status && <span className={styles.positive}>{status}</span>}
          <SecondaryButton onClick={copy}>
            {copied ? <Checkmark size={16} /> : <Copy size={16} />}
            {copied ? 'Copied' : 'Copy'}
          </SecondaryButton>
          <SecondaryButton onClick={download}>
            <DocumentDownload size={16} /> Download
          </SecondaryButton>
          {onSave && (
            <PrimaryButton onClick={onSave} disabled={busy || value.trim() === ''}>
              <Save size={16} /> Save to question bank
            </PrimaryButton>
          )}
        </div>
      </div>

      <div className={editorStyles.toolbar}>
        {toolbarButton('bold', TextBold, 'TextBold (Ctrl+B)', () => run('bold'))}
        {toolbarButton('italic', TextItalic, 'TextItalic (Ctrl+I)', () => run('italic'))}
        {toolbarButton('heading', TextFont, 'TextFont', () => run('heading'))}
        <span className={editorStyles.divider} />
        {toolbarButton('bullet', ListBulleted, 'Bullet list', () => run('bullet'))}
        {toolbarButton('numbered', ListNumbered, 'Numbered list', () => run('numbered'))}
        {toolbarButton('link', Link, 'Link', () => run('link'))}
        <span className={editorStyles.divider} />
        {toolbarButton('undo', Undo, 'Undo (Ctrl+Z)', () => step(-1), depth.undo === 0)}
        {toolbarButton('redo', Redo, 'Redo (Ctrl+Shift+Z)', () => step(1), depth.redo === 0)}

        <div className={editorStyles.toolbarEnd}>
          <span className={editorStyles.count}>
            {total} question{total === 1 ? '' : 's'}
          </span>
          <Button
            kind="ghost"
            size="sm"
            renderIcon={preview ? Edit : View}
            onClick={() => setPreview(!preview)}
          >
            {preview ? 'Edit' : 'Preview'}
          </Button>
        </div>
      </div>

      {preview ? (
        <div className={editorStyles.surface}>
          <MarkdownRenderer content={forPreview(value)} />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={event => apply(event.target.value, { coalesce: true })}
          onKeyDown={onKeyDown}
          spellCheck
          className={editorStyles.textarea}
          aria-label="Question paper source"
        />
      )}
    </Panel>
  );
};

export default QuestionEditor;
