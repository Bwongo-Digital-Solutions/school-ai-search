import React, { useState, useEffect, useCallback } from 'react';
import { Button, Tag } from '@carbon/react';
import {
  Add,
  ChevronDown,
  ChevronUp,
  Document,
  Edit,
  Renew,
  TrashCan,
} from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { AccessDenied, CardHeader, EmptyState, ErrorState, ListSkeleton, WidgetCard } from '@/components/common';
import styles from './audit-log.module.scss';
import type { AuditLogEntry } from '@/types/auth';

/** How each kind of change is shown: an icon and a tint, so the list can be scanned by shape. */
const ACTIONS: Record<string, { label: string; icon: React.ElementType; mark: string }> = {
  create: { label: 'Created', icon: Add, mark: styles.markCreate },
  update: { label: 'Updated', icon: Edit, mark: styles.markUpdate },
  delete: { label: 'Deleted', icon: TrashCan, mark: styles.markDelete },
};

const actionOf = (action: string) =>
  ACTIONS[action] ?? { label: action, icon: Document, mark: styles.markOther };

/**
 * How long ago, in the units someone actually thinks in.
 *
 * Relative up to a week, then the date — because "3d ago" is useful and "47d ago" is not.
 */
const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const AuditLogPanel: React.FC = () => {
  const { fetchAuditLog, isAdmin } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [limit, setLimit] = useState(25);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(await fetchAuditLog(limit));
      setError(null);
    } catch (err) {
      console.error('Failed to load the audit trail:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [fetchAuditLog, limit]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  if (!isAdmin) {
    return (
      <AccessDenied
        title="Administrators only"
        message="The audit trail records who changed which student record and when."
      />
    );
  }

  return (
    <WidgetCard>
      <CardHeader title="Audit trail">
        <Tag type="cool-gray" size="sm">
          {logs.length} entries
        </Tag>
        <Button
          hasIconOnly
          kind="ghost"
          size="sm"
          renderIcon={Renew}
          iconDescription="Refresh"
          tooltipPosition="left"
          onClick={loadLogs}
          disabled={loading}
        />
      </CardHeader>

      <div className={styles.scroller}>
        {loading && logs.length === 0 ? (
          <ListSkeleton rowCount={6} />
        ) : error && logs.length === 0 ? (
          <ErrorState headerTitle="Audit trail" error={error} onRetry={loadLogs} />
        ) : logs.length === 0 ? (
          <EmptyState
            headerTitle="Audit trail"
            displayText="entries"
            helperText="Changes to student records will appear here."
          />
        ) : (
          logs.map(log => {
            const action = actionOf(log.action);
            const ActionIcon = action.icon;
            const hasChanges = log.changes && Object.keys(log.changes).length > 0;

            return (
              <div key={log.id} className={styles.entry}>
                <span className={`${styles.mark} ${action.mark}`}>
                  <ActionIcon size={16} />
                </span>

                <div className={styles.main}>
                  <div className={styles.who}>
                    <span className={styles.name}>{log.user_name}</span>
                    <Tag
                      type={
                        log.action === 'create' ? 'green' : log.action === 'delete' ? 'red' : 'blue'
                      }
                      size="sm"
                    >
                      {action.label}
                    </Tag>
                    {log.entity_name && <span className={styles.target}>{log.entity_name}</span>}
                  </div>

                  <div className={styles.meta}>
                    <span>{log.user_email}</span>
                    <span aria-hidden>·</span>
                    <span>{log.user_role}</span>
                    <span aria-hidden>·</span>
                    <span>{formatTime(log.created_at)}</span>
                  </div>

                  {hasChanges && (
                    <div className={styles.changes}>
                      <Button
                        kind="ghost"
                        size="sm"
                        renderIcon={expanded === log.id ? ChevronUp : ChevronDown}
                        onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                      >
                        {expanded === log.id ? 'Hide' : 'View'} changes
                      </Button>

                      {expanded === log.id && (
                        <div className={styles.changeList}>
                          {Object.entries(log.changes).map(([key, val]) => (
                            <div key={key} className={styles.change}>
                              <span className={styles.changeKey}>{key}</span>
                              <span className={styles.changeValue}>
                                {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <span className={styles.time}>
                  {new Date(log.created_at).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            );
          })
        )}
      </div>

      {logs.length >= limit && (
        <div className={styles.loadMore}>
          <Button kind="ghost" size="sm" onClick={() => setLimit(prev => prev + 25)}>
            Load more entries
          </Button>
        </div>
      )}
    </WidgetCard>
  );
};

export default AuditLogPanel;
