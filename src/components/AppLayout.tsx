import React from 'react';
import Header from './chat/Header';
import ConversationSidebar from './chat/ConversationSidebar';
import ChatWindow from './chat/ChatWindow';
import StudentManagement from './chat/StudentManagement';
import AuditLogPanel from './chat/AuditLogPanel';
import StudentRecordsWorkspace from './chat/StudentRecordsWorkspace';
import UserAccessPanel from './chat/UserAccessPanel';
import FeeStatusPanel from './chat/FeeStatusPanel';
import FeeManagementWorkspace from './chat/FeeManagementWorkspace';
import LessonPlannerWorkspace from './chat/LessonPlannerWorkspace';
import DigitalExaminerWorkspace from './chat/DigitalExaminerWorkspace';
import SettingsPanel from './chat/SettingsPanel';
import InboxPanel from './chat/InboxPanel';
import MonitoringDashboard from './chat/MonitoringDashboard';
import TeacherPerformance from './chat/TeacherPerformance';
import AppFooter from './common/AppFooter';
import styles from './app-layout.module.scss';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';
import { AccessDenied, PageHeader } from './common';
import { Time, UserAdmin } from '@carbon/react/icons';
import { Tag } from '@carbon/react';

const AuditView: React.FC = () => {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <AccessDenied
        title="Administrators only"
        message="The audit trail records who changed which student record and when. It is available to administrators."
      />
    );
  }

  return (
    <div className={styles.audit}>
      <PageHeader title="Audit trail" illustration={<Time size={32} />}>
        <Tag type="purple" size="sm" renderIcon={UserAdmin}>
          Administrators only
        </Tag>
      </PageHeader>
      <div className={styles.auditBody}>
        <AuditLogPanel />
      </div>
    </div>
  );
};

const AppLayout: React.FC = () => {
  const { activeView } = useChatContext();
  const { isAuthenticated, isSupportStaff } = useAuth();

  const renderMainContent = () => {
    // Non-teaching support staff are limited to school fees payment status.
    if (isSupportStaff) {
      return <FeeStatusPanel />;
    }

    switch (activeView) {
      case 'chat':
        return <ChatWindow />;
      case 'students':
        return <StudentManagement />;
      case 'records':
        return <StudentRecordsWorkspace />;
      case 'users':
        return <UserAccessPanel />;
      case 'audit':
        return <AuditView />;
      case 'fees':
        return <FeeStatusPanel />;
      case 'finance':
        return <FeeManagementWorkspace />;
      case 'lessons':
        return <LessonPlannerWorkspace />;
      case 'examiner':
        return <DigitalExaminerWorkspace />;
      case 'monitoring':
        return <MonitoringDashboard />;
      // Teacher performance moved under Monitoring, where its audience already is. Kept as an
      // alias so an old link or a saved view still lands on the report rather than nowhere.
      case 'teaching':
        return <MonitoringDashboard />;
      case 'messages':
        return <InboxPanel />;
      case 'settings':
        return <SettingsPanel />;
      default:
        return <ChatWindow />;
    }
  };

  return (
    <div className={styles.app}>
      {/* The header carries the brand and the global actions; the section rail hangs off it. */}
      <Header />

      {/* Offset for the rail, which is fixed and 16rem wide once the viewport can afford it. */}
      <div className={styles.main}>
        {/* Sidebar - only show in chat view */}
        {activeView === 'chat' && isAuthenticated && !isSupportStaff && <ConversationSidebar />}

        {/* Main area */}
        <div className={styles.content}>{renderMainContent()}</div>
      </div>

      {/* System-wide product footer */}
      <AppFooter />
    </div>
  );
};

export default AppLayout;
