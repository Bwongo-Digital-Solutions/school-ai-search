import React, { useEffect, useRef, useState } from 'react';
import { Shield, User } from 'lucide-react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';
import WelcomeScreen from './WelcomeScreen';
import AuthModal from './AuthModal';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';

const ChatWindow: React.FC = () => {
  const { messages, isLoading } = useChatContext();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-900 text-sm text-gray-400">
        Checking access
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <div className="flex h-full flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-8 text-center">
          <Shield className="mb-3 h-10 w-10 text-indigo-500" />
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Sign In Required</h2>
          <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
            SchoolBot chat is available only to signed-in teachers and administrators.
          </p>
          <button
            onClick={() => setShowAuthModal(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <User className="h-4 w-4" />
            Sign In
          </button>
        </div>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-50/50 to-white dark:from-gray-900/50 dark:to-gray-900">
      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700"
      >
        {messages.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <div className="max-w-4xl mx-auto py-4">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="max-w-4xl mx-auto w-full">
        <ChatInput />
      </div>
    </div>
  );
};

export default ChatWindow;
