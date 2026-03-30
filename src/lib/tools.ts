export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
      additionalProperties: boolean;
    };
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  status: "running" | "completed" | "error";
  result?: string;
  duration?: number;
  thoughtSignature?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  toolCalls?: ToolCall[];
  timestamp: Date;
}

export const allToolDefinitions: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "code--write",
      description: "Write/create file (overwrites). Prefer code--line_replace for most edits. In this mode, preserve large unchanged sections with the exact '// ... keep existing code' comment and only write changed sections. Create multiple files in parallel.",
      parameters: {
        type: "object",
        required: ["file_path", "content"],
        properties: {
          file_path: { type: "string", example: "src/main.ts" },
          content: { type: "string", example: "console.log('Hello, World!')" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--line_replace",
      description: "Search and replace content in a file by line number range. For sections >6 lines, use '...' on its own line in search — include 2-3 identifying lines before and after for unique matching. When making multiple edits to the same file in parallel, always use original line numbers from your initial view — do not adjust for prior edits.",
      parameters: {
        type: "object",
        required: ["file_path", "search", "first_replaced_line", "last_replaced_line", "replace"],
        properties: {
          file_path: { type: "string", example: "src/components/TaskList.tsx" },
          search: { type: "string", description: "Content to search for in the file (without line numbers)" },
          first_replaced_line: { type: "number", description: "First line number to replace (1-indexed)", example: 15 },
          last_replaced_line: { type: "number", description: "Last line number to replace (1-indexed)", example: 28 },
          replace: { type: "string", description: "New content to replace the search content with (without line numbers)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--view",
      description: "Read file contents. Default: first 500 lines. Read multiple files in parallel.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", example: "src/App.tsx" },
          lines: { type: "string", example: "1-800, 1001-1500" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--list_dir",
      description: "List files and directories. Path relative to project root.",
      parameters: {
        type: "object",
        required: ["dir_path"],
        properties: {
          dir_path: { type: "string", example: "src" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--search_files",
      description: "Regex search across project files with glob filtering.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", example: "useEffect\\(.*\\)" },
          search_dir: { type: "string", example: "src" },
          include_patterns: { type: "string", example: "*.ts,*.js" },
          exclude_patterns: { type: "string", example: "*.test.ts,*.test.js" },
          exclude_dirs: { type: "string", example: "node_modules" },
          case_sensitive: { type: "boolean", example: false },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--delete",
      description: "Delete a file or folder (recursive).",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", example: "src/App.tsx" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--rename",
      description: "Rename or move a file.",
      parameters: {
        type: "object",
        required: ["original_file_path", "new_file_path"],
        properties: {
          original_file_path: { type: "string", example: "src/main.ts" },
          new_file_path: { type: "string", example: "src/main_new2.ts" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--copy",
      description: "Copy a file or directory. Useful for copying from virtual file systems (e.g., user-uploads://) to the project.",
      parameters: {
        type: "object",
        required: ["source_file_path", "destination_file_path"],
        properties: {
          source_file_path: { type: "string", example: "src/main.ts" },
          destination_file_path: { type: "string", example: "src/main_copy.ts" },
          overwrite: { type: "boolean", description: "Whether to overwrite the destination if it already exists (default false). Directories will be replaced entirely.", example: true },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--download_to_repo",
      description: "Download a file from a URL and save it to the repo. Prefer src/assets/ for React imports, public/ for CSS/HTML references. Do NOT use for user-uploads:// files.",
      parameters: {
        type: "object",
        required: ["source_url", "target_path"],
        properties: {
          source_url: { type: "string", description: "The URL of the file to download", example: "https://example.com/image.png" },
          target_path: { type: "string", description: "The path where the file should be saved in the repository", example: "public/images/logo.png" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--fetch_website",
      description: "Fetch a website as markdown, HTML, or screenshot. Returns file paths and content preview.",
      parameters: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", example: "https://example.com" },
          formats: { type: "string", description: "Comma-separated list of formats: 'markdown', 'html', 'screenshot'. Defaults to 'markdown'.", example: "markdown,screenshot" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--read_console_logs",
      description: "Browser console logs from the user's preview at message send time. Snapshot — call only once.",
      parameters: {
        type: "object",
        required: ["search"],
        properties: {
          search: { type: "string", example: "error" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--read_network_requests",
      description: "Network requests from the user's preview at message send time. Snapshot — call only once.",
      parameters: {
        type: "object",
        required: ["search"],
        properties: {
          search: { type: "string", example: "error" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--read_session_replay",
      description: "User's full session replay (rrweb) showing exact interactions and UI state before their message. Primary debugging tool for UI/behavior issues.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--add_dependency",
      description: "Add an npm dependency to the project.",
      parameters: {
        type: "object",
        required: ["package"],
        properties: {
          package: { type: "string", example: "lodash@latest" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--remove_dependency",
      description: "Remove an npm package from the project.",
      parameters: {
        type: "object",
        required: ["package"],
        properties: {
          package: { type: "string", example: "lodash" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--run_tests",
      description: "Run frontend tests. Auto-detects test setup (package.json test script or bunx vitest).",
      parameters: {
        type: "object",
        required: [],
        properties: {
          path: { type: "string" },
          timeout: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--dependency_scan",
      description: "Scan project dependencies for security vulnerabilities using npm audit. Returns high/critical severity findings with recommended fix versions.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code--dependency_update",
      description: "Update vulnerable npm dependencies to minimum secure versions. Use exact versions from security findings, not 'latest'.",
      parameters: {
        type: "object",
        required: ["vulnerable_packages"],
        properties: {
          vulnerable_packages: { type: "object" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--navigate_to_sandbox",
      description: "Navigate to a route in the project preview. Optional viewport width/height snaps to nearest supported device size.",
      parameters: {
        type: "object",
        required: [],
        properties: {
          path: { type: "string", description: "Origin-root-relative path (must start with / but not //). Examples: /dashboard, /auth?redirect=/home" },
          width: { type: "number", description: "Viewport width in pixels" },
          height: { type: "number", description: "Viewport height in pixels" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--act",
      description: "Perform a single action on the page. Modes: 'natural_language' (simple actions), 'structured' (complex pages, reuse observe() results). Structured methods: click, doubleClick, hover, fill(['text']), type(['text']), press(['key']), dragAndDrop(['selector']).",
      parameters: {
        type: "object",
        required: ["mode"],
        properties: {
          mode: { type: "string", example: "natural_language" },
          action: { type: "string", example: "Click the submit button" },
          method: { type: "string" },
          selector: { type: "string" },
          backendNodeId: { type: "number" },
          arguments: { type: "array", items: { type: "string" } },
          description: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--observe",
      description: "Observe the current page and get a list of possible actions.",
      parameters: {
        type: "object",
        required: [],
        properties: {
          instruction: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--screenshot",
      description: "Take a screenshot of the current page. No parameters required.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--get_url",
      description: "Get the current URL of the browser. No parameters required.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--extract",
      description: "Extract structured data from the current page based on an instruction.",
      parameters: {
        type: "object",
        required: ["instruction"],
        properties: {
          instruction: { type: "string" },
          schema: { type: "object" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--read_console_logs",
      description: "Console logs from the browser tool's remote session (not the use's preview — use code--read_console_logs for that).",
      parameters: {
        type: "object",
        required: [],
        properties: {
          search: { type: "string", description: "Filter results containing this text (case-insensitive)" },
          level: { type: "string", description: "Comma-separated list of levels: 'error,warning,info,debug'. Defaults to 'all'." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--list_network_requests",
      description: "Network requests from the browser tool's remote session. Default: XHR/fetch. Use resource_types='all' for everything.",
      parameters: {
        type: "object",
        required: [],
        properties: {
          resource_types: { type: "string", description: "Comma-separated list of resource types (e.g., 'xhr,fetch,document'). Defaults to 'xhr,fetch'. Use 'all' for all types." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--get_network_request_details",
      description: "Full request/response details (headers, body) for specific request IDs from browser--list_network_requests.",
      parameters: {
        type: "object",
        required: ["request_ids"],
        properties: {
          request_ids: { type: "string", description: "Comma-separated list of request IDs (e.g., '12345.1,12345.2')" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser--set_viewport_size",
      description: "Resize the browser viewport without restarting the session. Preserves all session state. Supported sizes: 1920x1080, 1536x864, 1366x768, 1280x720, 1024x768, 834x1194, 820x1180, 768x1024, 414x896, 390x844, 375x812, 360x800, 320x568.",
      parameters: {
        type: "object",
        required: ["width", "height"],
        properties: {
          width: { type: "number", description: "Viewport width in pixels", example: 1280 },
          height: { type: "number", description: "Viewport height in pixels", example: 720 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "imagegen--generate_image",
      description: "Generate image from text prompt. Models: flux.schnell (default, fast, <1000px), flux2.dev (1024x1024 or 1920x1080), flux.dev (other large dims, slower). Max 1920x1920, dimensions 512-1920 in multiples of 32. Set transparent_background=true for logos/icons.",
      parameters: {
        type: "object",
        required: ["prompt", "target_path", "transparent_background"],
        properties: {
          prompt: { type: "string", description: "Text description of the desired image", example: "A beautiful sunset" },
          target_path: { type: "string", description: "File path where the generated image should be saved. Prefer 'src/assets' folder.", example: "src/assets/image.jpg" },
          transparent_background: { type: "boolean", description: "Whether to remove the background. Set true for logos, icons, stickers, overlays.", example: false },
          width: { type: "number", description: "Image width (minimum 512, maximum 1920)", example: 1024 },
          height: { type: "number", description: "Image height (minimum 512, maximum 1920)", example: 1024 },
          model: { type: "string", description: "Model: flux.schnell (default), flux.dev, flux2.dev. flux2.dev only supports 1024x1024 and 1920x1080.", example: "flux.schnell" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "imagegen--edit_image",
      description: "Edit or merge existing images via AI prompt. Single image: apply edits. Multiple images: blend/combine. Inputs: codebase paths or URLs.",
      parameters: {
        type: "object",
        required: ["image_paths", "prompt", "target_path"],
        properties: {
          image_paths: { type: "array", items: { type: "string" }, description: "Array of paths to existing image files OR image URLs.", example: ["src/assets/image.jpg"] },
          prompt: { type: "string", description: "Text description of how to edit/merge the image(s).", example: "Make it darker" },
          target_path: { type: "string", description: "File path where the edited/merged image should be saved.", example: "src/assets/edited-image.jpg" },
          aspect_ratio: { type: "string", description: "Aspect ratio: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9. Use 16:9 for OG/social images.", example: "16:9" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "videogen--generate_video",
      description: "Generate video from text prompt. Optional starting_frame image to animate. Resolution: 480p/1080p. Aspect ratio: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9. Duration: 5 or 10s.",
      parameters: {
        type: "object",
        required: ["prompt", "target_path"],
        properties: {
          prompt: { type: "string", description: "Text description of the desired video content", example: "A serene sunset over calm ocean waves" },
          target_path: { type: "string", description: "File path where the generated video should be saved", example: "src/assets/video.mp4" },
          starting_frame: { type: "string", description: "Optional path to an image file to use as the first frame", example: "src/assets/image.jpg" },
          aspect_ratio: { type: "string", description: "Aspect ratio: '16:9', '4:3', '1:1', '3:4', '9:16', '21:9' (default: 16:9). Ignored when starting_frame is provided.", example: "16:9" },
          resolution: { type: "string", description: "Video quality: '480p' or '1080p' (default: 1080p)", example: "1080p" },
          duration: { type: "number", description: "Video length in seconds: 5 or 10 (default: 5)", example: 5 },
          camera_fixed: { type: "boolean", description: "Set to true for more stable camera work (default: false)", example: false },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "websearch--web_search",
      description: "Web search returning text content. Filter by category: news, linkedin profile, pdf, github, personal site, financial report. Tips: 'site:domain.com' to filter domains, quotes for exact phrases, -word to exclude.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "The search query" },
          numResults: { type: "number", description: "Number of search results to return (default: 5)" },
          links: { type: "number", description: "Number of links to return for each result" },
          imageLinks: { type: "number", description: "Number of image links to return for each result" },
          category: { type: "string", description: "Category: 'news', 'linkedin profile', 'pdf', 'github', 'personal site', 'financial report'" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "websearch--web_code_search",
      description: "Code-focused web search across GitHub, docs, Stack Overflow. Use for API syntax, code examples, framework patterns, error solutions.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "The code-specific search query" },
          tokensNum: { type: "string", description: "Number of tokens to return: 'dynamic' (default) or specific count (50-100000)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "questions--ask_questions",
      description: "Ask the user multiple-choice questions to gather preferences, requirements, or decisions. Each question can allow single or multiple selection.",
      parameters: {
        type: "object",
        required: ["questions"],
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              required: ["question", "header", "options", "multiSelect"],
              properties: {
                question: { type: "string", description: "The complete question to ask the user.", example: "Which authentication method should we use?" },
                header: { type: "string", description: "Short label displayed as a chip/tag.", example: "Auth method" },
                options: {
                  type: "array",
                  description: "2-4 available choices.",
                  items: {
                    type: "object",
                    required: ["label", "description"],
                    properties: {
                      label: { type: "string", description: "Display text (1-5 words)", example: "OAuth 2.0" },
                      description: { type: "string", description: "Explanation of this option", example: "Industry standard, works with Google, GitHub, etc." },
                    },
                  },
                },
                multiSelect: { type: "boolean", description: "Allow multiple selections", example: false },
                allowOther: { type: "boolean", description: "Include an 'Other' option for free-text input. Defaults to true.", example: true },
              },
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lovable_docs--search_docs",
      description: "Answer questions about Lovable features, usage, pricing, account management, and troubleshooting using official docs. Returns accurate info with source links.",
      parameters: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string", description: "The user's question about Lovable features, usage, or documentation." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "secrets--add_secret",
      description: "Add a new secret (API key, token). Secret becomes available as environment variable in all backend code. Never ask users to provide secret values directly.",
      parameters: {
        type: "object",
        required: ["secret_name"],
        properties: {
          secret_name: { type: "string", example: "STRIPE_API_KEY" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "secrets--update_secret",
      description: "Update an existing secret. Requires user interaction — they enter new values in a secure form.",
      parameters: {
        type: "object",
        required: ["secret_name"],
        properties: {
          secret_name: { type: "string", example: "STRIPE_API_KEY" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "secrets--delete_secret",
      description: "Delete user-created secrets. Cannot delete Supabase or integration-managed secrets. Requires user confirmation.",
      parameters: {
        type: "object",
        required: ["secret_names"],
        properties: {
          secret_names: { type: "array", items: { type: "string" }, example: ["STRIPE_API_KEY", "STRIPE_SECRET_KEY"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "secrets--fetch_secrets",
      description: "List all configured secret names (values hidden). Use to check which secrets/env vars are available. No parameters required.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supabase--enable",
      description: "Enable the Lovable Cloud integration. Creates a new Supabase project and connects it. No parameters required.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stripe--enable_stripe",
      description: "Enable the Stripe integration on the current project. Prompts the user for their Stripe secret key.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "shopify--enable",
      description: "Enable the Shopify integration. Use when user wants to sell products, build e-commerce, or create a storefront.",
      parameters: {
        type: "object",
        required: ["store_type"],
        properties: {
          store_type: { type: "string", description: "'new' to create a development store or 'existing' to connect an existing one.", example: "new" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "standard_connectors--connect",
      description: "Prompts the user to select an existing connection, or create a new one, for a given connector and links it to the current project.",
      parameters: {
        type: "object",
        required: ["connector_id"],
        properties: {
          connector_id: { type: "string", description: "The ID of the connector to link.", example: "slack" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "standard_connectors--disconnect",
      description: "Disconnects a connection from the current project. Keeps the connection available in the workspace.",
      parameters: {
        type: "object",
        required: ["connection_id"],
        properties: {
          connection_id: { type: "string", description: "The ID of the connection to disconnect." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "standard_connectors--list_connections",
      description: "List all connections available in the workspace for the current user.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "standard_connectors--get_connection_configuration",
      description: "Returns connection configuration metadata (scopes, access type, workspace IDs, channel IDs).",
      parameters: {
        type: "object",
        required: ["connection_id"],
        properties: {
          connection_id: { type: "string", description: "The ID of the connection." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "standard_connectors--reconnect",
      description: "Shows a prompt for the user to open connection settings and reconnect. Use when re-authorization or scope updates are needed.",
      parameters: {
        type: "object",
        required: ["connection_id", "reason", "required_scopes"],
        properties: {
          connection_id: { type: "string", description: "The ID of the connection to reconnect." },
          reason: { type: "string", description: "Why the connection needs to be reconnected." },
          required_scopes: { type: "array", items: { type: "string" }, description: "List of OAuth scope values needed. Pass empty list if no scope changes needed." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "security--run_security_scan",
      description: "Perform comprehensive security analysis of the Supabase backend. No parameters required.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "security--get_scan_results",
      description: "Fetch security information about the project. Set force=true to get results even if a scan is running.",
      parameters: {
        type: "object",
        required: ["force"],
        properties: {
          force: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "security--get_table_schema",
      description: "Get the database table schema information and security analysis prompt. No parameters required.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "security--manage_security_finding",
      description: "Manage security findings with create, update, or delete operations. Supports batch operations.",
      parameters: {
        type: "object",
        required: ["operations"],
        properties: {
          operations: {
            type: "array",
            description: "List of operations to perform on security findings",
            items: {
              type: "object",
              required: ["operation"],
              properties: {
                operation: { type: "string", description: "The operation: create, update, or delete", enum: ["create", "update", "delete"] },
                scanner_name: { type: "string", description: "Scanner name (optional, defaults to agent_security)" },
                internal_id: { type: "string", description: "Internal ID of the finding (required for update/delete)" },
                finding: {
                  type: "object",
                  description: "Finding data (required for create, optional for update)",
                  properties: {
                    id: { type: "string", description: "Finding identifier from predefined security issue types" },
                    internal_id: { type: "string", description: "Short descriptive identifier, snake_case, <20 chars" },
                    category: { type: "string", description: "Two-word category" },
                    name: { type: "string", description: "Clear, business-impact-oriented title" },
                    description: { type: "string", description: "Description ≤40 words" },
                    details: { type: "string", description: "Additional details ≤200 words in Markdown" },
                    level: { type: "string", enum: ["info", "warn", "error"] },
                    remediation_difficulty: { type: "string" },
                    ignore: { type: "boolean" },
                    ignore_reason: { type: "string" },
                    link: { type: "string", description: "Reference URL" },
                  },
                },
              },
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analytics--read_project_analytics",
      description: "Read production app analytics between two dates. Granularity: hourly or daily. Dates in YYYY-MM-DD format.",
      parameters: {
        type: "object",
        required: ["startdate", "enddate", "granularity"],
        properties: {
          startdate: { type: "string" },
          enddate: { type: "string" },
          granularity: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "document--parse_document",
      description: "Parse and extract content from documents (first 50 pages). Handles PDFs, Word docs, PowerPoint, Excel, MP3 and more. Preserves structure, tables, extracts images, performs OCR.",
      parameters: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to the document file to parse" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lsp--code_intelligence",
      description: "TypeScript/JavaScript language intelligence: hover (type info), definition (go-to-def), references (find usages). Set include_source=true for library files.",
      parameters: {
        type: "object",
        required: ["operation", "file_path", "line", "character"],
        properties: {
          operation: { type: "string", description: "Operation type: hover, definition, or references" },
          file_path: { type: "string" },
          line: { type: "number" },
          character: { type: "number" },
          include_source: { type: "boolean", description: "Include source code for library files" },
          include_declaration: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_debug--sleep",
      description: "Wait for a specified number of seconds (max 60). Useful for waiting on async operations like edge function deployments, logs, or cache invalidation.",
      parameters: {
        type: "object",
        required: ["seconds"],
        properties: {
          seconds: { type: "number", example: 5 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_urls--get_urls",
      description: "Get the preview and published URLs for the current project. No parameters required.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_tracking--create_task",
      description: "Create a new task with title + description.",
      parameters: {
        type: "object",
        required: ["title", "description"],
        properties: {
          title: { type: "string", description: "Short task title", example: "Update onboarding screen" },
          description: { type: "string", description: "One sentence describing the work", example: "Add CTA to top of onboarding screen." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_tracking--set_task_status",
      description: "Move a task between todo, in_progress, and done.",
      parameters: {
        type: "object",
        required: ["task_id", "status"],
        properties: {
          task_id: { type: "string", example: "abc123" },
          status: { type: "string", description: "todo, in_progress, or done", example: "in_progress" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_tracking--get_task",
      description: "Review a single task with description, status, and notes.",
      parameters: {
        type: "object",
        required: ["task_id"],
        properties: {
          task_id: { type: "string", example: "abc123" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_tracking--get_task_list",
      description: "Display the current task list for planning.",
      parameters: {
        type: "object",
        required: [],
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_tracking--update_task_title",
      description: "Update a task title when scope changes.",
      parameters: {
        type: "object",
        required: ["task_id", "new_title"],
        properties: {
          task_id: { type: "string", example: "abc123" },
          new_title: { type: "string", example: "Refine onboarding copy" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_tracking--update_task_description",
      description: "Refine a task description with clearer guidance.",
      parameters: {
        type: "object",
        required: ["task_id", "new_description"],
        properties: {
          task_id: { type: "string", example: "abc123" },
          new_description: { type: "string", example: "Clarify hero section goals." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_tracking--add_task_note",
      description: "Attach a concise note to a task describing findings or blockers.",
      parameters: {
        type: "object",
        required: ["task_id", "note"],
        properties: {
          task_id: { type: "string", example: "abc123" },
          note: { type: "string", description: "Progress note or decision", example: "Verified CTA renders on mobile." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--list_projects",
      description: "List other projects in this workspace. Paginated (limit/offset).",
      parameters: {
        type: "object",
        required: [],
        properties: {
          limit: { type: "number", example: 20 },
          offset: { type: "number", example: 0 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--search_project",
      description: "Find a project by name or ID. More efficient than list_projects when you know the name.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", example: "authentication" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--list_project_dir",
      description: "List files and directories in another project.",
      parameters: {
        type: "object",
        required: ["project"],
        properties: {
          project: { type: "string", example: "my-other-app" },
          dir_path: { type: "string", example: "src/components" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--read_project_file",
      description: "Read file contents from another project.",
      parameters: {
        type: "object",
        required: ["project", "file_path"],
        properties: {
          project: { type: "string", example: "my-other-app" },
          file_path: { type: "string", example: "src/components/Navigation.tsx" },
          lines: { type: "string", example: "1-100" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--list_project_assets",
      description: "List asset files (images, fonts, media) in another project's repo.",
      parameters: {
        type: "object",
        required: ["project"],
        properties: {
          project: { type: "string", example: "my-other-app" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--read_project_asset",
      description: "Read/view an asset from another project. Returns image content inline or text content.",
      parameters: {
        type: "object",
        required: ["project", "asset_path"],
        properties: {
          project: { type: "string", example: "my-other-app" },
          asset_path: { type: "string", example: "src/assets/logo.png" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--copy_project_asset",
      description: "Copy a file from another project's repo to the current project. Binary files supported.",
      parameters: {
        type: "object",
        required: ["project", "source_path", "target_path"],
        properties: {
          project: { type: "string", example: "my-other-app" },
          source_path: { type: "string", example: "src/assets/logo.png" },
          target_path: { type: "string", example: "src/assets/logo.png" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--read_project_messages",
      description: "Read chat message history from another project in chronological order.",
      parameters: {
        type: "object",
        required: ["project"],
        properties: {
          project: { type: "string", example: "my-other-app" },
          limit: { type: "number", example: 20 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cross_project--search_project_files",
      description: "Regex search across files in another project.",
      parameters: {
        type: "object",
        required: ["project", "query"],
        properties: {
          project: { type: "string", example: "my-other-app" },
          query: { type: "string", example: "useEffect\\(" },
          include_pattern: { type: "string", example: "src/**" },
          exclude_pattern: { type: "string", example: "**/*.test.tsx" },
          case_sensitive: { type: "boolean", example: false },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supabase--docs_search",
      description: "Search official Supabase documentation via the Content API. Returns ranked results with title, slug, URL, and content snippet.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Query to search in Supabase documentation" },
          max_results: { type: "number", description: "Max number of results (default 5, capped at 10)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supabase--docs_get",
      description: "Fetch a complete Supabase documentation page by slug. Returns full markdown, headings outline, and metadata.",
      parameters: {
        type: "object",
        required: ["slug"],
        properties: {
          slug: { type: "string", description: "Canonical document slug (e.g. 'auth/row-level-security')" },
        },
        additionalProperties: false,
      },
    },
  },
];