import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { Message, Conversation, Attachment, Student, AiModelOption } from '@/types/chat';

type ActiveView = 'chat' | 'students' | 'audit';


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

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChatContext must be used within ChatProvider');
  return context;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [aiModels, setAiModels] = useState<AiModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('local-rules');
  const [activeView, setActiveView] = useState<ActiveView>('chat');

  const refreshStudents = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('students')
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
  }, []);

  useEffect(() => {
    refreshStudents();
  }, [refreshStudents]);

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
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      const convs: Conversation[] = (data || []).map((c: any) => ({
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
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const msgs: Message[] = (data || []).map((m: any) => ({
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
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          message: content,
          conversationId: currentConversationId,
          imageData,
          studentData: students,
          modelId: selectedModelId,
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
        },
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      if (data.conversationId && !currentConversationId) {
        setCurrentConversationId(data.conversationId);
        loadConversations();
      }
    } catch (err: any) {
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
  }, [currentConversationId, loadConversations, students, selectedModelId]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages, conversations, currentConversationId, isLoading,
        isSidebarOpen, students, aiModels, selectedModelId, activeView, setActiveView,
        setSelectedModelId, refreshStudents,
        sendMessage, startNewConversation, loadConversation, loadConversations,
        deleteConversation, toggleSidebar, setSidebarOpen,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
