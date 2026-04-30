import React, { useState, useRef, useCallback } from 'react';
import { Bot, Check, ChevronDown, Send, Sparkles } from 'lucide-react';
import VoiceRecorder from './VoiceRecorder';
import ImageUpload from './ImageUpload';
import { useChatContext } from '@/contexts/ChatContext';
import type { Attachment } from '@/types/chat';

const ChatInput: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ data: string; name: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const { sendMessage, isLoading, aiModels, selectedModelId, setSelectedModelId } = useChatContext();
  const selectedModel = aiModels.find(model => model.id === selectedModelId) || aiModels[0];

  const handleSubmit = useCallback(async () => {
    const text = inputText.trim();
    if (!text && !selectedImage) return;
    if (isLoading) return;

    const attachments: Attachment[] = [];
    if (selectedImage) {
      attachments.push({
        type: 'image',
        data: selectedImage.data,
        name: selectedImage.name,
      });
    }

    setInputText('');
    setSelectedImage(null);
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    await sendMessage(text || 'Please analyze this image.', attachments.length > 0 ? attachments : undefined);
  }, [inputText, selectedImage, isLoading, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, []);

  const handleVoiceTranscription = useCallback((text: string) => {
    setInputText(prev => prev ? `${prev} ${text}` : text);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const handleImageSelect = useCallback((data: string, name: string) => {
    setSelectedImage({ data, name });
  }, []);

  const canSend = (inputText.trim().length > 0 || selectedImage) && !isLoading;

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl">
      {/* Image preview */}
      {selectedImage && (
        <div className="px-4 pt-3">
          <ImageUpload
            onImageSelect={handleImageSelect}
            selectedImage={selectedImage}
            onClear={() => setSelectedImage(null)}
          />
        </div>
      )}

      <div className="px-4 py-3">
        <div className="relative mb-2">
          <button
            type="button"
            onClick={() => setShowModelMenu(prev => !prev)}
            disabled={isLoading}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
            title="Select AI model"
          >
            <Bot className="w-3.5 h-3.5 text-indigo-500" />
            <span className="truncate">
              {selectedModel ? `${selectedModel.label} · ${selectedModel.model}` : 'Local Rules'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>

          {showModelMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  AI Models
                </div>
                {aiModels.map(model => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      setSelectedModelId(model.id);
                      setShowModelMenu(false);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700">
                      {selectedModelId === model.id ? (
                        <Check className="h-3.5 w-3.5 text-indigo-600" />
                      ) : (
                        <Bot className="h-3.5 w-3.5 text-gray-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">
                          {model.label}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                          model.configured
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
                        }`}>
                          {model.configured ? 'Ready' : 'Needs key'}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {model.provider} · {model.model}
                      </p>
                      {model.description && (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-400">
                          {model.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-end gap-2 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-600 focus-within:border-indigo-400 dark:focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-900/30 transition-all duration-200 px-3 py-2">
          {/* Image upload button */}
          {!selectedImage && (
            <ImageUpload
              onImageSelect={handleImageSelect}
              selectedImage={null}
              onClear={() => setSelectedImage(null)}
            />
          )}

          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? 'Recording...' : 'Ask about any student... (e.g., "What is Emma Johnson\'s GPA?")'}
            className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 min-h-[40px] max-h-[150px] py-2 px-1"
            rows={1}
            disabled={isLoading}
          />

          {/* Voice recorder */}
          <VoiceRecorder
            onTranscription={handleVoiceTranscription}
            onRecordingStateChange={setIsRecording}
          />

          {/* Send button */}
          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className={`p-2.5 rounded-xl transition-all duration-200 ${
              canSend
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/30 hover:shadow-xl hover:scale-105'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
            title="Send message"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>

        {/* Helper text */}
        <div className="flex items-center justify-between mt-2 px-1">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <Sparkles className="w-3 h-3" />
            <span>{selectedModel ? selectedModel.label : 'AI'} search across student records</span>
          </div>
          <span className="text-[10px] text-gray-400">
            Press Enter to send, Shift+Enter for new line
          </span>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
