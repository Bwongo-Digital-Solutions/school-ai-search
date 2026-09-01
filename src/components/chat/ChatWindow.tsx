import React, { useEffect, useRef, useState } from 'react';
import { Button, InlineLoading } from '@carbon/react';
import { Locked, User } from '@carbon/react/icons';
import { AccessDenied } from '@/components/common';
import styles from './chat.module.scss';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';
import WelcomeScreen from './WelcomeScreen';
import AuthModal from './AuthModal';
import { useChatContext } from '@/contexts/ChatContext';
import { useAuth } from '@/contexts/AuthContext';

const ChatWindow: React.FC = () => {
  const { messages, isLoading } = useChatContext();
  const { isAuthenticated, isSupportStaff, isLoading: authLoading } = useAuth();
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
      <div className={styles.checking}>
        <InlineLoading description="Checking access…" />
      </div>
    );
  }

  // The assistant answers from the full student dataset, so it is closed to support staff.
  if (isSupportStaff) {
    return (
      <AccessDenied
        title="Restricted to teachers and administrators"
        message="The assistant answers using complete student records. Support staff accounts can see school fees payment status."
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <div className={styles.gate}>
          <Locked size={32} />
          <h2 className={styles.gateTitle}>Sign in to continue</h2>
          <p className={styles.gateCopy}>
            The assistant is available to signed-in school staff.
          </p>
          <Button renderIcon={User} onClick={() => setShowAuthModal(true)}>
            Sign in
          </Button>
        </div>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </>
    );
  }

  return (
    <div className={styles.window}>
      <div ref={scrollContainerRef} className={styles.scroller}>
        {messages.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <div className={styles.thread}>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className={styles.composer}>
        <ChatInput />
      </div>
    </div>
  );
};

export default ChatWindow;
