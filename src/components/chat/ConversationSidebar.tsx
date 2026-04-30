import React, { useEffect, useState } from 'react';
import {
  Plus, MessageSquare, Trash2, Search, Clock,
  GraduationCap, Users, BookOpen, ChevronDown, ChevronRight,
  X
} from 'lucide-react';
import { useChatContext } from '@/contexts/ChatContext';

const quickFilters = [
  { label: 'All Students', query: 'List all students with their basic information', icon: Users },
  { label: 'Honor Roll', query: 'Show me honor roll students with GPA above 3.5', icon: GraduationCap },
  { label: 'Grade 9', query: 'Show all Grade 9 students', icon: BookOpen },
  { label: 'Grade 10', query: 'Show all Grade 10 students', icon: BookOpen },
  { label: 'Grade 11', query: 'Show all Grade 11 students', icon: BookOpen },
  { label: 'Grade 12', query: 'Show all Grade 12 students', icon: BookOpen },
  { label: 'Low Attendance', query: 'Which students have attendance below 90%?', icon: Clock },
  { label: 'STEM Students', query: 'Show students taking Computer Science or Physics', icon: GraduationCap },
];

const ConversationSidebar: React.FC = () => {
  const {
    conversations,
    currentConversationId,
    loadConversation,
    loadConversations,
    startNewConversation,
    deleteConversation,
    sendMessage,
    isSidebarOpen,
    setSidebarOpen,
  } = useChatContext();

  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const filteredConversations = conversations.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleQuickFilter = (query: string) => {
    startNewConversation();
    sendMessage(query);
  };

  return (
    <>
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`fixed lg:relative z-40 h-full bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 flex flex-col transition-all duration-300 ${
          isSidebarOpen ? 'w-72 translate-x-0' : 'w-0 -translate-x-full lg:translate-x-0'
        } overflow-hidden`}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 14l9-5-9-5-9 5 9 5z" />
                  <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                </svg>
              </div>
              <span className="font-bold text-sm text-gray-800 dark:text-white">SchoolBot</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => {
              startNewConversation();
              if (window.innerWidth < 1024) setSidebarOpen(false);
            }}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl px-4 py-2.5 text-sm font-medium hover:shadow-lg hover:shadow-indigo-200 dark:hover:shadow-indigo-900/30 transition-all duration-200 hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4" />
            New Conversation
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
            />
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {/* Quick Filters */}
          <div className="mb-4">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1 mb-2 hover:text-gray-600 transition-colors"
            >
              {showFilters ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Quick Filters
            </button>
            {showFilters && (
              <div className="grid grid-cols-2 gap-1.5">
                {quickFilters.map((filter, idx) => {
                  const Icon = filter.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        handleQuickFilter(filter.query);
                        if (window.innerWidth < 1024) setSidebarOpen(false);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] text-gray-600 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all duration-150 border border-transparent hover:border-indigo-200 dark:hover:border-indigo-800"
                    >
                      <Icon className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{filter.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conversation History */}
          <div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-1 mb-2 hover:text-gray-600 transition-colors"
            >
              {showHistory ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Recent Conversations
            </button>
            {showHistory && (
              <div className="space-y-1">
                {filteredConversations.length === 0 ? (
                  <div className="text-center py-6">
                    <MessageSquare className="w-8 h-8 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                    <p className="text-xs text-gray-400">No conversations yet</p>
                    <p className="text-[10px] text-gray-300 dark:text-gray-600">Start a new one above</p>
                  </div>
                ) : (
                  filteredConversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
                        currentConversationId === conv.id
                          ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent'
                      }`}
                      onClick={() => {
                        loadConversation(conv.id);
                        if (window.innerWidth < 1024) setSidebarOpen(false);
                      }}
                    >
                      <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${
                        currentConversationId === conv.id ? 'text-indigo-500' : 'text-gray-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs truncate ${
                          currentConversationId === conv.id
                            ? 'text-indigo-700 dark:text-indigo-300 font-medium'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}>
                          {conv.title}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {conv.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(conv.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-all"
                        title="Delete conversation"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span>AI Assistant Online</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default ConversationSidebar;
