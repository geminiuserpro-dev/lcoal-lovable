import { useState } from "react";
import { useSandbox } from "@/contexts/SandboxContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, Shield, BarChart3, CreditCard, Network, FileText, User as UserIcon } from "lucide-react";
import { motion } from "motion/react";

const ToolsTest = () => {
  const { executeToolCall } = useSandbox();
  const [results, setResults] = useState<Record<string, { result: string; loading: boolean }>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [supabaseQuery, setSupabaseQuery] = useState("auth rls");
  const [networkUrl, setNetworkUrl] = useState("https://api.github.com/zen");
  const [securityUrl, setSecurityUrl] = useState("https://google.com");

  const runTool = async (name: string, args: any = {}) => {
    setResults((prev) => ({ ...prev, [name]: { result: "", loading: true } }));
    try {
      const res = await executeToolCall({
        id: `test_${crypto.randomUUID()}`,
        name,
        arguments: args,
        status: "running",
      });
      setResults((prev) => ({ ...prev, [name]: { result: res.result, loading: false } }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [name]: { result: `Error: ${e instanceof Error ? e.message : String(e)}`, loading: false } }));
    }
  };

  const tools = [
    {
      id: "lov_read_network_requests",
      name: "Network Requests",
      icon: Network,
      description: "Read latest network requests from sandbox",
      action: () => runTool("lov_read_network_requests", { search: searchQuery }),
      input: (
        <Input 
          placeholder="Filter by (e.g. http, error)" 
          value={searchQuery} 
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mt-2"
        />
      )
    },
    {
      id: "auth__get_current_user",
      name: "Current User",
      icon: UserIcon,
      description: "Get current authenticated user profile",
      action: () => runTool("auth__get_current_user")
    },
    {
      id: "analytics__read_project_analytics",
      name: "Project Analytics",
      icon: BarChart3,
      description: "Read project usage analytics",
      action: () => runTool("analytics__read_project_analytics", { 
        startdate: "2024-01-01", 
        enddate: "2024-01-07", 
        granularity: "daily" 
      })
    },
    {
      id: "stripe__enable_stripe",
      name: "Enable Stripe",
      icon: CreditCard,
      description: "Install Stripe dependencies",
      action: () => runTool("stripe__enable_stripe")
    },
    {
      id: "security__run_security_scan",
      name: "Security Scan",
      icon: Shield,
      description: "Run security analysis on project",
      action: () => runTool("security__run_security_scan")
    },
    {
      id: "supabase__docs_search",
      name: "Supabase Docs Search",
      icon: Search,
      description: "Search Supabase documentation",
      action: () => runTool("supabase__docs_search", { query: supabaseQuery }),
      input: (
        <Input 
          placeholder="Search query" 
          value={supabaseQuery} 
          onChange={(e) => setSupabaseQuery(e.target.value)}
          className="mt-2"
        />
      )
    },
    {
      id: "network__http_request",
      name: "HTTP Request",
      icon: Network,
      description: "Make a generic HTTP request",
      action: () => runTool("network__http_request", { url: networkUrl }),
      input: (
        <Input 
          placeholder="URL to request" 
          value={networkUrl} 
          onChange={(e) => setNetworkUrl(e.target.value)}
          className="mt-2"
        />
      )
    },
    {
      id: "security__analyze_url",
      name: "URL Security Scan",
      icon: Shield,
      description: "Analyze URL for security headers",
      action: () => runTool("security__analyze_url", { url: securityUrl }),
      input: (
        <Input 
          placeholder="URL to analyze" 
          value={securityUrl} 
          onChange={(e) => setSecurityUrl(e.target.value)}
          className="mt-2"
        />
      )
    }
  ];

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight">Tools Testing Dashboard</h1>
          <p className="text-muted-foreground">Test all custom AI tools integrated into the Lovable Clone.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tools.map((tool) => (
            <Card key={tool.id} className="overflow-hidden border-border/50 shadow-sm hover:shadow-md transition-all">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <tool.icon size={20} />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{tool.name}</CardTitle>
                    <CardDescription className="text-xs">{tool.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {tool.input}
                <Button 
                  onClick={tool.action} 
                  disabled={results[tool.id]?.loading}
                  className="w-full"
                >
                  {results[tool.id]?.loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    "Run Tool"
                  )}
                </Button>
                
                {results[tool.id]?.result && (
                  <ScrollArea className="h-[200px] w-full rounded-md border p-4 bg-muted/30">
                    <pre className="text-[10px] font-mono whitespace-pre-wrap">
                      {results[tool.id].result}
                    </pre>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ToolsTest;
