import React, { useEffect, useState } from 'react';
import {
  SideNav,
  SideNavDivider,
  SideNavItems,
  SideNavLink,
  SideNavMenu,
  SideNavMenuItem,
} from '@carbon/react';
import {
  Application,
  ArrowsHorizontal,
  DataBase,
  Education,
  Chat,
  Email,
  Events,
  Group,
  Home,
  ListChecked,
  Money,
  Notebook,
  Settings as SettingsIcon,
  TaskComplete,
  Time,
  UserAdmin,
  Wallet,
} from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useLicence } from '@/contexts/LicenceContext';
import { useChatContext } from '@/contexts/ChatContext';
import { useLive } from '@/contexts/LiveContext';
import { loadIntegrations, type Integration } from '@/lib/integrations';
import styles from './app-side-nav.module.scss';

/**
 * The section navigation, as a left rail.
 *
 * These were tabs across the top of the header. A rail is what this app actually needs: the list is
 * eleven entries and still growing, several are role-gated so the count changes per person, and a
 * horizontal strip of that many items either wraps or scrolls at any normal window width. Down the
 * side they all fit, they read as a list, and the current one is obvious.
 *
 * Carbon's `SideNav` is the same component OpenMRS uses for the patient chart's left rail, and it
 * handles the parts that are tedious by hand: it collapses to a rail on small screens, expands over
 * the content, and takes its open state from the header's menu button.
 */

interface AppSideNavProps {
  expanded: boolean;
  onOverlayClick: () => void;
}

const AppSideNav: React.FC<AppSideNavProps> = ({ expanded, onOverlayClick }) => {
  const { activeView, setActiveView } = useChatContext();
  const {
    isAuthenticated, isAdmin, isSupportStaff, isMatron, isPrivileged, canSeeStudents, canSeeFinance,
  } = useAuth();
  const { allows: has } = useLicence();
  const [systems, setSystems] = useState<Integration[]>([]);

  // Which external systems this school has connected decides whether those entries exist at all —
  // a menu item leading to "nothing is configured" is worse than no menu item.
  useEffect(() => {
    if (!isAuthenticated || isSupportStaff) return;
    loadIntegrations()
      .then((state) => setSystems(state.integrations.filter((entry) => entry.enabled && entry.baseUrl)))
      .catch(() => setSystems([]));
  }, [isAuthenticated, isSupportStaff]);

  const elearning = systems.find((entry) => entry.kind === 'elearning');
  const erp = systems.find((entry) => entry.kind === 'erp');
  const { unread } = useLive();

  if (!isAuthenticated) return null;

  const go = (view: Parameters<typeof setActiveView>[0]) => (event: React.MouseEvent) => {
    event.preventDefault();
    setActiveView(view);
  };

  const isCurrent = (view: string) => activeView === view;

  /* The matron has three screens rather than one, so she gets a rail — a short one. Her role is
     support_staff, which is why this is asked before the blanket check below: that check would
     otherwise hand the person who runs the dormitories the same single fees screen as the cook. */
  if (isMatron) {
    return (
      <SideNav
        aria-label="Sections"
        expanded={expanded}
        onOverlayClick={onOverlayClick}
        isPersistent
        className={styles.nav}
      >
        <SideNavItems>
          <SideNavLink renderIcon={Home} isActive={isCurrent('matron')} href="#" onClick={go('matron')}>
            Dormitories
          </SideNavLink>
          <SideNavLink renderIcon={Email} isActive={isCurrent('messages')} href="#" onClick={go('messages')}>
            <span className={styles.itemRow}>
              Messages
              {unread > 0 && <span className={styles.count}>{unread > 99 ? '99+' : unread}</span>}
            </span>
          </SideNavLink>
          <SideNavLink renderIcon={Wallet} isActive={isCurrent('fees')} href="#" onClick={go('fees')}>
            Fees
          </SideNavLink>
        </SideNavItems>
      </SideNav>
    );
  }

  // Support staff have one screen. Showing them a rail with a single entry is worse than showing
  // them none, so the whole rail is theirs only if there is something to choose between.
  if (isSupportStaff) return null;

  return (
    <SideNav
      aria-label="Sections"
      expanded={expanded}
      onOverlayClick={onOverlayClick}
      isPersistent
      className={styles.nav}
    >
      <SideNavItems>
        {/* The assistant answers from full student records, so it follows the same fence they do. */}
        {canSeeStudents && has('assistant') && (
          <SideNavLink renderIcon={Chat} isActive={isCurrent('chat')} href="#" onClick={go('chat')}>
            Chat
          </SideNavLink>
        )}
        {canSeeStudents && has('students') && (
          <SideNavLink renderIcon={Group} isActive={isCurrent('students')} href="#" onClick={go('students')}>
            Students
          </SideNavLink>
        )}
        {canSeeStudents && has('records') && (
          <SideNavLink renderIcon={ListChecked} isActive={isCurrent('records')} href="#" onClick={go('records')}>
            Records
          </SideNavLink>
        )}
        {/* Clubs and what a student was asked to bring — one entry, because at the desk it is one
            conversation: what is this child joining, and what have they brought. */}
        {canSeeStudents && has('school_life') && (
          <SideNavLink renderIcon={Events} isActive={isCurrent('school-life')} href="#" onClick={go('school-life')}>
            School Life
          </SideNavLink>
        )}
        {/* Somebody has to cover the dormitories when the matron is off. */}
        {isPrivileged && has('matron') && (
          <SideNavLink renderIcon={Home} isActive={isCurrent('matron')} href="#" onClick={go('matron')}>
            Dormitories
          </SideNavLink>
        )}

        <SideNavLink renderIcon={Email} isActive={isCurrent('messages')} href="#" onClick={go('messages')}>
          <span className={styles.itemRow}>
            Messages
            {unread > 0 && <span className={styles.count}>{unread > 99 ? '99+' : unread}</span>}
          </span>
        </SideNavLink>

        {canSeeStudents && <SideNavDivider />}

        {/* The two items sit on different tiers — the lesson planner is Standard, the examiner is
            Professional — so they are guarded one at a time, and the menu disappears only when a
            school has neither rather than when it lacks one. */}
        {canSeeStudents && (has('lessons') || has('examiner')) && (
          <SideNavMenu renderIcon={Notebook} title="Teaching" defaultExpanded={['lessons', 'examiner'].includes(activeView)}>
            {has('lessons') && (
              <SideNavMenuItem isActive={isCurrent('lessons')} href="#" onClick={go('lessons')}>
                Lesson Planner
              </SideNavMenuItem>
            )}
            {has('examiner') && (
              <SideNavMenuItem isActive={isCurrent('examiner')} href="#" onClick={go('examiner')}>
                Digital Examiner
              </SideNavMenuItem>
            )}
          </SideNavMenu>)}

        <SideNavLink renderIcon={Wallet} isActive={isCurrent('fees')} href="#" onClick={go('fees')}>
          Fees
        </SideNavLink>
        {canSeeFinance && has('fees_billing') && (
          <SideNavLink renderIcon={Money} isActive={isCurrent('finance')} href="#" onClick={go('finance')}>
            Fee Management
          </SideNavLink>
        )}

        {/* Only offered once the school has actually connected something. */}
        {elearning && has('elearning') && (
          <SideNavLink renderIcon={Education} isActive={isCurrent('elearning')} href="#" onClick={go('elearning')}>
            E-Learning
          </SideNavLink>
        )}
        {erp && isPrivileged && has('erp') && (
          <SideNavLink renderIcon={Application} isActive={isCurrent('erp')} href="#" onClick={go('erp')}>
            {erp.label}
          </SideNavLink>
        )}

        {isPrivileged && <SideNavDivider />}

        {isPrivileged && has('school_data') && (
          <SideNavLink renderIcon={DataBase} isActive={isCurrent('data')} href="#" onClick={go('data')}>
            School Data
          </SideNavLink>
        )}
        {isPrivileged && has('monitoring') && (
          <SideNavLink renderIcon={ArrowsHorizontal} isActive={isCurrent('monitoring')} href="#" onClick={go('monitoring')}>
            Monitoring
          </SideNavLink>
        )}
        {isPrivileged && has('audit') && (
          <SideNavLink renderIcon={Time} isActive={isCurrent('audit')} href="#" onClick={go('audit')}>
            Audit Log
          </SideNavLink>
        )}

        {isAdmin && <SideNavDivider />}

        {isAdmin && has('users') && (
          <SideNavLink renderIcon={UserAdmin} isActive={isCurrent('users')} href="#" onClick={go('users')}>
            Staff Access
          </SideNavLink>
        )}
        {isAdmin && has('settings') && (
          <SideNavLink renderIcon={SettingsIcon} isActive={isCurrent('settings')} href="#" onClick={go('settings')}>
            Settings
          </SideNavLink>
        )}
      </SideNavItems>
    </SideNav>
  );
};

export default AppSideNav;
