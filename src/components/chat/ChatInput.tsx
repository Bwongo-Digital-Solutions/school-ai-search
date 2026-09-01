import React, { useState, useRef, useCallback } from 'react';
import { Button, Dropdown, MultiSelect, Tag } from '@carbon/react';
import { Ai, Book, Send, Tools } from '@carbon/react/icons';
import VoiceRecorder from './VoiceRecorder';
import ImageUpload from './ImageUpload';
import { useChatContext } from '@/contexts/ChatContext';
import type { Attachment } from '@/types/chat';
import styles from './chat-input.module.scss';

/**
 * An on/off option for the next message.
 *
 * Carbon has no compact toggle chip — its `Toggle` is a form control with a label and a lot of
 * height, which is wrong for a row of three sitting above a text box. This is a ghost Button given
 * a selected state, so it inherits Carbon's focus ring, disabled treatment and hit area, and only
 * the colour is ours.
 */
const ModeToggle = ({
  active,
  onClick,
  disabled,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ElementType;
  label: string;
  title: string;
}) => (
  <Button
    kind="ghost"
    size="sm"
    className={`${styles.toggle} ${active ? styles.toggleOn : ''}`}
    renderIcon={icon}
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-pressed={active}
  >
    {label}
  </Button>
);

const ChatInput: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [selectedImage, setSelectedImage] = useState<{ data: string; name: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showMcpMenu, setShowMcpMenu] = useState(false);
  const {
    sendMessage,
    isLoading,
    aiModels,
    selectedModelId,
    setSelectedModelId,
    chatOptions,
    setChatOptions,
    mcpServers,
  } = useChatContext();
  const selectedModel = aiModels.find(model => model.id === selectedModelId) || aiModels[0];

  // Tool use needs a model that supports it. The rules engine answers from student records alone,
  // so offering Agent or MCP alongside it would promise something the request cannot deliver.
  const supportsTools = Boolean(selectedModel && selectedModel.provider !== 'local_rules');
  const enabledServers = mcpServers.filter(server => server.enabled);

  const setMcpServers = useCallback(
    (selected: string[]) => {
      // Choosing a server implies wanting tools, so turn agent mode on rather than silently
      // ignoring the choice.
      setChatOptions({
        ...chatOptions,
        mcpServerIds: selected,
        agentMode: selected.length > 0 || chatOptions.agentMode,
      });
    },
    [chatOptions, setChatOptions],
  );

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
    <div className={styles.composer}>
      {selectedImage && (
        <div className={styles.preview}>
          <ImageUpload
            onImageSelect={handleImageSelect}
            selectedImage={selectedImage}
            onClear={() => setSelectedImage(null)}
          />
        </div>
      )}

      <div className={styles.inner}>
        {/* What the next message will use. A Carbon Dropdown rather than the hand-rolled menu this
            replaced: it brings its own click-outside, keyboard navigation and focus return, all of
            which the old one had to approximate with a fixed transparent overlay div. */}
        <div className={styles.options}>
          <Dropdown
            id="model-picker"
            className={styles.modelPicker}
            size="sm"
            titleText="Model"
            hideLabel
            label="Local rules"
            disabled={isLoading}
            items={aiModels}
            selectedItem={selectedModel ?? null}
            itemToString={(model) => (model ? `${model.label} · ${model.model}` : 'Local rules')}
            itemToElement={(model) =>
              model ? (
                <span className={styles.modelRow}>
                  <span className={styles.modelName}>
                    {model.label}
                    <Tag type={model.configured ? 'green' : 'magenta'} size="sm">
                      {model.configured ? 'Ready' : 'Needs key'}
                    </Tag>
                  </span>
                  <span className={styles.modelMeta}>
                    {model.provider} · {model.model}
                    {model.description ? ` — ${model.description}` : ''}
                  </span>
                </span>
              ) : null
            }
            onChange={({ selectedItem }) => selectedItem && setSelectedModelId(selectedItem.id)}
          />

          <ModeToggle
            active={chatOptions.agentMode}
            onClick={() => setChatOptions({ ...chatOptions, agentMode: !chatOptions.agentMode })}
            disabled={isLoading || !supportsTools}
            icon={Tools}
            label="Agent"
            title={
              supportsTools
                ? 'Let the assistant look things up with tools before answering'
                : 'The selected model cannot call tools'
            }
          />

          <ModeToggle
            active={chatOptions.useRag}
            onClick={() => setChatOptions({ ...chatOptions, useRag: !chatOptions.useRag })}
            disabled={isLoading}
            icon={Book}
            label="Curriculum"
            title="Search the curriculum library and cite it in the answer"
          />

          {enabledServers.length > 0 && (
            <MultiSelect
              id="mcp-picker"
              className={styles.mcpPicker}
              size="sm"
              titleText="MCP servers"
              hideLabel
              label={
                chatOptions.mcpServerIds.length > 0
                  ? `MCP · ${chatOptions.mcpServerIds.length}`
                  : 'MCP servers'
              }
              disabled={isLoading || !supportsTools}
              items={enabledServers}
              itemToString={(server) =>
                server
                  ? `${server.name} — ${
                      server.last_error
                        ? `last attempt failed: ${server.last_error}`
                        : `${server.discovered_tools.length} tool${
                            server.discovered_tools.length === 1 ? '' : 's'
                          }`
                    }`
                  : ''
              }
              selectedItems={enabledServers.filter((server) =>
                chatOptions.mcpServerIds.includes(server.id),
              )}
              onChange={({ selectedItems }) => setMcpServers(selectedItems.map((s) => s.id))}
            />
          )}
        </div>

        <div className={styles.field}>
          {!selectedImage && (
            <ImageUpload
              onImageSelect={handleImageSelect}
              selectedImage={null}
              onClear={() => setSelectedImage(null)}
            />
          )}

          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? 'Recording…' : 'Ask about any student…'}
            className={styles.textarea}
            rows={1}
            disabled={isLoading}
            aria-label="Your question"
          />

          <VoiceRecorder
            onTranscription={handleVoiceTranscription}
            onRecordingStateChange={setIsRecording}
          />

          <Button
            hasIconOnly
            kind="ghost"
            size="md"
            renderIcon={Send}
            iconDescription="Send message"
            tooltipPosition="top"
            tooltipAlignment="end"
            onClick={handleSubmit}
            disabled={!canSend}
          />
        </div>

        <div className={styles.hints}>
          <span className={styles.hint}>
            <Ai size={16} />
            {selectedModel ? selectedModel.label : 'Local rules'}
            {chatOptions.agentMode ? ' · tools on' : ''}
            {chatOptions.useRag ? ' · curriculum' : ''}
            {chatOptions.mcpServerIds.length > 0 ? ` · ${chatOptions.mcpServerIds.length} MCP` : ''}
          </span>
          <span className={styles.hint}>Enter to send · Shift+Enter for a new line</span>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
