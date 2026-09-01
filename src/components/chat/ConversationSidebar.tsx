import React, { useEffect, useState } from 'react';
import { Button, Search as CarbonSearch } from '@carbon/react';
import {
  Add,
  Book,
  Chat,
  ChevronDown,
  ChevronRight,
  Close,
  Education,
  Time,
  TrashCan,
  UserMultiple,
} from '@carbon/react/icons';
import { useChatContext } from '@/contexts/ChatContext';
import styles from './conversation-sidebar.module.scss';

/**
 * Saved conversations, and a set of one-tap questions to start from.
 *
 * The quick filters exist because the hardest part of an assistant is the blank box: someone who
 * has not used it does not know what it can be asked. These are the eight questions the school
 * actually asks, phrased as the assistant expects them.
 */

const QUICK_FILTERS = [
  { label: 'All students', query: 'List all students with their basic information', icon: UserMultiple },
  { label: 'Honour roll', query: 'Show me honor roll students with GPA above 3.5', icon: Education },
  { label: 'Grade 9', query: 'Show all Grade 9 students', icon: Book },
  { label: 'Grade 10', query: 'Show all Grade 10 students', icon: Book },
  { label: 'Grade 11', query: 'Show all Grade 11 students', icon: Book },
  { label: 'Grade 12', query: 'Show all Grade 12 students', icon: Book },
  { label: 'Low attendance', query: 'Which students have attendance below 90%?', icon: Time },
  { label: 'STEM students', query: 'Show students taking Computer Science or Physics', icon: Education },
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

  const filtered = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // On a narrow screen the sidebar covers the conversation, so choosing something has to close it.
  const closeIfNarrow = () => {
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  return (
    <>
      {isSidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}

      <div className={`${styles.sidebar} ${isSidebarOpen ? '' : styles.closed}`}>
        <div className={styles.head}>
          <div className={styles.brand}>
            <span className={styles.brandName}>
              <span className={styles.mark}>
                <Education size={16} />
              </span>
              SchoolBot
            </span>
            <Button
              className={styles.closeButton}
              hasIconOnly
              kind="ghost"
              size="sm"
              renderIcon={Close}
              iconDescription="Close the conversation list"
              tooltipPosition="left"
              onClick={() => setSidebarOpen(false)}
            />
          </div>

          <Button
            renderIcon={Add}
            size="md"
            onClick={() => {
              startNewConversation();
              closeIfNarrow();
            }}
          >
            New conversation
          </Button>
        </div>

        <div className={styles.search}>
          <CarbonSearch
            id="conversation-search"
            size="sm"
            labelText="Search conversations"
            placeholder="Search conversations…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onClear={() => setSearchQuery('')}
          />
        </div>

        <div className={styles.scroller}>
          <div className={styles.section}>
            <button
              type="button"
              className={styles.sectionToggle}
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
            >
              {showFilters ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Ask about
            </button>
            {showFilters && (
              <div className={styles.filters}>
                {QUICK_FILTERS.map(({ label, query, icon: Icon }) => (
                  <button
                    key={label}
                    type="button"
                    className={styles.filter}
                    onClick={() => {
                      startNewConversation();
                      sendMessage(query);
                      closeIfNarrow();
                    }}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <button
              type="button"
              className={styles.sectionToggle}
              onClick={() => setShowHistory((open) => !open)}
              aria-expanded={showHistory}
            >
              {showHistory ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Recent
            </button>
            {showHistory && (
              <div className={styles.conversations}>
                {filtered.length === 0 ? (
                  <div className={styles.noConversations}>
                    <Chat size={32} />
                    <p className={styles.noConversationsTitle}>
                      {searchQuery ? 'Nothing matches that' : 'No conversations yet'}
                    </p>
                    <p className={styles.noConversationsHint}>
                      {searchQuery ? 'Try a different word' : 'Start one above'}
                    </p>
                  </div>
                ) : (
                  filtered.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={`${styles.conversation} ${
                        currentConversationId === conversation.id ? styles.current : ''
                      }`}
                      onClick={() => {
                        loadConversation(conversation.id);
                        closeIfNarrow();
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          loadConversation(conversation.id);
                          closeIfNarrow();
                        }
                      }}
                    >
                      <Chat size={16} />
                      <div className={styles.conversationText}>
                        <p className={styles.conversationTitle}>{conversation.title}</p>
                        <p className={styles.conversationDate}>
                          {conversation.createdAt.toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                      <Button
                        className={styles.deleteButton}
                        hasIconOnly
                        kind="danger--ghost"
                        size="sm"
                        renderIcon={TrashCan}
                        iconDescription="Delete this conversation"
                        tooltipPosition="left"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteConversation(conversation.id);
                        }}
                      />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className={styles.foot}>
          <span className={styles.online}>Assistant online</span>
        </div>
      </div>
    </>
  );
};

export default ConversationSidebar;
