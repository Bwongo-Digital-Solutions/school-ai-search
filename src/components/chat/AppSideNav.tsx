import React from 'react';
import {
  SideNav,
  SideNavDivider,
  SideNavItems,
  SideNavLink,
  SideNavMenu,
  SideNavMenuItem,
} from '@carbon/react';
import {
  ArrowsHorizontal,
  Chat,
  Email,
  Group,
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
import { useChatContext } from '@/contexts/ChatContext';
import { useLive } from '@/contexts/LiveContext';
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
  const { isAuthenticated, isAdmin, isSupportStaff } = useAuth();
  const { unread } = useLive();

  if (!isAuthenticated) return null;

  const go = (view: Parameters<typeof setActiveView>[0]) => (event: React.MouseEvent) => {
    event.preventDefault();
    setActiveView(view);
  };

  const isCurrent = (view: string) => activeView === view;

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
        <SideNavLink renderIcon={Chat} isActive={isCurrent('chat')} href="#" onClick={go('chat')}>
          Chat
        </SideNavLink>
        <SideNavLink renderIcon={Group} isActive={isCurrent('students')} href="#" onClick={go('students')}>
          Students
        </SideNavLink>
        <SideNavLink renderIcon={ListChecked} isActive={isCurrent('records')} href="#" onClick={go('records')}>
          Records
        </SideNavLink>

        <SideNavLink renderIcon={Email} isActive={isCurrent('messages')} href="#" onClick={go('messages')}>
          <span className={styles.itemRow}>
            Messages
            {unread > 0 && <span className={styles.count}>{unread > 99 ? '99+' : unread}</span>}
          </span>
        </SideNavLink>

        <SideNavDivider />

        <SideNavMenu renderIcon={Notebook} title="Teaching" defaultExpanded={['lessons', 'examiner'].includes(activeView)}>
          <SideNavMenuItem isActive={isCurrent('lessons')} href="#" onClick={go('lessons')}>
            Lesson Planner
          </SideNavMenuItem>
          <SideNavMenuItem isActive={isCurrent('examiner')} href="#" onClick={go('examiner')}>
            Digital Examiner
          </SideNavMenuItem>
        </SideNavMenu>

        <SideNavLink renderIcon={Wallet} isActive={isCurrent('fees')} href="#" onClick={go('fees')}>
          Fees
        </SideNavLink>
        {isAdmin && (
          <SideNavLink renderIcon={Money} isActive={isCurrent('finance')} href="#" onClick={go('finance')}>
            Fee Management
          </SideNavLink>
        )}

        {isAdmin && <SideNavDivider />}

        {isAdmin && (
          <SideNavLink renderIcon={UserAdmin} isActive={isCurrent('users')} href="#" onClick={go('users')}>
            Staff Access
          </SideNavLink>
        )}
        {isAdmin && (
          <SideNavLink renderIcon={ArrowsHorizontal} isActive={isCurrent('monitoring')} href="#" onClick={go('monitoring')}>
            Monitoring
          </SideNavLink>
        )}
        {isAdmin && (
          <SideNavLink renderIcon={Time} isActive={isCurrent('audit')} href="#" onClick={go('audit')}>
            Audit Log
          </SideNavLink>
        )}
        {isAdmin && (
          <SideNavLink renderIcon={SettingsIcon} isActive={isCurrent('settings')} href="#" onClick={go('settings')}>
            Settings
          </SideNavLink>
        )}
      </SideNavItems>
    </SideNav>
  );
};

export default AppSideNav;
