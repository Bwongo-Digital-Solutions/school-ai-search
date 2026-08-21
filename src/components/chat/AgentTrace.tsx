import React, { useState } from 'react';
import { AlertTriangle, BookMarked, ChevronDown, ChevronRight, Plug, Terminal } from 'lucide-react';
import type { MessageMetadata } from '@/types/chat';

const formatDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

/**
 * What the assistant actually did, shown under its reply.
 *
 * The tool trace is collapsed by default — most of the time the answer is what matters — but it is
 * always reachable, because an answer assembled from school records should be checkable rather than
 * taken on trust. Citations stay expanded for the same reason: they are the answer's evidence.
 */
const AgentTrace: React.FC<{ metadata?: MessageMetadata }> = ({ metadata }) => {
  const [showSteps, setShowSteps] = useState(false);

  if (!metadata) return null;

  const steps = metadata.steps || [];
  const citations = metadata.citations || [];
  const mcpErrors = metadata.mcpErrors || [];
  const hasAnything =
    steps.length > 0 || citations.length > 0 || mcpErrors.length > 0 || metadata.notice || metadata.stoppedAtStepLimit;

  if (!hasAnything) return null;

  return (
    <div className="mt-2 space-y-2">
      {metadata.notice && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          {metadata.notice}
        </p>
      )}

      {metadata.stoppedAtStepLimit && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          The assistant reached its tool-step limit, so this answer may be incomplete.
        </p>
      )}

      {mcpErrors.map(error => (
        <p key={error.serverId} className="text-[11px] text-red-500 flex items-start gap-1.5">
          <Plug className="w-3 h-3 mt-0.5 shrink-0" />
          MCP server “{error.serverName}” could not be reached: {error.message}
        </p>
      ))}

      {citations.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1 flex items-center gap-1">
            <BookMarked className="w-3 h-3" /> Sources
          </p>
          <ul className="space-y-0.5">
            {citations.map(citation => (
              <li
                key={citation.chunkId || `${citation.documentId}-${citation.citationIndex}`}
                className="text-[11px] text-gray-500 dark:text-gray-400 flex gap-1.5"
              >
                <span className="shrink-0 font-medium text-indigo-500">[{citation.citationIndex}]</span>
                <span className="min-w-0">
                  <span className="font-medium text-gray-600 dark:text-gray-300">{citation.title}</span>
                  {citation.heading && <span> — {citation.heading}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {steps.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowSteps(previous => !previous)}
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {showSteps ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Terminal className="w-3 h-3" />
            {steps.length} tool {steps.length === 1 ? 'call' : 'calls'}
          </button>

          {showSteps && (
            <ol className="mt-1.5 space-y-1.5 border-l-2 border-gray-100 dark:border-gray-700 pl-2.5">
              {steps.map((step, index) => (
                <li key={index} className="text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <code className={step.isError ? 'text-red-500' : 'text-indigo-500'}>{step.tool}</code>
                    <span className="text-gray-400">{formatDuration(step.ms)}</span>
                  </div>
                  <p className="font-mono text-gray-400 truncate">{JSON.stringify(step.input)}</p>
                  <p
                    className={`whitespace-pre-wrap line-clamp-3 ${
                      step.isError ? 'text-red-400' : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {step.output}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentTrace;
