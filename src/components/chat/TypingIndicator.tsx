import React from 'react';
import { InlineLoading } from '@carbon/react';
import { Bot } from '@carbon/react/icons';
import styles from './chat.module.scss';

/**
 * The assistant, working.
 *
 * Carbon's InlineLoading rather than three bouncing dots: it says what is happening in words, which
 * matters here because the wait can be several seconds and "searching student records" is a more
 * reassuring thing to read than an animation.
 */
const TypingIndicator: React.FC = () => (
  <div className={styles.message}>
    <div className={`${styles.avatar} ${styles.avatarAssistant}`}>
      <Bot size={20} />
    </div>
    <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
      <span className={styles.typing}>
        <InlineLoading description="Searching student records…" />
      </span>
    </div>
  </div>
);

export default TypingIndicator;
