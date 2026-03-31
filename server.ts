import "dotenv/config";
import app from "./api/index";

const PORT = 3000;

async function startServer() {
  // Vite middleware for development (only when not in production and not in Vercel)
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite development middleware loaded.");
    } catch (err) {
      console.warn("Vite failed to load (expected on production Vercel):", err);
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\x1b[32m\n🚀 Consolidated Server running on http://localhost:${PORT}\x1b[0m`);
    console.log(`\x1b[34mAI, Daytona (SDK), and Vercel endpoints are all active.\x1b[0m\n`);
  });
}

// Start the server
startServer();
