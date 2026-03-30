import { create } from 'zustand';
import { SandboxFile, TreeNode, ToolConfig, UserPreferences } from '../types';
import { ChatMessage, ToolCall } from '@/lib/tools';
import { ChatMsg } from '@/lib/ai-chat';
import { db, auth } from '@/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

// Module-level debounce timer — must live outside Zustand so clearTimeout works reliably.
let _syncTimer: ReturnType<typeof setTimeout> | null = null;

// Helpers for sessionStorage persistence of transient chat state.
const SESSION_MESSAGES_KEY = 'lc_messages';
const SESSION_HISTORY_KEY  = 'lc_chat_history';

function saveMessagesToSession(messages: ChatMessage[]) {
  try { sessionStorage.setItem(SESSION_MESSAGES_KEY, JSON.stringify(messages.slice(-100))); } catch {}
}
function saveChatHistoryToSession(history: ChatMsg[]) {
  try { sessionStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history.slice(-100))); } catch {}
}
function loadMessagesFromSession(): ChatMessage[] | null {
  try {
    const raw = sessionStorage.getItem(SESSION_MESSAGES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Rehydrate date strings back to Date objects
    return parsed.map((m: any) => ({ ...m, timestamp: m.timestamp ? new Date(m.timestamp) : new Date() }));
  } catch { return null; }
}
function loadChatHistoryFromSession(): ChatMsg[] | null {
  try {
    const raw = sessionStorage.getItem(SESSION_HISTORY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

interface EditorState {
  // Sandbox State
  sandboxId: string | null;
  status: 'idle' | 'creating' | 'ready' | 'error';
  error: string | undefined;
  
  // File State
  files: Map<string, SandboxFile>;
  selectedFile: string | null;
  openTabs: string[];
  fileVersion: number;
  workDir: string;
  repoUrl: string | null;
  projectId: string | null;
  
  // Preview State
  previewUrl: string | null;
  previewStatus: 'idle' | 'starting' | 'running' | 'error';
  
  // Project Info
  projectName: string;

  // UI State
  view: 'code' | 'preview' | 'security';

  // Chat State
  messages: ChatMessage[];
  chatHistory: ChatMsg[];

  // Tool Configurations
  toolConfigs: ToolConfig[];

  // User Preferences
  preferences: UserPreferences;

  // Actions
  setSandboxId: (id: string | null) => void;
  setStatus: (status: EditorState['status']) => void;
  setError: (error: string | undefined) => void;
  setFiles: (files: Map<string, SandboxFile>) => void;
  addOrUpdateFile: (path: string, content: string) => void;
  removeFile: (path: string) => void;
  setSelectedFile: (path: string | null) => void;
  setOpenTabs: (tabs: string[]) => void;
  closeTab: (path: string) => void;
  setPreviewUrl: (url: string | null) => void;
  setPreviewStatus: (status: EditorState['previewStatus']) => void;
  setWorkDir: (dir: string) => void;
  setRepoUrl: (url: string | null) => void;
  setProjectId: (id: string | null) => void;
  setProjectName: (name: string) => void;
  setView: (view: EditorState['view']) => void;
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setChatHistory: (history: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) => void;
  setToolConfigs: (configs: ToolConfig[]) => void;
  updateToolConfig: (id: string, updates: Partial<ToolConfig>) => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => void;
  reset: () => void;
  
  // Cloud Sync
  syncToCloud: () => Promise<void>;
  loadFromCloud: (userId: string) => Promise<void>;
}

const initialState = {
  sandboxId: null,
  status: 'idle' as const,
  error: undefined,
  files: new Map<string, SandboxFile>(),
  selectedFile: null,
  openTabs: [],
  fileVersion: 0,
  workDir: '/home/daytona/workspace',
  repoUrl: null,
  projectId: null,
  previewUrl: null,
  previewStatus: 'idle' as const,
  projectName: 'Lovable Clone',
  view: 'code' as const,
  messages: [
    {
      id: "welcome",
      role: "assistant" as const,
      content:
        "Hi! I'm your AI assistant powered by **Gemini 3 Flash**. I can write code, search files, manage packages, and run code in a **Daytona sandbox**. Try asking me to build something!",
      timestamp: new Date(),
    },
  ],
  chatHistory: [],
  toolConfigs: [
    { id: 'lov_write', name: 'Write File', enabled: true, settings: {} },
    { id: 'lov_view', name: 'View File', enabled: true, settings: {} },
    { id: 'lov_execute', name: 'Execute Command', enabled: true, settings: {} },
    { id: 'lov_web_search', name: 'Web Search', enabled: true, settings: {} },
    { id: 'lov_fetch_website', name: 'Fetch Website', enabled: true, settings: {} },
  ],
  preferences: {
    theme: 'system' as const,
    fontSize: 14,
    showLineNumbers: true,
    autoSave: true,
  },
};

export const useStore = create<EditorState>()((set, get) => ({
  ...initialState,

  setSandboxId: (id) => {
    set({ sandboxId: id });
    get().syncToCloud();
  },
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setFiles: (files) => {
    set({ files, fileVersion: get().fileVersion + 1 });
  },
  
  addOrUpdateFile: (path, content) => set((state) => {
    const next = new Map(state.files);
    next.set(path, { path, content, lastModified: new Date() });
    return { files: next, fileVersion: state.fileVersion + 1 };
  }),
  
  removeFile: (path) => set((state) => {
    const next = new Map(state.files);
    next.delete(path);
    return { files: next, fileVersion: state.fileVersion + 1 };
  }),
  
  setSelectedFile: (path) => set((state) => {
    if (!path) return { selectedFile: null };
    const nextTabs = state.openTabs.includes(path) 
      ? state.openTabs 
      : [...state.openTabs, path];
    return { selectedFile: path, openTabs: nextTabs };
  }),
  
  setOpenTabs: (tabs) => set({ openTabs: tabs }),
  
  closeTab: (path) => set((state) => {
    const nextTabs = state.openTabs.filter((t) => t !== path);
    let nextSelected = state.selectedFile;
    if (state.selectedFile === path) {
      nextSelected = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : null;
    }
    return { openTabs: nextTabs, selectedFile: nextSelected };
  }),
  
  setPreviewUrl: (url) => set({ previewUrl: url }),
  setPreviewStatus: (status) => set({ previewStatus: status }),
  setWorkDir: (dir) => {
    set({ workDir: dir });
    get().syncToCloud();
  },
  setRepoUrl: (url) => {
    set({ repoUrl: url });
    get().syncToCloud();
  },
  setProjectId: (id) => {
    set({ projectId: id });
    get().syncToCloud();
  },
  setProjectName: (name) => {
    set({ projectName: name });
    get().syncToCloud();
  },
  setView: (view) => set({ view }),
  
  setMessages: (messages) => {
    set((state) => {
      const next = typeof messages === 'function' ? messages(state.messages) : messages;
      saveMessagesToSession(next);
      return { messages: next };
    });
    // Not synced to Firestore — sessionStorage is sufficient for chat messages.
  },
  setChatHistory: (history) => {
    set((state) => {
      const next = typeof history === 'function' ? history(state.chatHistory) : history;
      saveChatHistoryToSession(next);
      return { chatHistory: next };
    });
    // Not synced to Firestore — sessionStorage is sufficient for chat history.
  },
  
  setToolConfigs: (configs) => {
    set({ toolConfigs: configs });
    get().syncToCloud();
  },
  updateToolConfig: (id, updates) => {
    set((state) => ({
      toolConfigs: state.toolConfigs.map((c) => 
        c.id === id ? { ...c, ...updates } : c
      )
    }));
    get().syncToCloud();
  },
  
  updatePreferences: (prefs) => {
    set((state) => ({
      preferences: { ...state.preferences, ...prefs }
    }));
    get().syncToCloud();
  },
  
  reset: () => set(initialState),

  syncToCloud: async () => {
    // Debounce: coalesce rapid successive calls — fire only after 10s of inactivity.
    // Timer is module-level (not Zustand state) so clearTimeout works correctly.
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      _syncTimer = null;
      if (!auth?.currentUser || !db) return;
      const state = get();
      try {
        const stateRef = doc(db, 'sandbox_states', auth.currentUser.uid);
        // Only sync lightweight session fields — NOT messages/chatHistory (those go to sessionStorage).
        await setDoc(stateRef, {
          sandboxId: state.sandboxId,
          workDir: state.workDir,
          repoUrl: state.repoUrl,
          projectId: state.projectId,
          previewActive: state.previewStatus === 'running',
          lastUpdated: serverTimestamp(),
          preferences: state.preferences,
          toolConfigs: state.toolConfigs,
        }, { merge: true });
      } catch (e) {
        console.error("Failed to sync state to cloud:", e);
      }
    }, 10_000);
  },

  loadFromCloud: async (userId: string) => {
    if (!db) return;
    try {
      const stateRef = doc(db, 'sandbox_states', userId);
      const stateSnap = await getDoc(stateRef);
      if (stateSnap.exists()) {
        const data = stateSnap.data();

        set({
          sandboxId: data.sandboxId || null,
          workDir: data.workDir || initialState.workDir,
          repoUrl: data.repoUrl || null,
          projectId: data.projectId || null,
          preferences: data.preferences || initialState.preferences,
          toolConfigs: data.toolConfigs || initialState.toolConfigs,
          // Restore chat from sessionStorage (not Firestore — messages are no longer synced to cloud)
          messages: loadMessagesFromSession() || initialState.messages,
          chatHistory: loadChatHistoryFromSession() || initialState.chatHistory,
        });
      }
    } catch (e) {
      console.error("Failed to load state from cloud:", e);
    }
  }
}));
