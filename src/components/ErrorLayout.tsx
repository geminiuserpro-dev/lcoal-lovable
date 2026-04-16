import React from "react";
import { motion } from "motion/react";
import { Home, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

interface ErrorLayoutProps {
  code?: string | number;
  title: string;
  description: string;
  icon?: React.ReactNode;
  showReload?: boolean;
  errorDetails?: string;
}

const ErrorLayout: React.FC<ErrorLayoutProps> = ({
  code,
  title,
  description,
  icon,
  showReload = false,
  errorDetails,
}) => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Accents */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="space-y-4">
          {icon && (
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner">
                {icon}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {code && (
              <span className="text-sm font-bold tracking-widest text-primary uppercase">
                Error {code}
              </span>
            )}
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              {title}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        {errorDetails && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="bg-muted/50 rounded-xl p-4 text-left border border-border/50 overflow-hidden"
          >
            <p className="text-xs font-mono text-muted-foreground break-all whitespace-pre-wrap">
              {errorDetails}
            </p>
          </motion.div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Button
            variant="outline"
            size="lg"
            className="rounded-xl gap-2 h-12 px-6"
            onClick={() => window.history.back()}
          >
            <ArrowLeft size={18} />
            Go Back
          </Button>

          {showReload ? (
            <Button
              size="lg"
              className="rounded-xl gap-2 h-12 px-6 bg-primary shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={18} />
              Try Again
            </Button>
          ) : (
            <Button
              size="lg"
              className="rounded-xl gap-2 h-12 px-6 bg-primary shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
              onClick={() => { window.location.href = "/"; }}
            >
              <Home size={18} />
              Back to Home
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ErrorLayout;
