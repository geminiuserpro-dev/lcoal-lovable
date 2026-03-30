import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Zap, Globe, ExternalLink, Copy, Check, Loader2, Github } from "lucide-react";
import { useSandbox } from "@/contexts/SandboxContext";
import { DeployService } from "@/services/DeployService";
import { GitHubService } from "@/services/GitHubService";
import { toast } from "sonner";

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  projectName: string;
}

const PublishModal = ({ open, onClose, projectName }: PublishModalProps) => {
  const { files } = useSandbox();
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState<{ url: string; provider: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pushingGithub, setPushingGithub] = useState(false);

  const handleDeploy = async (provider: "vercel" | "server") => {
    if (files.size === 0) { toast.error("No files to deploy"); return; }
    setDeploying(true);
    try {
      let result;
      if (provider === "vercel") {
        result = await DeployService.deployToVercel(files, projectName);
      } else {
        result = await DeployService.deployViaServer(files, projectName);
      }
      setDeployed({ url: result.url, provider: result.provider });
      toast.success("Deployed successfully!");
    } catch (e: any) {
      toast.error(`Deploy failed: ${e.message}`);
    } finally {
      setDeploying(false);
    }
  };

  const handleGithubPush = async () => {
    const token = GitHubService.getToken();
    if (!token) {
      // Redirect to GitHub OAuth
      window.location.href = GitHubService.getAuthUrl();
      return;
    }
    setPushingGithub(true);
    try {
      // Create or get repo
      const repos = await GitHubService.getRepos(token);
      const safeName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      let repo = repos.find(r => r.name === safeName);
      if (!repo) {
        repo = await GitHubService.createRepo(token, safeName);
      }
      await GitHubService.pushFiles(token, repo.full_name, files, `Update from AI Editor`);
      toast.success(`Pushed to github.com/${repo.full_name}`);
      window.open(repo.html_url, "_blank");
    } catch (e: any) {
      toast.error(`GitHub push failed: ${e.message}`);
      if (e.message.includes("401") || e.message.includes("auth")) {
        GitHubService.clearToken();
      }
    } finally {
      setPushingGithub(false);
    }
  };

  const copyUrl = async () => {
    if (!deployed) return;
    await navigator.clipboard.writeText(deployed.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.93, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93 }}
            transition={{ type: "spring", bounce: 0.2 }}
            className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <h2 className="text-lg font-bold">Publish your app</h2>
              <button onClick={onClose} className="w-7 h-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted">
                <X size={13} />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-3">
              {deployed ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                      <Globe size={15} className="text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Live on {deployed.provider}</p>
                      <p className="text-xs text-muted-foreground truncate">{deployed.url}</p>
                    </div>
                    <button onClick={copyUrl} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                      {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                  </div>
                  <button
                    onClick={() => window.open(deployed.url, "_blank")}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
                  >
                    <ExternalLink size={14} />
                    Open live app
                  </button>
                  <button onClick={() => setDeployed(null)} className="w-full text-sm text-muted-foreground hover:text-foreground">
                    Deploy again
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground pb-1">Choose where to publish <strong>{projectName}</strong></p>

                  {/* Vercel */}
                  <button
                    onClick={() => handleDeploy("vercel")}
                    disabled={deploying}
                    className="w-full flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary/40 hover:bg-muted/40 transition-all text-left group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-foreground flex items-center justify-center shrink-0">
                      <span className="text-background text-sm font-bold">▲</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Deploy to Vercel</p>
                      <p className="text-xs text-muted-foreground">Free hosting, instant CDN, custom domains</p>
                    </div>
                    {deploying ? <Loader2 size={15} className="animate-spin text-muted-foreground" /> : <Zap size={15} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />}
                  </button>

                  {/* GitHub */}
                  <button
                    onClick={handleGithubPush}
                    disabled={pushingGithub}
                    className="w-full flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary/40 hover:bg-muted/40 transition-all text-left group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <Github size={18} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">Push to GitHub</p>
                      <p className="text-xs text-muted-foreground">Create/update a repo with your code</p>
                    </div>
                    {pushingGithub ? <Loader2 size={15} className="animate-spin text-muted-foreground" /> : <Zap size={15} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />}
                  </button>

                  {/* Download ZIP */}
                  <button
                    onClick={async () => {
                      const { default: JSZip } = await import("jszip");
                      const { saveAs } = await import("file-saver");
                      const zip = new JSZip();
                      for (const [path, file] of files.entries()) {
                        zip.file(path, file.content);
                      }
                      const blob = await zip.generateAsync({ type: "blob" });
                      saveAs(blob, `${projectName.toLowerCase().replace(/\s+/g, "-")}.zip`);
                    }}
                    className="w-full text-sm text-muted-foreground hover:text-foreground py-2 transition-colors"
                  >
                    Download as ZIP instead
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PublishModal;
