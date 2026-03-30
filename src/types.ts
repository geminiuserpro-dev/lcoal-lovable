export interface SandboxFile {
  path: string;
  content: string;
  lastModified: Date;
}

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
};

export interface Project {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  repoUrl: string | null;
  storagePath?: string;
  lastModified: any;
  createdAt: any;
  isPublic?: boolean;
  shareToken?: string;
  publishedUrl?: string;
}

export interface ToolConfig {
  id: string;
  name: string;
  enabled: boolean;
  settings: Record<string, any>;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  showLineNumbers: boolean;
  autoSave: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'user' | 'admin' | 'pro';
  plan: 'free' | 'pro' | 'team';
  credits: number;
  creditsUsed: number;
  creditsResetAt: any;
  createdAt: any;
  lastLogin: any;
}

export interface Template {
  id: string;
  title: string;
  description: string;
  category: string;
  prompt: string;
  gradient: string;
  badge?: string;
  popular?: boolean;
}
