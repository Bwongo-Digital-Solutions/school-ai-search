import React, { useState } from 'react';
import {
  Header as CarbonHeader,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  InlineLoading,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  SkipToContent,
  Tag,
  TextArea,
  TextInput,
  Theme,
} from '@carbon/react';
import {
  Asleep,
  Download,
  Email,
  Help,
  Light,
  User as UserIcon,
  UserAdmin,
} from '@carbon/react/icons';
import { downloadFromUrl, printFromUrl } from '@/lib/download';
import { callChatReport, teachingDocumentUrl } from '@/lib/teaching';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLive } from '@/contexts/LiveContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useTheme } from '@/components/theme-provider';
import { getRoleLabel } from '@/lib/roles';
import AuthModal from './AuthModal';
import GlobalSearch from './GlobalSearch';
import AppSideNav from './AppSideNav';
import styles from './header.module.scss';

/**
 * The app header, on Carbon's UI Shell.
 *
 * The shell is the part of Carbon most worth adopting: it already knows what a product header is —
 * a brand slot, a navigation row that collapses on small screens, a global action bar on the right.
 * The sections, the export menu and the account menu stop being hand-rolled dropdowns with their
 * own click-outside handling and become `HeaderNavigation`, `OverflowMenu` and `HeaderGlobalAction`.
 *
 * Flat, not raised: no gradients, no drop shadows, no pill corners. Separation comes from borders
 * and from Carbon's layer tokens, which is how the design system distinguishes surfaces.
 *
 * Every role gate is unchanged — support staff still see only fees, administrators still see
 * everything, and the same views are reachable from the account menu as before.
 */
const Header: React.FC = () => {
  const { messages, activeView, setActiveView, currentConversationId } = useChatContext();
  const { user, isAuthenticated, isAdmin, isSupportStaff, isPrivileged, canSeeStudents, canSeeFinance, signOut } =
    useAuth();
  const { unread } = useLive();
  const { theme, setTheme } = useTheme();
  const { notify } = useNotifications();

  const [buildingReport, setBuildingReport] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [sending, setSending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  // The rail is persistent on wide screens and overlays on narrow ones; this is only the small
  // screen's open state, which the header's menu button drives.
  const [navExpanded, setNavExpanded] = useState(false);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  // The dropdowns these closed are now OverflowMenus, which close themselves. Kept as no-ops so the
  // export and report handlers below are the same code they were, rather than a careful rewrite of
  // logic that was working.
  const setShowExportMenu = (_open: boolean) => undefined;
  const setShowUserMenu = (_open: boolean) => undefined;

  const handleExport = (format: 'txt' | 'json' | 'csv') => {
    if (messages.length === 0) {
      notify.info('Nothing to export', 'Ask something first — this conversation is empty.');
      setShowExportMenu(false);
      return;
    }
    let content = '';
    let filename = `schoolbot-chat-${new Date().toISOString().split('T')[0]}`;
    let mimeType = 'text/plain';
    if (format === 'txt') {
      content = messages.map(m =>
        `[${m.createdAt.toLocaleString()}] ${m.role === 'user' ? 'You' : 'SchoolBot'}: ${m.content}`
      ).join('\n\n');
      filename += '.txt';
    } else if (format === 'json') {
      content = JSON.stringify(messages.map(m => ({
        role: m.role, content: m.content, timestamp: m.createdAt.toISOString(),
      })), null, 2);
      filename += '.json';
      mimeType = 'application/json';
    } else if (format === 'csv') {
      content = 'Timestamp,Role,Content\n' + messages.map(m =>
        `"${m.createdAt.toISOString()}","${m.role}","${m.content.replace(/"/g, '""')}"`
      ).join('\n');
      filename += '.csv';
      mimeType = 'text/csv';
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  /**
   * Downloads the conversation as a branded PDF the school can file or hand over.
   *
   * Built server-side from the saved messages rather than from what is on screen, so it carries the
   * sources and tools behind each answer — the things that make a printed answer checkable.
   */
  const handleReportDownload = async () => {
    if (!currentConversationId) {
      notify.info('Nothing to report on yet', 'Send a message first, so there is a saved conversation.');
      setShowExportMenu(false);
      return;
    }

    setBuildingReport(true);
    try {
      await downloadFromUrl(
        teachingDocumentUrl(`/api/chat-reports/${currentConversationId}.pdf`, user),
        `schoolbot-report-${new Date().toISOString().split('T')[0]}.pdf`,
      );
      setShowExportMenu(false);
    } catch (err) {
      notify.error('Could not build the report', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBuildingReport(false);
    }
  };

  /** Same report, straight to the printer, without losing the conversation on screen. */
  const handleReportPrint = async () => {
    if (!currentConversationId) {
      notify.info('Nothing to report on yet', 'Send a message first, so there is a saved conversation.');
      setShowExportMenu(false);
      return;
    }

    setBuildingReport(true);
    try {
      await printFromUrl(teachingDocumentUrl(`/api/chat-reports/${currentConversationId}.pdf`, user));
      setShowExportMenu(false);
    } catch (err) {
      notify.error('Could not print the report', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setBuildingReport(false);
    }
  };

  const openSendDialog = () => {
    if (!currentConversationId) {
      notify.info('Nothing to report on yet', 'Send a message first, so there is a saved conversation.');
      setShowExportMenu(false);
      return;
    }
    // Prefilled with the signed-in user's own address: sending yourself a copy is the common case,
    // and it means the field is never blank when someone just wants to file the report.
    setSendTo(user?.auth_email || '');
    setSendNote('');
    setShowExportMenu(false);
    setShowSendDialog(true);
  };

  const handleReportSend = async () => {
    setSending(true);
    try {
      await callChatReport('send', {
        conversationId: currentConversationId,
        recipient: sendTo,
        note: sendNote,
      }, user);
      setShowSendDialog(false);
      notify.success('Report sent', `Delivered to ${sendTo}.`);
    } catch (err) {
      notify.error('Could not send the report', err instanceof Error ? err.message : undefined);
    } finally {
      setSending(false);
    }
  };

  /**
   * Goes through the theme provider rather than toggling the `dark` class on <html> directly, which
   * is what this did before. Carbon's <Theme> reads the provider, so writing the class behind its
   * back left the design system in one theme and the rest of the app in the other.
   */
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  const handleSignOut = () => {
    signOut();
    setShowUserMenu(false);
    setActiveView('chat');
  };

  const go = (view: Parameters<typeof setActiveView>[0]) => () => setActiveView(view);

  return (
    <>
      <Theme theme="g100">
        <CarbonHeader aria-label="eSchool" className={styles.header}>
          <SkipToContent />
          <HeaderMenuButton
            aria-label={navExpanded ? 'Close navigation' : 'Open navigation'}
            onClick={() => setNavExpanded((open) => !open)}
            isActive={navExpanded}
            isCollapsible
          />
          <HeaderName prefix="">SchoolBot&nbsp;AI</HeaderName>

          <HeaderGlobalBar>
            {isAuthenticated && <GlobalSearch />}

            {isAuthenticated && !isSupportStaff && (
              <HeaderGlobalAction
                aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
                onClick={go('messages')}
                isActive={activeView === 'messages'}
                tooltipAlignment="end"
              >
                <span className={styles.badgeWrap}>
                  <Email size={20} />
                  {unread > 0 && <span className={styles.badge}>{unread > 99 ? '99+' : unread}</span>}
                </span>
              </HeaderGlobalAction>
            )}

            <OverflowMenu
              aria-label="Export conversation"
              renderIcon={Download}
              flipped
              size="lg"
              menuOptionsClass={styles.menu}
            >
              <OverflowMenuItem
                itemText={buildingReport ? 'Building report…' : 'Printable report (.pdf)'}
                onClick={handleReportDownload}
                disabled={buildingReport}
              />
              <OverflowMenuItem itemText="Print report" onClick={handleReportPrint} disabled={buildingReport} />
              <OverflowMenuItem itemText="Email report…" onClick={openSendDialog} hasDivider />
              <OverflowMenuItem itemText="Text file (.txt)" onClick={() => handleExport('txt')} hasDivider />
              <OverflowMenuItem itemText="JSON (.json)" onClick={() => handleExport('json')} />
              <OverflowMenuItem itemText="CSV (.csv)" onClick={() => handleExport('csv')} />
            </OverflowMenu>

            <HeaderGlobalAction
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={toggleTheme}
              tooltipAlignment="end"
            >
              {isDark ? <Light size={20} /> : <Asleep size={20} />}
            </HeaderGlobalAction>

            <HeaderGlobalAction
              aria-label="Help"
              onClick={() => setShowHelp(true)}
              isActive={showHelp}
              tooltipAlignment="end"
            >
              <Help size={20} />
            </HeaderGlobalAction>

            {isAuthenticated && user ? (
              <OverflowMenu
                aria-label={`Account: ${user.display_name}`}
                renderIcon={isAdmin ? UserAdmin : UserIcon}
                flipped
                size="lg"
                menuOptionsClass={styles.menu}
              >
                <OverflowMenuItem itemText={`${user.display_name} — ${getRoleLabel(user.role)}`} disabled />
                {canSeeStudents && (
                  <OverflowMenuItem itemText="Student Management" onClick={go('students')} hasDivider />
                )}
                {canSeeStudents && <OverflowMenuItem itemText="Student Records" onClick={go('records')} />}
                {!isSupportStaff && <OverflowMenuItem itemText="Messages" onClick={go('messages')} />}
                {canSeeStudents && <OverflowMenuItem itemText="Lesson Planner" onClick={go('lessons')} />}
                {canSeeStudents && <OverflowMenuItem itemText="Digital Examiner" onClick={go('examiner')} />}
                <OverflowMenuItem itemText="School Fees Status" onClick={go('fees')} />
                {canSeeFinance && <OverflowMenuItem itemText="Fee Management" onClick={go('finance')} />}
                {isPrivileged && <OverflowMenuItem itemText="School Data" onClick={go('data')} hasDivider />}
                {isPrivileged && <OverflowMenuItem itemText="Monitoring" onClick={go('monitoring')} />}
                {isPrivileged && <OverflowMenuItem itemText="Audit Log" onClick={go('audit')} />}
                {isAdmin && <OverflowMenuItem itemText="Staff Access" onClick={go('users')} hasDivider />}
                {isAdmin && <OverflowMenuItem itemText="Settings" onClick={go('settings')} />}
                <OverflowMenuItem itemText="Sign out" onClick={handleSignOut} isDelete hasDivider />
              </OverflowMenu>
            ) : (
              <HeaderGlobalAction
                aria-label="Sign in"
                onClick={() => setShowAuthModal(true)}
                tooltipAlignment="end"
              >
                <UserIcon size={20} />
              </HeaderGlobalAction>
            )}
          </HeaderGlobalBar>

          {/* The bar above is deliberately dark — it carries the school's colour and white text.
              The rail is not: OpenMRS's is a light surface, and this file's stylesheet is written
              for one, down to the near-black text on the current item. So it steps back out of the
              header's g100 and follows whichever theme the app is actually in. */}
          <Theme theme={isDark ? 'g100' : 'g10'} style={{ display: 'contents' }}>
            <AppSideNav expanded={navExpanded} onOverlayClick={() => setNavExpanded(false)} />
          </Theme>
        </CarbonHeader>
      </Theme>

      <Modal
        open={showHelp}
        modalHeading="How to use SchoolBot"
        passiveModal
        onRequestClose={() => setShowHelp(false)}
        size="sm"
      >
        <ol className={styles.helpList}>
          {(isSupportStaff
            ? [
                'Your account shows school fees payment status only. Ask an administrator for anything else about a student.',
              ]
            : [
                'Type any question about students in the chat box.',
                'Use voice recording for hands-free queries.',
                'Upload images of documents for AI analysis.',
                'Switch to Students to manage records directly.',
                'Administrators can use Staff to assign administrator, teacher and support staff roles.',
              ]
          ).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Modal>

      <Modal
        open={showSendDialog}
        modalHeading="Email this report"
        primaryButtonText={sending ? 'Sending…' : 'Send report'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={sending || !sendTo.trim()}
        onRequestSubmit={handleReportSend}
        onRequestClose={() => setShowSendDialog(false)}
        size="sm"
      >
        <div className={styles.sendFields}>
          <TextInput
            id="report-to"
            type="email"
            labelText="Send to"
            placeholder="name@school.ac.ug"
            value={sendTo}
            onChange={(event) => setSendTo(event.target.value)}
          />
          <TextArea
            id="report-note"
            labelText="Message (optional)"
            placeholder="A short note to go above the report…"
            rows={3}
            value={sendNote}
            onChange={(event) => setSendNote(event.target.value)}
          />
          <p className={styles.fieldNote}>
            The report is attached as a PDF, so the recipient does not need an account to read it. It
            contains whatever student data was discussed — check the address before sending.
          </p>
          {sending && <InlineLoading description="Sending…" />}
        </div>
      </Modal>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </>
  );
};

export default Header;
