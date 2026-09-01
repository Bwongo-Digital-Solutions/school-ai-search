import React, { useState } from 'react';
import { Button } from '@carbon/react';
import { Book, ChevronDown, ChevronRight, Plug, Terminal, WarningAlt } from '@carbon/react/icons';
import type { MessageMetadata } from '@/types/chat';
import styles from './agent-trace.module.scss';

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
    <div className={styles.trace}>
      {metadata.notice && (
        <p className={styles.warning}>
          <WarningAlt size={16} />
          {metadata.notice}
        </p>
      )}

      {metadata.stoppedAtStepLimit && (
        <p className={styles.warning}>
          <WarningAlt size={16} />
          The assistant reached its tool-step limit, so this answer may be incomplete.
        </p>
      )}

      {mcpErrors.map(error => (
        <p key={error.serverId} className={styles.failure}>
          <Plug size={16} />
          MCP server “{error.serverName}” could not be reached: {error.message}
        </p>
      ))}

      {citations.length > 0 && (
        <div>
          <p className={styles.sectionLabel}>
            <Book size={16} /> Sources
          </p>
          <ul className={styles.citations}>
            {citations.map(citation => (
              <li
                key={citation.chunkId || `${citation.documentId}-${citation.citationIndex}`}
                className={styles.citation}
              >
                <span className={styles.citationIndex}>[{citation.citationIndex}]</span>
                <span>
                  <span className={styles.citationTitle}>{citation.title}</span>
                  {citation.heading && <span> — {citation.heading}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {steps.length > 0 && (
        <div>
          <Button
            kind="ghost"
            size="sm"
            renderIcon={showSteps ? ChevronDown : ChevronRight}
            onClick={() => setShowSteps(previous => !previous)}
            aria-expanded={showSteps}
          >
            <Terminal size={16} /> {steps.length} tool {steps.length === 1 ? 'call' : 'calls'}
          </Button>

          {showSteps && (
            <ol className={styles.steps}>
              {steps.map((step, index) => (
                <li key={index} className={styles.step}>
                  <div className={styles.stepHead}>
                    <code className={`${styles.stepTool} ${step.isError ? styles.stepToolError : ''}`}>
                      {step.tool}
                    </code>
                    <span className={styles.stepTime}>{formatDuration(step.ms)}</span>
                  </div>
                  <p className={styles.stepInput}>{JSON.stringify(step.input)}</p>
                  <p className={`${styles.stepOutput} ${step.isError ? styles.stepOutputError : ''}`}>
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
