import { SandboxFile } from '../types';

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
}

export const GitHubService = {
  getAuthUrl(): string {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || '';
    const redirect = `${window.location.origin}/auth/github`;
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo&redirect_uri=${redirect}`;
  },

  async exchangeCode(code: string): Promise<string> {
    const resp = await fetch('/api/github/oauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!resp.ok) throw new Error('GitHub OAuth failed');
    const { access_token } = await resp.json();
    return access_token;
  },

  async getRepos(token: string): Promise<GitHubRepo[]> {
    const resp = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!resp.ok) throw new Error('Failed to fetch repos');
    return resp.json();
  },

  async createRepo(token: string, name: string, isPrivate = true): Promise<GitHubRepo> {
    const resp = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
    });
    if (!resp.ok) throw new Error(`Failed to create repo: ${await resp.text()}`);
    return resp.json();
  },

  async pushFiles(token: string, repo: string, files: Map<string, SandboxFile>, message = 'Update from AI Editor'): Promise<void> {
    const [owner, repoName] = repo.split('/');
    
    // Get latest commit SHA
    const refResp = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/main`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    });
    
    let baseTreeSha: string | undefined;
    let parentSha: string | undefined;
    
    if (refResp.ok) {
      const ref = await refResp.json();
      parentSha = ref.object.sha;
      const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/commits/${parentSha}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const commit = await commitResp.json();
      baseTreeSha = commit.tree.sha;
    }

    // Create blobs for each file
    const tree: any[] = [];
    for (const [path, file] of files.entries()) {
      const blobResp = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/blobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      });
      const blob = await blobResp.json();
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    // Create tree
    const treeResp = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/trees`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tree, ...(baseTreeSha ? { base_tree: baseTreeSha } : {}) }),
    });
    const newTree = await treeResp.json();

    // Create commit
    const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/commits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        ...(parentSha ? { parents: [parentSha] } : {}),
      }),
    });
    const newCommit = await commitResp.json();

    // Update ref
    await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/main`, {
      method: parentSha ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sha: newCommit.sha, force: true }),
    });
  },

  getToken(): string | null {
    return sessionStorage.getItem('gh_token');
  },

  saveToken(token: string): void {
    sessionStorage.setItem('gh_token', token);
  },

  clearToken(): void {
    sessionStorage.removeItem('gh_token');
  },
};
