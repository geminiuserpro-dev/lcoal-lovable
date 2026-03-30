import { SandboxFile } from '../types';

export interface DeployResult {
  url: string;
  deployId: string;
  provider: 'vercel' | 'netlify' | 'cloudflare';
}

export const DeployService = {
  async deployToVercel(files: Map<string, SandboxFile>, projectName: string): Promise<DeployResult> {
    const token = import.meta.env.VITE_VERCEL_TOKEN || process.env.VERCEL_TOKEN;
    if (!token) throw new Error('VITE_VERCEL_TOKEN not configured');

    const fileMap: Record<string, string> = {};
    for (const [path, file] of files.entries()) {
      fileMap[path] = btoa(unescape(encodeURIComponent(file.content)));
    }

    const resp = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 52),
        files: Object.entries(fileMap).map(([file, data]) => ({ file, data, encoding: 'base64' })),
        projectSettings: { framework: 'vite', buildCommand: 'npm run build', outputDirectory: 'dist' },
        public: true,
      }),
    });

    if (!resp.ok) throw new Error(`Vercel deploy failed: ${await resp.text()}`);
    const data = await resp.json();
    return {
      url: `https://${data.url}`,
      deployId: data.id,
      provider: 'vercel',
    };
  },

  async deployToNetlify(files: Map<string, SandboxFile>): Promise<DeployResult> {
    const token = import.meta.env.VITE_NETLIFY_TOKEN || process.env.NETLIFY_TOKEN;
    if (!token) throw new Error('VITE_NETLIFY_TOKEN not configured');

    // Create site first
    const siteResp = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const site = await siteResp.json();

    // Deploy files
    const fileDigests: Record<string, string> = {};
    for (const [path] of files.entries()) {
      fileDigests[`/${path}`] = path; // simplified
    }

    const deployResp = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: fileDigests }),
    });
    const deploy = await deployResp.json();

    return {
      url: `https://${site.subdomain}.netlify.app`,
      deployId: deploy.id,
      provider: 'netlify',
    };
  },

  async deployViaServer(files: Map<string, SandboxFile>, projectName: string): Promise<DeployResult> {
    const fileObj: Record<string, string> = {};
    for (const [path, file] of files.entries()) {
      fileObj[path] = file.content;
    }

    const resp = await fetch('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: fileObj, projectName }),
    });

    if (!resp.ok) throw new Error(`Deploy failed: ${await resp.text()}`);
    return resp.json();
  },
};
