import { create } from 'zustand';
import { SandboxFile } from '../types';

interface StoreState {
  sandboxId: string | null;
  setSandboxId: (id: string | null) => void;
  status: "idle" | "creating" | "ready" | "error";
  setStatus: (status: "idle" | "creating" | "ready" | "error") => void;
  error?: string;
  setError: (error?: string) => void;
  
  files: Map<string, SandboxFile>;
  setFiles: (files: Map<string, SandboxFile>) => void;
  addOrUpdateFile: (path: string, content: string) => void;
  removeFile: (path: string) => void;
  
  selectedFile: string | null;
  setSelectedFile: (file: string | null) => void;
  
  openTabs: string[];
  setOpenTabs: (tabs: string[]) => void;
  closeTab: (tab: string) => void;
  
  previewUrl: string | null;
  setPreviewUrl: (url: string | null) => void;
  
  previewStatus: "idle" | "starting" | "running" | "error";
  setPreviewStatus: (status: "idle" | "starting" | "running" | "error") => void;
  
  fileVersion: number;
  
  workDir: string;
  setWorkDir: (dir: string) => void;
  
  repoUrl: string | null;
  setRepoUrl: (url: string | null) => void;
  
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  
  projectName: string | null;
  setProjectName: (name: string | null) => void;
  
  view: "code" | "preview";
  setView: (view: "code" | "preview") => void;
  
  messages: any[];
  setMessages: (msgs: any[] | ((prev: any[]) => any[])) => void;
  
  chatHistory: any[];
  setChatHistory: (history: any[] | ((prev: any[]) => any[])) => void;
  
  reset: () => void;
}

const initialState = {
  sandboxId: null,
  status: "idle" as const,
  error: undefined,
  files: new Map(),
  selectedFile: null,
  openTabs: [],
  previewUrl: null,
  previewStatus: "idle" as const,
  fileVersion: 0,
  workDir: "/project",
  repoUrl: null,
  projectId: null,
  projectName: null,
  view: "code" as const,
  messages: [],
  chatHistory: [],
};

export const useStore = create<StoreState>((set) => ({
  ...initialState,
  
  setSandboxId: (id) => set({ sandboxId: id }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  
  setFiles: (files) => set((state) => ({ files, fileVersion: state.fileVersion + 1 })),
  addOrUpdateFile: (path, content) => set((state) => {
    const newFiles = new Map(state.files);
    newFiles.set(path, { path, content, lastModified: new Date() });
    return { files: newFiles, fileVersion: state.fileVersion + 1 };
  }),
  removeFile: (path) => set((state) => {
    const newFiles = new Map(state.files);
    newFiles.delete(path);
    return {
      files: newFiles,
      openTabs: state.openTabs.filter(t => t !== path),
      selectedFile: state.selectedFile === path ? null : state.selectedFile,
      fileVersion: state.fileVersion + 1
    };
  }),
  
  setSelectedFile: (file) => set((state) => {
    const newTabs = file && !state.openTabs.includes(file) 
      ? [...state.openTabs, file]
      : state.openTabs;
    return { selectedFile: file, openTabs: newTabs };
  }),
  
  setOpenTabs: (tabs) => set({ openTabs: tabs }),
  closeTab: (tab) => set((state) => {
    const newTabs = state.openTabs.filter(t => t !== tab);
    return { 
      openTabs: newTabs,
      selectedFile: state.selectedFile === tab ? (newTabs[0] || null) : state.selectedFile
    };
  }),
  
  setPreviewUrl: (url) => set({ previewUrl: url }),
  setPreviewStatus: (status) => set({ previewStatus: status }),
  
  setWorkDir: (dir) => set({ workDir: dir }),
  setRepoUrl: (url) => set({ repoUrl: url }),
  setProjectId: (id) => set({ projectId: id }),
  setProjectName: (name) => set({ projectName: name }),
  setView: (view) => set({ view }),
  setMessages: (updater) => set((state) => ({ messages: typeof updater === 'function' ? updater(state.messages) : updater })),
  setChatHistory: (updater) => set((state) => ({ chatHistory: typeof updater === 'function' ? updater(state.chatHistory) : updater })),
  
  reset: () => set(initialState),
}));
