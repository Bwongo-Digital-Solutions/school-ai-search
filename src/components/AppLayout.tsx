import React from 'react';
import Header from './chat/Header';
import ConversationSidebar from './chat/ConversationSidebar';
import ChatWindow from './chat/ChatWindow';
import StudentManagement from './chat/StudentManagement';
import StudentSummary from './chat/StudentSummary';
import AuditLogPanel from './chat/AuditLogPanel';
import StudentRecordsWorkspace from './chat/StudentRecordsWorkspace';
import UserAccessPanel from './chat/UserAccessPanel';
import FeeStatusPanel from './chat/FeeStatusPanel';
import FeeManagementWorkspace from './chat/FeeManagementWorkspace';
import LessonPlannerWorkspace from './chat/LessonPlannerWorkspace';
import DigitalExaminerWorkspace from './chat/DigitalExaminerWorkspace';
import SettingsPanel from './chat/SettingsPanel';
import SchoolDataWorkspace from './chat/SchoolDataWorkspace';
import EmbeddedSystem from './chat/EmbeddedSystem';
import InboxPanel from './chat/InboxPanel';
import MonitoringDashboard from './chat/MonitoringDashboard';
import SchoolLifeWorkspace from './chat/SchoolLifeWorkspace';
import MatronDashboard from './chat/MatronDashboard';
import TeacherPerformance from './chat/TeacherPerformance';
import AppFooter from './common/AppFooter';
import styles from './app-layout.module.scss';
import { useLicence } from '@/contexts/LicenceContext';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';
import { AccessDenied, PageHeader } from './common';
import {
  ACCOUNT_ADMIN_ROLES,
  FINANCE_ROLES,
  PRIVILEGED_ROLES,
  TEACHING_ROLES,
  getRoleLabel,
} from '@/lib/roles';
import type { ActiveView } from '@/contexts/ChatContext';
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

/**
 * Which roles may open each section.
 *
 * Stated here, next to the routing, rather than left to each screen. The rail hides what a role
 * cannot use, but hiding a link is not a permission check — a saved view, a stale link or a role
 * changed mid-session all arrive here directly. Every screen still guards itself server-side; this
 * is the structural fence that stops the wrong screen rendering at all.
 *
 * A view absent from this map is open to any signed-in staff member.
 */
const VIEW_ROLES: Partial<Record<ActiveView, readonly string[]>> = {
  chat: TEACHING_ROLES,
  students: TEACHING_ROLES,
  // Everyone who can be shown a student can be shown their file; the server decides which parts.
  student: [...TEACHING_ROLES, ...FINANCE_ROLES],
  records: TEACHING_ROLES,
  lessons: TEACHING_ROLES,
  examiner: TEACHING_ROLES,
  messages: [...TEACHING_ROLES, ...FINANCE_ROLES],
  finance: FINANCE_ROLES,
  monitoring: PRIVILEGED_ROLES,
  teaching: PRIVILEGED_ROLES,
  audit: PRIVILEGED_ROLES,
  data: PRIVILEGED_ROLES,
  elearning: [...TEACHING_ROLES, ...FINANCE_ROLES],
  erp: PRIVILEGED_ROLES,
  // Clubs and requirements are part of a student's record, so they follow the roster.
  'school-life': TEACHING_ROLES,
  /* 'matron' is deliberately absent. This map keys on role, and a matron's role is support_staff —
     the same as the cook's. Her screen is gated on the designation instead, in the branch below and
     again on the server through requirePost. Listing her role here would open it to the cook. */
  users: ACCOUNT_ADMIN_ROLES,
  settings: ACCOUNT_ADMIN_ROLES,
};

/**
 * Which feature each screen belongs to, mirroring FEATURE_BY_ROUTE on the server.
 *
 * Two lists rather than one because they answer different questions — the server gates endpoints,
 * this gates screens, and several screens share an endpoint — but they must agree about what a tier
 * includes. A screen missing from here is simply never hidden, which is the safe direction: the
 * server still refuses the request behind it.
 */
const VIEW_FEATURE: Record<string, string> = {
  chat: 'assistant',
  students: 'students',
  student: 'students',
  records: 'records',
  users: 'users',
  audit: 'audit',
  finance: 'fees_billing',
  lessons: 'lessons',
  examiner: 'examiner',
  monitoring: 'monitoring',
  teaching: 'monitoring',
  messages: 'messages',
  data: 'school_data',
  elearning: 'elearning',
  erp: 'erp',
  'school-life': 'school_life',
  matron: 'matron',
  settings: 'settings',
  /* 'fees' is deliberately absent. Seeing whether a family has paid is Essential, and it is the one
     screen every signed-in role can open — the finance workspace above it is what costs. */
};

const AppLayout: React.FC = () => {
  const { activeView } = useChatContext();
  const { user, isAuthenticated, isSupportStaff, isMatron } = useAuth();
  const { entitlement } = useLicence();

  const renderMainContent = () => {
    /* The matron is support staff, but she runs the dormitories: the head count at night, the sick
       bay, the beds. Those are her whole job, and until now this screen handed her the fees panel
       and nothing else. She gets her own small set; the askari and the cook are unchanged. */
    if (isMatron) {
      switch (activeView) {
        case 'fees':
          return <FeeStatusPanel />;
        case 'messages':
          return <InboxPanel />;
        default:
          return <MatronDashboard />;
      }
    }

    // Non-teaching support staff are limited to school fees payment status.
    if (isSupportStaff) {
      return <FeeStatusPanel />;
    }

    // Everyone else is checked against the map above before anything renders. Fees are the one
    // screen every signed-in role can open, so an unlisted view falls through to the switch.
    const allowed = VIEW_ROLES[activeView];
    if (allowed && user && !allowed.includes(user.role)) {
      return (
        <AccessDenied
          title="Not available to your role"
          message={`This section is not part of what a ${getRoleLabel(user.role).toLowerCase()} does here. If you need it, ask an administrator.`}
        />
      );
    }

    /* A screen the school has not bought. The nav does not offer it, so this is reached by a saved
       link or a bookmark — which is exactly when saying why matters, because there is nothing on
       screen to explain where the entry went. The same card as a role refusal: a wall is a wall,
       and the difference is in the words. */
    const licensed = entitlement(VIEW_FEATURE[activeView]);
    if (licensed && !licensed.allowed) {
      return <AccessDenied title={`${licensed.label} is not part of this plan`} message={licensed.message} />;
    }

    switch (activeView) {
      case 'chat':
        return <ChatWindow />;
      case 'students':
        return <StudentManagement />;
      case 'student':
        return <StudentSummary />;
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
      case 'data':
        return <SchoolDataWorkspace />;
      case 'elearning':
        return <EmbeddedSystem kind="elearning" />;
      case 'erp':
        return <EmbeddedSystem kind="erp" />;
      case 'school-life':
        return <SchoolLifeWorkspace />;
      // An administrator or head teacher may open the dormitory screens too — somebody has to when
      // the matron is off. The component checks the post again for itself.
      case 'matron':
        return <MatronDashboard />;
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
