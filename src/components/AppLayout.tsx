import React from 'react';
import Header from './chat/Header';
import ConversationSidebar from './chat/ConversationSidebar';
import ChatWindow from './chat/ChatWindow';
import StudentManagement from './chat/StudentManagement';
import AuditLogPanel from './chat/AuditLogPanel';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';
import { Shield, Clock, Users as UsersIcon } from 'lucide-react';

const AuditView: React.FC = () => {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900 p-8">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-purple-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">Admin Access Required</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The audit log is only accessible to administrators. Please sign in with an admin account to view this section.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Clock className="w-6 h-6 text-indigo-500" />
              Audit Trail
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Track all changes made to student records</p>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
            <Shield className="w-3 h-3" /> Admin Only
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-6 py-4">
        <AuditLogPanel />
      </div>
    </div>
  );
};

const AppLayout: React.FC = () => {
  const { activeView } = useChatContext();

  const renderMainContent = () => {
    switch (activeView) {
      case 'chat':
        return <ChatWindow />;
      case 'students':
        return <StudentManagement />;
      case 'audit':
        return <AuditView />;
      default:
        return <ChatWindow />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <Header />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - only show in chat view */}
        {activeView === 'chat' && <ConversationSidebar />}

        {/* Main area */}
        <div className="flex-1 min-w-0">
          {renderMainContent()}
        </div>
      </div>
    </div>
  );
};

export default AppLayout;
