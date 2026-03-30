import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useFirebase } from "@/components/FirebaseProvider";

type Mode = "signin" | "signup" | "reset";

const Login = () => {
  const navigate = useNavigate();
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset, isAuthReady, user } = useFirebase() as any;
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  if (isAuthReady && user) { navigate("/"); return null; }

  const handleGoogle = async () => {
    setGoogleLoading(true); setError("");
    try { await signInWithGoogle(); toast.success("Welcome!"); navigate("/"); }
    catch (e: any) { setError(e?.message || "Sign-in failed"); }
    finally { setGoogleLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || (mode !== "reset" && !password)) return;
    setLoading(true); setError("");
    try {
      if (mode === "reset") {
        await sendPasswordReset?.(email);
        toast.success("Reset email sent!"); setMode("signin"); return;
      }
      if (mode === "signup") { await signUpWithEmail?.(email, password); toast.success("Welcome!"); }
      else { await signInWithEmail?.(email, password); toast.success("Welcome back!"); }
      navigate("/");
    } catch (e: any) {
      const c = e.code || "";
      setError(c === "auth/user-not-found" ? "No account with that email" :
        c === "auth/wrong-password" ? "Incorrect password" :
        c === "auth/email-already-in-use" ? "Email already in use" :
        c === "auth/weak-password" ? "Password must be 6+ characters" :
        e?.message || "Authentication failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left — form */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 bg-background">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm">

          {/* Logo */}
          <div className="mb-8 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-lg font-black" style={{ background: "linear-gradient(135deg, hsl(258,90%,62%), hsl(330,85%,58%))" }}>
              ♥
            </div>
            <span className="font-bold text-xl">Lovable</span>
          </div>

          <h1 className="text-2xl font-bold mb-1">
            {mode === "reset" ? "Reset password" : mode === "signup" ? "Create your account" : "Log in"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "reset" ? "Enter your email for a reset link" : mode === "signup" ? "Start building for free" : "Welcome back"}
          </p>

          {/* Google */}
          {mode !== "reset" && (
            <button onClick={handleGoogle} disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 h-10 rounded-lg border border-border bg-background hover:bg-muted/50 text-sm font-medium transition-colors mb-4">
              {googleLoading ? <Loader2 size={15} className="animate-spin" /> : (
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              Continue with Google
            </button>
          )}

          {mode !== "reset" && (
            <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
              <div className="flex-1 h-px bg-border" /><span>or</span><div className="flex-1 h-px bg-border" />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full h-10 pl-9 pr-4 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
            </div>
            {mode !== "reset" && (
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                <input type={showPw ? "text" : "password"} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
                  className="w-full h-10 pl-9 pr-9 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
                  {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                <AlertCircle size={12} />{error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full h-10 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-60">
              {loading && <Loader2 size={14} className="animate-spin" />}
              {mode === "reset" ? "Send reset email" : mode === "signup" ? "Create account" : "Continue"}
              {!loading && <ArrowRight size={14} />}
            </button>
          </form>

          <div className="mt-5 space-y-1.5 text-center text-xs text-muted-foreground">
            {mode === "signin" && <>
              <button onClick={() => { setMode("reset"); setError(""); }} className="block w-full hover:text-foreground transition-colors">Forgot password?</button>
              <button onClick={() => { setMode("signup"); setError(""); }} className="block w-full hover:text-foreground transition-colors">Don't have an account? <span className="text-primary font-medium">Sign up free</span></button>
            </>}
            {mode === "signup" && <button onClick={() => { setMode("signin"); setError(""); }} className="hover:text-foreground">Already have an account? <span className="text-primary font-medium">Log in</span></button>}
            {mode === "reset" && <button onClick={() => { setMode("signin"); setError(""); }} className="hover:text-foreground">← Back to login</button>}
          </div>

          {mode === "signin" && (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              SSO available on <span className="underline cursor-pointer">Business and Enterprise</span> plans
            </p>
          )}
        </motion.div>
      </div>

      {/* Right — gradient panel */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden items-end justify-end p-8"
        style={{ background: "linear-gradient(135deg, hsl(258,70%,60%) 0%, hsl(300,80%,60%) 40%, hsl(330,85%,65%) 70%, hsl(20,90%,65%) 100%)" }}>
        {/* Floating chat prompt */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-white/15 backdrop-blur-xl border border-white/20 rounded-2xl p-4 w-80 shadow-2xl">
          <div className="flex items-center gap-3">
            <input readOnly value="Ask Lovable to build your saas startup..." className="flex-1 bg-transparent text-white placeholder:text-white/60 text-sm outline-none" />
            <button className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
              <ArrowRight size={14} className="text-white" />
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;
