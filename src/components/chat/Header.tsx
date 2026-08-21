import React, { useState } from 'react';
import {
  Menu, Download, Settings, HelpCircle,
  Moon, Sun, X, ChevronDown, LogOut, User, Shield, HardHat,
  MessageSquare, Users, Clock, ClipboardList, UserCog, Wallet, Landmark,
  ClipboardCheck, GraduationCap, NotebookPen
} from 'lucide-react';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';
import { getRoleLabel, getRoleShortLabel } from '@/lib/roles';
import AuthModal from './AuthModal';

const Header: React.FC = () => {
  const { toggleSidebar, messages, activeView, setActiveView } = useChatContext();
  const { user, isAuthenticated, isAdmin, isSupportStaff, signOut } = useAuth();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // The two teaching tools share one nav entry: the bar already carries seven buttons, and adding
  // them individually overflows on a laptop.
  const [showTeachingMenu, setShowTeachingMenu] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isDark, setIsDark] = useState(false);

  const handleExport = (format: 'txt' | 'json' | 'csv') => {
    if (messages.length === 0) {
      alert('No messages to export.');
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

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  const handleSignOut = () => {
    signOut();
    setShowUserMenu(false);
    setActiveView('chat');
  };

  const getUserInitials = () => {
    if (!user) return '?';
    const parts = user.display_name.split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return user.display_name.substring(0, 2).toUpperCase();
  };

  return (
    <>
      <header className="h-14 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-100 dark:border-gray-800 flex items-center justify-between px-4 z-20 relative">
        {/* Left */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
            title="Toggle sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="hidden sm:flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 14l9-5-9-5-9 5 9 5z" />
                <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-800 dark:text-white leading-none">SchoolBot AI</h1>
              <p className="text-[10px] text-gray-400 leading-none mt-0.5">Student Information Assistant</p>
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 ml-2">
            {!isSupportStaff && (
              <button
                onClick={() => setActiveView('chat')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeView === 'chat'
                    ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" /> Chat
              </button>
            )}
            {!isSupportStaff && (
              <button
                onClick={() => setActiveView('students')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeView === 'students'
                    ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Users className="w-3.5 h-3.5" /> Students
              </button>
            )}
            {!isSupportStaff && (
              <button
                onClick={() => setActiveView('records')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeView === 'records'
                    ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5" /> Records
              </button>
            )}
            {!isSupportStaff && (
              <div className="relative">
                <button
                  onClick={() => setShowTeachingMenu(prev => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeView === 'lessons' || activeView === 'examiner'
                      ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <GraduationCap className="w-3.5 h-3.5" /> Teaching
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showTeachingMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowTeachingMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-1 z-50">
                      <button
                        onClick={() => { setActiveView('lessons'); setShowTeachingMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <NotebookPen className="w-3.5 h-3.5" /> Lesson Planner
                      </button>
                      <button
                        onClick={() => { setActiveView('examiner'); setShowTeachingMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <ClipboardCheck className="w-3.5 h-3.5" /> Digital Examiner
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              onClick={() => setActiveView('fees')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeView === 'fees'
                  ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" /> Fees
            </button>
            {isAdmin && (
              <button
                onClick={() => setActiveView('finance')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeView === 'finance'
                    ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Landmark className="w-3.5 h-3.5" /> Finance
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setActiveView('users')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeView === 'users'
                    ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <UserCog className="w-3.5 h-3.5" /> Staff
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setActiveView('audit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeView === 'audit'
                    ? 'bg-white dark:bg-gray-700 text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}

              >
                <Clock className="w-3.5 h-3.5" /> Audit
              </button>
            )}
          </div>
        </div>

        {/* Center - Status */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-full border border-emerald-200 dark:border-emerald-800">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
            Connected to Student Database
          </span>
        </div>

        {/* Right */}
        <div className="flex items-center gap-1">
          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
              title="Export conversation"
            >
              <Download className="w-4 h-4" />
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-1 z-50">
                  <p className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Export As</p>
                  <button onClick={() => handleExport('txt')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <Download className="w-3.5 h-3.5" /> Text File (.txt)
                  </button>
                  <button onClick={() => handleExport('json')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <Download className="w-3.5 h-3.5" /> JSON (.json)
                  </button>
                  <button onClick={() => handleExport('csv')} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <Download className="w-3.5 h-3.5" /> CSV (.csv)
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
            title="Toggle theme"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Help */}
          <div className="relative">
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
              title="Help"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            {showHelp && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowHelp(false)} />
                <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 p-4 z-50">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm text-gray-800 dark:text-white">How to Use SchoolBot</h3>
                    <button onClick={() => setShowHelp(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                      <X className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </div>
                  <div className="space-y-2.5 text-xs text-gray-600 dark:text-gray-400">
                    {isSupportStaff ? (
                      <div className="flex gap-2">
                        <span className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0 text-indigo-600 font-bold text-[10px]">1</span>
                        <span>Your account shows school fees payment status only. Ask an administrator for anything else about a student.</span>
                      </div>
                    ) : (
                      <>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0 text-indigo-600 font-bold text-[10px]">1</span>
                      <span>Type any question about students in the chat box</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0 text-indigo-600 font-bold text-[10px]">2</span>
                      <span>Use voice recording for hands-free queries</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0 text-indigo-600 font-bold text-[10px]">3</span>
                      <span>Upload images of documents for AI analysis</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0 text-indigo-600 font-bold text-[10px]">4</span>
                      <span>Switch to Students tab to manage records directly</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0 text-indigo-600 font-bold text-[10px]">5</span>
                      <span>Admins can use Staff to assign administrator, teacher, and support staff roles</span>
                    </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User avatar / Auth button */}
          <div className="relative ml-1">
            {isAuthenticated && user ? (
              <>
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isAdmin
                      ? 'bg-gradient-to-br from-purple-500 to-indigo-600'
                      : isSupportStaff
                        ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                        : 'bg-gradient-to-br from-blue-500 to-cyan-600'
                  }`}>
                    <span className="text-white text-xs font-bold">{getUserInitials()}</span>
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-xs font-medium text-gray-800 dark:text-white leading-none">
                      {user.display_name}
                    </p>
                    <p className="text-[10px] text-gray-400 leading-none mt-0.5 flex items-center gap-1">
                      {isAdmin ? (
                        <span className="flex items-center gap-0.5">
                          <Shield className="w-2.5 h-2.5 text-purple-500" /> Admin
                        </span>
                      ) : (
                        <span>{getRoleShortLabel(user.role)}</span>
                      )}
                    </p>
                  </div>
                  <ChevronDown className="w-3 h-3 text-gray-400 hidden sm:block" />
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-1 z-50">
                      <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-700">
                        <p className="text-sm font-medium text-gray-800 dark:text-white">{user.display_name}</p>
                        <p className="text-[11px] text-gray-400">{user.auth_email}</p>
                        <div className="mt-1.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            isAdmin
                              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                              : isSupportStaff
                                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                          }`}>
                            {isAdmin ? <Shield className="w-2.5 h-2.5" /> : isSupportStaff ? <HardHat className="w-2.5 h-2.5" /> : <User className="w-2.5 h-2.5" />}
                            {getRoleLabel(user.role)}
                          </span>
                        </div>
                      </div>
                      {!isSupportStaff && (
                        <button
                          onClick={() => { setActiveView('students'); setShowUserMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <Users className="w-3.5 h-3.5" /> Student Management
                        </button>
                      )}
                      {!isSupportStaff && (
                        <button
                          onClick={() => { setActiveView('records'); setShowUserMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <ClipboardList className="w-3.5 h-3.5" /> Student Records
                        </button>
                      )}
                      {!isSupportStaff && (
                        <button
                          onClick={() => { setActiveView('lessons'); setShowUserMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <NotebookPen className="w-3.5 h-3.5" /> Lesson Planner
                        </button>
                      )}
                      {!isSupportStaff && (
                        <button
                          onClick={() => { setActiveView('examiner'); setShowUserMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" /> Digital Examiner
                        </button>
                      )}
                      <button
                        onClick={() => { setActiveView('fees'); setShowUserMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <Wallet className="w-3.5 h-3.5" /> School Fees Status
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => { setActiveView('finance'); setShowUserMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <Landmark className="w-3.5 h-3.5" /> Fee Management
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => { setActiveView('users'); setShowUserMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <UserCog className="w-3.5 h-3.5" /> Staff Access
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => { setActiveView('audit'); setShowUserMenu(false); }}

                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <Clock className="w-3.5 h-3.5" /> Audit Log
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          onClick={() => { setActiveView('settings'); setShowUserMenu(false); }}
                        >
                          <Settings className="w-3.5 h-3.5" /> Settings
                        </button>
                      )}
                      <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                        <button
                          onClick={handleSignOut}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <LogOut className="w-3.5 h-3.5" /> Sign Out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-medium hover:shadow-lg hover:shadow-indigo-200 dark:hover:shadow-indigo-900/30 transition-all"
              >
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </>
  );
};

export default Header;
