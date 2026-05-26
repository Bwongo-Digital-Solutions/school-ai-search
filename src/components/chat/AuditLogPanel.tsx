import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock, User, Plus, Pencil, Trash2, RefreshCw,
  ChevronDown, ChevronUp, FileText, Shield
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { AuditLogEntry } from '@/types/auth';

const AuditLogPanel: React.FC = () => {
  const { fetchAuditLog, isAdmin } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const data = await fetchAuditLog(limit);
    setLogs(data);
    setLoading(false);
  }, [fetchAuditLog, limit]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'create': return <Plus className="w-3.5 h-3.5 text-emerald-500" />;
      case 'update': return <Pencil className="w-3.5 h-3.5 text-blue-500" />;
      case 'delete': return <Trash2 className="w-3.5 h-3.5 text-red-500" />;
      default: return <FileText className="w-3.5 h-3.5 text-gray-500" />;
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'create': return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
      case 'update': return 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800';
      case 'delete': return 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800';
      default: return 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700';
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'create': return 'Created';
      case 'update': return 'Updated';
      case 'delete': return 'Deleted';
      default: return action;
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (!isAdmin) {
    return (
      <div className="p-6 text-center">
        <Shield className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500">Only administrators can view the audit log.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Audit Log</h3>
          <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full px-2 py-0.5">
            {logs.length} entries
          </span>
        </div>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-indigo-500 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Log entries */}
      <div className="max-h-[400px] overflow-y-auto">
        {loading && logs.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-6 h-6 mx-auto mb-2 text-gray-300 animate-spin" />
            <p className="text-xs text-gray-400">Loading audit log...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="w-8 h-8 mx-auto mb-2 text-gray-200 dark:text-gray-600" />
            <p className="text-sm text-gray-400">No audit entries yet</p>
            <p className="text-xs text-gray-300 mt-1">Changes to student records will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {logs.map(log => (
              <div key={log.id} className="px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-750/50 transition-colors">
                <div className="flex items-start gap-3">
                  {/* Action icon */}
                  <div className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${getActionColor(log.action)}`}>
                    {getActionIcon(log.action)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800 dark:text-white">
                        {log.user_name}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border ${getActionColor(log.action)}`}>
                        {getActionLabel(log.action)}
                      </span>
                      {log.entity_name && (
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {log.entity_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-400">{log.user_email}</span>
                      <span className="text-[10px] text-gray-300">|</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        log.user_role === 'admin'
                          ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'
                          : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                      }`}>
                        {log.user_role}
                      </span>
                      <span className="text-[10px] text-gray-300">|</span>
                      <span className="text-[10px] text-gray-400">{formatTime(log.created_at)}</span>
                    </div>

                    {/* Expandable changes */}
                    {log.changes && Object.keys(log.changes).length > 0 && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                          className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-600 transition-colors"
                        >
                          {expanded === log.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {expanded === log.id ? 'Hide' : 'View'} changes
                        </button>
                        {expanded === log.id && (
                          <div className="mt-1.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2.5 text-[11px] space-y-1">
                            {Object.entries(log.changes).map(([key, val]) => (
                              <div key={key} className="flex gap-2">
                                <span className="text-gray-400 font-medium min-w-[100px]">{key}:</span>
                                <span className="text-gray-600 dark:text-gray-300">
                                  {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0 hidden sm:block">
                    {new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Load more */}
      {logs.length >= limit && (
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-center">
          <button
            onClick={() => setLimit(prev => prev + 25)}
            className="text-xs text-indigo-500 hover:text-indigo-600 font-medium transition-colors"
          >
            Load more entries
          </button>
        </div>
      )}
    </div>
  );
};

export default AuditLogPanel;
