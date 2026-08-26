import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Message, MessageMetadata, Conversation, Attachment, Student, AiModelOption } from '@/types/chat';
import type { AgentStep, ChatMode, ChatOptions, Citation, McpServer, McpServerError } from '@/types/agent';
import { callMcp } from '@/lib/teaching';
import type { JsonRecord } from '@/types/auth';

// 'fees' is the read-only payment status view every signed-in role can reach.
// 'finance' is the admin fee management workspace. 'settings' is the admin branding screen.
// 'lessons' and 'examiner' are the teacher-facing planning and assessment workspaces.
// 'monitoring' is the office view of what happened at the gate, the exam room door and the
// registers — the same records the mobile app writes, read back in one place.
type ActiveView =
  | 'chat'
  | 'students'
  | 'records'
  | 'users'
  | 'audit'
  | 'fees'
  | 'finance'
  | 'lessons'
  | 'examiner'
  | 'monitoring'
  | 'settings';


interface ChatContextType {
  messages: Message[];
  conversations: Conversation[];
  currentConversationId: string | null;
  isLoading: boolean;
  isSidebarOpen: boolean;
  students: Student[];
  aiModels: AiModelOption[];
  selectedModelId: string;
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  chatOptions: ChatOptions;
  setChatOptions: (options: ChatOptions) => void;
  mcpServers: McpServer[];
  setSelectedModelId: (modelId: string) => void;
  refreshStudents: () => Promise<void>;
  sendMessage: (content: string, attachments?: Attachment[]) => Promise<void>;
  startNewConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

type ConversationRow = {
  id: string;
  title?: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  role: Message['role'];
  content: string;
  attachments?: Attachment[] | null;
  metadata?: MessageMetadata | null;
  created_at: string;
};

type AiChatResponse = {
  message?: string;
  studentsFound?: number;
  model?: string;
  usage?: JsonRecord;
  conversationId?: string;
  mode?: ChatMode;
  steps?: AgentStep[];
  citations?: Citation[];
  notice?: string;
  mcpErrors?: McpServerError[];
  stoppedAtStepLimit?: boolean;
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChatContext must be used within ChatProvider');
  return context;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Support staff (non-teaching) may only see school fees payment status, so the full
  // student dataset and the AI assistant are never loaded for them.
  const { isSupportStaff, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [aiModels, setAiModels] = useState<AiModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('local-rules');
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [chatOptions, setChatOptions] = useState<ChatOptions>({
    agentMode: false,
    useRag: false,
    mcpServerIds: [],
  });
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);

  const refreshStudents = useCallback(async () => {
    if (isSupportStaff) {
      setStudents([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from<Student[]>('students')
        .select('*')
        .order('last_name');
      if (error) {
        console.error('Error fetching students:', error);
        return;
      }
      setStudents(data || []);
    } catch (err) {
      console.error('Failed to load students:', err);
    }
  }, [isSupportStaff]);

  useEffect(() => {
    refreshStudents();
  }, [refreshStudents]);

  // The MCP registry is admin-only to edit, so a teacher's request is refused and simply yields no
  // servers to pick from. That is why the failure is swallowed rather than surfaced.
  useEffect(() => {
    if (!user || isSupportStaff) {
      setMcpServers([]);
      return;
    }

    callMcp<{ servers: McpServer[] }>('list', {}, user)
      .then(result => setMcpServers(result.servers || []))
      .catch(() => setMcpServers([]));
  }, [user, isSupportStaff]);

  // Support staff have exactly one view; keep them on it even if another view was left active.
  useEffect(() => {
    if (isSupportStaff) setActiveView('fees');
  }, [isSupportStaff]);

  useEffect(() => {
    const loadAiModels = async () => {
      try {
        const { data, error } = await supabase.functions.invoke<{ models: AiModelOption[] }>('ai-models', {
          body: {},
        });
        if (error) throw error;

        const models = data?.models || [];
        setAiModels(models);
        if (models.length > 0 && !models.some(model => model.id === selectedModelId)) {
          setSelectedModelId(models[0].id);
        }
      } catch (err) {
        console.error('Failed to load AI models:', err);
        setAiModels([
          {
            id: 'local-rules',
            label: 'Local Rules',
            provider: 'local_rules',
            model: 'student-search-rules',
            type: 'local',
            description: 'Fast local student search without external API calls.',
            configured: true,
          },
        ]);
      }
    };

    loadAiModels();
  }, [selectedModelId]);

  const loadConversations = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from<ConversationRow[]>('conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      const convs: Conversation[] = (data || []).map((c) => ({
        id: c.id,
        title: c.title || 'Untitled',
        createdAt: new Date(c.created_at),
        updatedAt: new Date(c.updated_at),
      }));
      setConversations(convs);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const { data, error } = await supabase
        .from<MessageRow[]>('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const msgs: Message[] = (data || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments || [],
        metadata: m.metadata || {},
        createdAt: new Date(m.created_at),
      }));
      setMessages(msgs);
      setCurrentConversationId(id);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setCurrentConversationId(null);
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await supabase.from('conversations').delete().eq('id', id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
        startNewConversation();
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }, [currentConversationId, startNewConversation]);

  const sendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    if (isSupportStaff) return;
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      attachments,
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    try {
      let imageData: string | undefined;
      if (attachments?.some(a => a.type === 'image')) {
        const imgAttachment = attachments.find(a => a.type === 'image');
        imageData = imgAttachment?.data || imgAttachment?.url;
      }
      const { data, error } = await supabase.functions.invoke<AiChatResponse>('ai-chat', {
        body: {
          message: content,
          conversationId: currentConversationId,
          imageData,
          studentData: students,
          modelId: selectedModelId,
          mode: chatOptions.agentMode ? 'agent' : 'direct',
          useRag: chatOptions.useRag,
          mcpServerIds: chatOptions.mcpServerIds,
        },
      });
      if (error) throw error;
      const assistantMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: data.message || 'Sorry, I could not process your request.',
        metadata: {
          studentsFound: data.studentsFound,
          model: data.model,
          usage: data.usage,
          mode: data.mode,
          steps: data.steps,
          citations: data.citations,
          notice: data.notice,
          mcpErrors: data.mcpErrors,
          stoppedAtStepLimit: data.stoppedAtStepLimit,
        },
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      if (data.conversationId && !currentConversationId) {
        setCurrentConversationId(data.conversationId);
        loadConversations();
      }
    } catch (err: unknown) {
      console.error('Failed to send message:', err);
      const errorMessage: Message = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: 'I apologize, but I encountered an error processing your request. Please try again.',
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [currentConversationId, loadConversations, students, selectedModelId, isSupportStaff, chatOptions]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages, conversations, currentConversationId, isLoading,
        isSidebarOpen, students, aiModels, selectedModelId, activeView, setActiveView,
        chatOptions, setChatOptions, mcpServers,
        setSelectedModelId, refreshStudents,
        sendMessage, startNewConversation, loadConversation, loadConversations,
        deleteConversation, toggleSidebar, setSidebarOpen,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
