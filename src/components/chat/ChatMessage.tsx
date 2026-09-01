import React, { useState } from 'react';
import { Button } from '@carbon/react';
import { Bot, Checkmark, Copy, Microphone, User } from '@carbon/react/icons';
import type { Message } from '@/types/chat';
import MarkdownRenderer from './MarkdownRenderer';
import AgentTrace from './AgentTrace';
import styles from './chat.module.scss';

interface ChatMessageProps {
  message: Message;
}

/**
 * One turn of the conversation.
 *
 * The person's words sit in a filled block in the school's colour; the assistant's in a bordered
 * white one. That is the same figure/ground rule the rest of the app uses, and it means the two are
 * told apart by weight as well as by side — which still works when the school's colour is pale, and
 * when the reader cannot distinguish it from the background at all.
 */
const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const avatar = (
    <div className={`${styles.avatar} ${isUser ? '' : styles.avatarAssistant}`}>
      {isUser ? <User size={20} /> : <Bot size={20} />}
    </div>
  );

  return (
    <div className={`${styles.message} ${isUser ? styles.fromUser : ''}`}>
      {!isUser && avatar}

      <div className={`${styles.column} ${isUser ? styles.columnUser : ''}`}>
        <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}>
          {message.attachments && message.attachments.length > 0 && (
            <div className={styles.attachments}>
              {message.attachments.map((att, idx) => (
                <React.Fragment key={idx}>
                  {att.type === 'image' && att.data && (
                    <img src={att.data} alt="Attached" className={styles.attachmentImage} />
                  )}
                  {att.type === 'voice' && (
                    <span className={styles.attachmentVoice}>
                      <Microphone size={16} />
                      Voice message
                    </span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {isUser ? (
            <p className={styles.text}>{message.content}</p>
          ) : (
            <div className={styles.body}>
              <MarkdownRenderer content={message.content} />
              <AgentTrace metadata={message.metadata} />
            </div>
          )}
        </div>

        <div className={`${styles.meta} ${isUser ? styles.metaUser : ''}`}>
          <span className={styles.time}>
            {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!isUser && (
            <Button
              className={styles.copyButton}
              hasIconOnly
              kind="ghost"
              size="sm"
              renderIcon={copied ? Checkmark : Copy}
              iconDescription={copied ? 'Copied' : 'Copy this answer'}
              tooltipPosition="right"
              onClick={handleCopy}
            />
          )}
        </div>
      </div>

      {isUser && avatar}
    </div>
  );
};

export default ChatMessage;
