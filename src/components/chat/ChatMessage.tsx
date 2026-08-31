import React, { useState } from 'react';
import type { Message } from '@/types/chat';
import MarkdownRenderer from './MarkdownRenderer';
import AgentTrace from './AgentTrace';
import { Copy, Check, User, Bot } from 'lucide-react';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex gap-3 px-4 py-4 group ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30">
          <Bot className="w-5 h-5 text-white" />
        </div>
      )}

      <div className={`max-w-[75%] ${isUser ? 'order-first' : ''}`}>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-br-md shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30'
              : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-bl-md shadow-sm'
          }`}
        >
          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map((att, idx) => (
                <div key={idx}>
                  {att.type === 'image' && att.data && (
                    <img
                      src={att.data}
                      alt="Uploaded"
                      className="max-w-[200px] max-h-[150px] rounded-lg object-cover border border-white/20"
                    />
                  )}
                  {att.type === 'voice' && (
                    <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                      <span className="text-xs opacity-80">Voice message</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Content */}
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="text-sm">
              <MarkdownRenderer content={message.content} />
              <AgentTrace metadata={message.metadata} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className={`flex items-center gap-2 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-gray-400">
            {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!isUser && (
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Copy message"
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3 text-gray-400" />
              )}
            </button>
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30">
          <User className="w-5 h-5 text-white" />
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
