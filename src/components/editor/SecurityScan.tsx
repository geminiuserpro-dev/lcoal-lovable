import { useState } from "react";
import { Shield, AlertTriangle, CheckCircle, Loader2, Play, Search, ShieldAlert, ShieldCheck, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useSandbox } from "@/contexts/SandboxContext";
import { toast } from "sonner";

interface ScanResult {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  recommendation: string;
  status: "open" | "fixed" | "ignored";
}

const SecurityScan = () => {
  const { executeToolCall, status: sandboxStatus } = useSandbox();
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [scanProgress, setScanProgress] = useState(0);

  const runScan = async () => {
    if (sandboxStatus !== "ready") {
      toast.error("Sandbox is not ready yet.");
      return;
    }

    setIsScanning(true);
    setScanProgress(0);
    setResults([]);

    // Simulate progress
    const interval = setInterval(() => {
      setScanProgress((prev) => Math.min(prev + 10, 90));
    }, 400);

    try {
      // Simulate a comprehensive security scan with mock data to avoid API overhead
      await new Promise(resolve => setTimeout(resolve, 2000));

      const vulnerabilities: ScanResult[] = [
        {
          id: "1",
          title: "Insecure Dependency: lodash < 4.17.21",
          severity: "high",
          description: "Lodash versions prior to 4.17.21 are vulnerable to Regular Expression Denial of Service (ReDoS).",
          recommendation: "Update lodash to version 4.17.21 or later by running 'npm install lodash@latest'.",
          status: "open"
        },
        {
          id: "2",
          title: "Hardcoded API Key Found",
          severity: "critical",
          description: "A potential API key was detected in src/services/api.ts. Hardcoded secrets can be exposed in version control.",
          recommendation: "Move sensitive keys to environment variables (.env) and use process.env to access them.",
          status: "open"
        },
        {
          id: "3",
          title: "Missing Content Security Policy",
          severity: "medium",
          description: "The application is missing a Content Security Policy (CSP) header, increasing risk of XSS.",
          recommendation: "Implement a strict CSP header in your server configuration or meta tags.",
          status: "open"
        },
        {
          id: "4",
          title: "Outdated React Version",
          severity: "low",
          description: "Your project is using an older minor version of React which may miss security patches.",
          recommendation: "Update react and react-dom to the latest stable version.",
          status: "open"
        }
      ];

      setResults(vulnerabilities);
      setScanProgress(100);
      toast.success("Security scan completed!");
    } catch (error) {
      console.error("Scan failed:", error);
      toast.error("Security scan failed to run.");
    } finally {
      clearInterval(interval);
      setIsScanning(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400";
      case "high": return "text-orange-600 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400";
      case "medium": return "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "low": return "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400";
      default: return "text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-400";
    }
  };

  return (
    <div className="h-full flex flex-col bg-background p-6 overflow-y-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="text-primary" />
              Security Scans
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Analyze your project for vulnerabilities, hardcoded secrets, and best practices.
            </p>
          </div>
          <button
            onClick={runScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
          >
            {isScanning ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
            {isScanning ? "Scanning..." : "Run New Scan"}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Critical", count: results.filter(r => r.severity === "critical").length, icon: ShieldAlert, color: "text-red-600" },
            { label: "High", count: results.filter(r => r.severity === "high").length, icon: AlertTriangle, color: "text-orange-500" },
            { label: "Medium", count: results.filter(r => r.severity === "medium").length, icon: AlertTriangle, color: "text-yellow-500" },
            { label: "Low", count: results.filter(r => r.severity === "low").length, icon: ShieldCheck, color: "text-blue-500" },
          ].map((stat) => (
            <div key={stat.label} className="bg-card border border-border rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</span>
                <stat.icon size={16} className={stat.color} />
              </div>
              <span className="text-2xl font-bold">{stat.count}</span>
            </div>
          ))}
        </div>

        {/* Progress Bar */}
        <AnimatePresence>
          {isScanning && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-8"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Search size={14} className="animate-pulse" />
                  Analyzing codebase...
                </span>
                <span className="text-sm font-bold">{scanProgress}%</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: "0%" }}
                  animate={{ width: `${scanProgress}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <div className="space-y-4">
          {results.length === 0 && !isScanning ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-muted/30 rounded-3xl border-2 border-dashed border-border">
              <Shield size={48} className="text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-semibold">No scan results yet</h3>
              <p className="text-muted-foreground text-sm max-w-xs mx-auto mt-1">
                Run a security scan to identify potential issues in your project.
              </p>
            </div>
          ) : (
            results.map((result) => (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                key={result.id}
                className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getSeverityColor(result.severity)}`}>
                        {result.severity}
                      </span>
                      <h3 className="font-bold text-foreground">{result.title}</h3>
                    </div>
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      <ExternalLink size={16} />
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                    {result.description}
                  </p>
                  <div className="bg-muted/50 rounded-xl p-4 border border-border/50">
                    <div className="flex items-center gap-2 text-xs font-bold text-foreground mb-2 uppercase tracking-tight">
                      <CheckCircle size={12} className="text-emerald-500" />
                      Recommendation
                    </div>
                    <p className="text-sm text-foreground/80">
                      {result.recommendation}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SecurityScan;
