import React from 'react';
import { Search, Users, BookOpen, BarChart3, FileText, Shield, Mic, ImagePlus } from 'lucide-react';
import { useChatContext } from '@/contexts/ChatContext';

const suggestions = [
  { icon: Users, text: 'Show me all students in Grade 10', color: 'from-blue-500 to-cyan-500' },
  { icon: BarChart3, text: 'Who are the top 5 students by GPA?', color: 'from-emerald-500 to-teal-500' },
  { icon: BookOpen, text: 'Tell me about Emma Johnson', color: 'from-purple-500 to-pink-500' },
  { icon: Search, text: 'Which students take Computer Science?', color: 'from-orange-500 to-red-500' },
  { icon: FileText, text: 'Show attendance records for Grade 12', color: 'from-indigo-500 to-violet-500' },
  { icon: Shield, text: 'List all students in Section A', color: 'from-rose-500 to-pink-500' },
];

const WelcomeScreen: React.FC = () => {
  const { sendMessage } = useChatContext();

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      {/* Logo & Title */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center shadow-2xl shadow-indigo-300 dark:shadow-indigo-900/50">
          <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 14l9-5-9-5-9 5 9 5z" />
            <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
            <path d="M12 14l9-5-9-5-9 5 9 5z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 20v-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="absolute -top-1 -right-1 w-6 h-6 bg-gradient-to-r from-emerald-400 to-green-500 rounded-full flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-3">
        SchoolBot AI
      </h1>
      <p className="text-gray-500 dark:text-gray-400 text-center max-w-md mb-2">
        Your intelligent school information assistant. Ask anything about students, grades, attendance, and more.
      </p>

      {/* Capabilities */}
      <div className="flex items-center gap-4 mb-10 mt-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Search className="w-3.5 h-3.5" />
          <span>Text Search</span>
        </div>
        <div className="w-1 h-1 bg-gray-300 rounded-full" />
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Mic className="w-3.5 h-3.5" />
          <span>Voice Input</span>
        </div>
        <div className="w-1 h-1 bg-gray-300 rounded-full" />
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <ImagePlus className="w-3.5 h-3.5" />
          <span>Image Analysis</span>
        </div>
      </div>

      {/* Suggestion Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl w-full">
        {suggestions.map((suggestion, index) => {
          const Icon = suggestion.icon;
          return (
            <button
              key={index}
              onClick={() => sendMessage(suggestion.text)}
              className="group flex items-center gap-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl px-4 py-3.5 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-lg hover:shadow-indigo-100 dark:hover:shadow-indigo-900/20 transition-all duration-200 text-left"
            >
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${suggestion.color} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                <Icon className="w-4.5 h-4.5 text-white" />
              </div>
              <span className="text-sm text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors leading-tight">
                {suggestion.text}
              </span>
            </button>
          );
        })}
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 mt-10 px-6 py-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700">
        <div className="text-center">
          <div className="text-lg font-bold text-indigo-600">15</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Students</div>
        </div>
        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
        <div className="text-center">
          <div className="text-lg font-bold text-purple-600">4</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Grades</div>
        </div>
        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
        <div className="text-center">
          <div className="text-lg font-bold text-emerald-600">3</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Sections</div>
        </div>
        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
        <div className="text-center">
          <div className="text-lg font-bold text-pink-600">93%</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Avg Attendance</div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
