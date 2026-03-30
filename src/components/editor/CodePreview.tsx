import { useState, useMemo, useRef, useEffect, memo } from "react";
import { 
  FileCode, FolderOpen, FolderClosed, ChevronRight, ChevronDown, FileQuestion, X,
  Search, FileJson, FileText, File, Hash, Braces, FilePlus, FolderPlus, Upload, Save, Edit2, Download
} from "lucide-react";
import { useSandbox } from "@/contexts/SandboxContext";
import { TreeNode } from "@/types";
import { motion, AnimatePresence } from "motion/react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-yaml";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { saveAs } from "file-saver";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  css: "css",
  json: "json",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  html: "markup",
  svg: "markup",
};

const EXT_TO_ICON: Record<string, React.ReactNode> = {
  ts: <FileCode size={14} className="text-primary" />,
  tsx: <FileCode size={14} className="text-primary" />,
  js: <FileCode size={14} className="text-accent" />,
  jsx: <FileCode size={14} className="text-accent" />,
  json: <FileJson size={14} className="text-accent" />,
  css: <Hash size={14} className="text-accent" />,
  md: <FileText size={14} className="text-muted-foreground" />,
  html: <Braces size={14} className="text-accent" />,
};

function getLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "typescript";
}

function getFileIcon(filePath: string): React.ReactNode {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_ICON[ext] || <File size={14} className="text-muted-foreground" />;
}

const FileTreeItem = memo(({
  node,
  depth = 0,
  selectedFile,
  onSelect,
  onDelete,
  onRename,
  onCopy,
  onDownload,
}: {
  node: TreeNode;
  depth?: number;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string) => void;
  onCopy: (path: string) => void;
  onDownload: (path: string) => void;
}) => {
  const [open, setOpen] = useState(depth < 2);
  const [hasBeenExpanded, setHasBeenExpanded] = useState(depth < 2);
  const isFolder = node.type === "folder";
  const isSelected = !isFolder && selectedFile === node.path;

  const handleToggle = () => {
    if (isFolder) {
      setOpen(!open);
      setHasBeenExpanded(true);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>
          <motion.button
            initial={false}
            onClick={handleToggle}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs transition-colors rounded-md hover:bg-muted/50 ${
              isSelected
                ? "bg-primary/10 text-primary font-medium border-l-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            {isFolder ? (
              <span className="text-muted-foreground">
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            ) : (
              <span className="w-3" />
            )}
            {isFolder ? (
              open ? (
                <FolderOpen size={14} className="text-accent shrink-0" />
              ) : (
                <FolderClosed size={14} className="text-accent shrink-0" />
              )
            ) : (
              getFileIcon(node.path)
            )}
            <span className="truncate">{node.name}</span>
          </motion.button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={handleToggle}>
          {isFolder ? (open ? "Close" : "Open") : "Open"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRename(node.path)}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCopy(node.path)}>
          Copy
        </ContextMenuItem>
        {!isFolder && (
          <ContextMenuItem onClick={() => onDownload(node.path)}>
            Download
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onDelete(node.path)} className="text-destructive">
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
      <AnimatePresence>
        {isFolder && open && hasBeenExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {node.children?.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
                onCopy={onCopy}
                onDownload={onDownload}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </ContextMenu>
  );
});

const HighlightedCode = memo(({ code, language }: { code: string; language: string }) => {
  const highlighted = useMemo(() => {
    const grammar = Prism.languages[language];
    if (!grammar) return Prism.util.encode(code) as string;
    return Prism.highlight(code, grammar, language);
  }, [code, language]);

  const lines = highlighted.split("\n");

  return (
    <pre className="text-[13px] font-mono leading-6">
      <code>
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-muted/30 group transition-colors">
            <span className="w-12 text-right pr-4 text-muted-foreground/30 select-none shrink-0 group-hover:text-muted-foreground/60 transition-colors font-normal">
              {i + 1}
            </span>
            <span
              className="whitespace-pre flex-1"
              dangerouslySetInnerHTML={{ __html: line || " " }}
            />
          </div>
        ))}
      </code>
    </pre>
  );
});

const CodePreview = () => {
  const { fileTree, selectedFile, selectedFileContent, setSelectedFile, closeTab, openTabs, files, saveFile, createFolder, deleteFile } =
    useSandbox();
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsEditing(false);
    setEditContent(selectedFileContent);
  }, [selectedFile, selectedFileContent]);

  const handleSave = async () => {
    if (selectedFile) {
      await saveFile(selectedFile, editContent);
      setIsEditing(false);
    }
  };

  const handleDelete = async (path: string) => {
    if (confirm(`Are you sure you want to delete ${path}?`)) {
      await deleteFile(path);
      if (selectedFile === path) {
        closeTab(path);
        setSelectedFile(null);
      }
    }
  };

  const handleRename = async (path: string) => {
    const newName = prompt(`Enter new name for ${path}:`, path);
    if (newName && newName !== path) {
      const content = files.get(path)?.content || "";
      await saveFile(newName, content);
      await deleteFile(path);
      if (selectedFile === path) {
        closeTab(path);
        setSelectedFile(newName);
      }
    }
  };

  const handleCopy = async (path: string) => {
    const content = files.get(path)?.content || "";
    const newName = prompt(`Enter name for copy of ${path}:`, `${path}.copy`);
    if (newName && newName !== path) {
      await saveFile(newName, content);
      setSelectedFile(newName);
    }
  };

  const handleDownloadFile = (path: string) => {
    const content = files.get(path)?.content || "";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const fileName = path.split("/").pop() || "file.txt";
    saveAs(blob, fileName);
  };

  const handleNewFile = async () => {
    const name = prompt("Enter file name (e.g., src/components/Button.tsx):");
    if (name) {
      await saveFile(name, "");
      setSelectedFile(name);
    }
  };

  const handleNewFolder = async () => {
    const name = prompt("Enter folder name (e.g., src/components):");
    if (name) {
      await createFolder(name);
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const dir = prompt("Enter directory to upload to (leave empty for root):", "");
    // If user cancels prompt, dir is null, so we abort
    if (dir === null) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    
    const prefix = dir ? (dir.endsWith("/") ? dir : `${dir}/`) : "";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await file.text();
      const path = `${prefix}${file.name}`;
      await saveFile(path, text);
      if (i === 0) setSelectedFile(path);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasFiles = files.size > 0;
  const language = selectedFile ? getLang(selectedFile) : "typescript";

  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return fileTree;
    
    const filterNodes = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.reduce<TreeNode[]>((acc, node) => {
        if (node.type === "file" && node.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          acc.push(node);
        } else if (node.type === "folder" && node.children) {
          const filtered = filterNodes(node.children);
          if (filtered.length > 0) {
            acc.push({ ...node, children: filtered });
          }
        }
        return acc;
      }, []);
    };
    
    return filterNodes(fileTree);
  }, [fileTree, searchQuery]);

  return (
    <div className="flex h-full bg-background">
      {/* File tree */}
      <div className="w-64 border-r border-border shrink-0 overflow-hidden flex flex-col bg-card/30">
        <div className="px-3 py-3 border-b border-border/50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
              Explorer
            </div>
            <div className="flex items-center gap-1">
              <button onClick={handleNewFile} className="p-1 hover:bg-muted/50 rounded text-muted-foreground hover:text-foreground transition-colors" title="New File">
                <FilePlus size={14} />
              </button>
              <button onClick={handleNewFolder} className="p-1 hover:bg-muted/50 rounded text-muted-foreground hover:text-foreground transition-colors" title="New Folder">
                <FolderPlus size={14} />
              </button>
              <button onClick={handleUpload} className="p-1 hover:bg-muted/50 rounded text-muted-foreground hover:text-foreground transition-colors" title="Upload File">
                <Upload size={14} />
              </button>
              <input type="file" ref={fileInputRef} onChange={onFileChange} className="hidden" multiple />
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files..."
              className="w-full bg-muted/50 border border-border/50 rounded-lg pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
          {hasFiles ? (
            filteredTree.map((node) => (
              <FileTreeItem
                key={node.path}
                node={node}
                selectedFile={selectedFile}
                onSelect={setSelectedFile}
                onDelete={handleDelete}
                onRename={handleRename}
                onCopy={handleCopy}
                onDownload={handleDownloadFile}
              />
            ))
          ) : (
            <div className="px-4 py-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4 border border-border/50">
                <FileQuestion size={24} className="text-muted-foreground/50" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground">No files yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Ask the AI to create files
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Code */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* File tabs */}
        {openTabs.length > 0 && (
          <div className="flex items-center border-b border-border bg-muted/20 overflow-x-auto shrink-0 custom-scrollbar">
            {openTabs.map((tab) => {
              const isActive = tab === selectedFile;
              const fileName = tab.split("/").pop() || tab;
              return (
                <motion.button
                  key={tab}
                  layout
                  onClick={() => setSelectedFile(tab)}
                  className={`group flex items-center gap-2 px-4 py-2.5 text-xs border-r border-border/30 shrink-0 transition-all relative ${
                    isActive
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    />
                  )}
                  {getFileIcon(tab)}
                  <span className="truncate max-w-[120px] font-medium">{fileName}</span>
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab);
                    }}
                    className="ml-1 p-1 rounded-md hover:bg-muted-foreground/20 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X size={12} />
                  </span>
                </motion.button>
              );
            })}
          </div>
        )}

        {selectedFile ? (
          <>
            <div className="h-10 border-b border-border flex items-center px-4 gap-4 shrink-0 bg-muted/10">
              <span className="text-[11px] text-muted-foreground font-mono bg-muted/80 px-2.5 py-1 rounded-md border border-border/50">
                {language}
              </span>
              <span className="text-[11px] text-muted-foreground/60 ml-auto">
                {selectedFileContent.split("\n").length} lines
              </span>
              <button onClick={() => handleDownloadFile(selectedFile)} className="flex items-center gap-1.5 px-3 py-1 bg-muted text-foreground text-[11px] font-medium rounded-md hover:bg-muted/80 transition-colors" title="Download File">
                <Download size={12} /> Download
              </button>
              {isEditing ? (
                <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-1 bg-primary text-primary-foreground text-[11px] font-medium rounded-md hover:bg-primary/90 transition-colors">
                  <Save size={12} /> Save
                </button>
              ) : (
                <button onClick={() => setIsEditing(true)} className="flex items-center gap-1.5 px-3 py-1 bg-muted text-foreground text-[11px] font-medium rounded-md hover:bg-muted/80 transition-colors">
                  <Edit2 size={12} /> Edit
                </button>
              )}
            </div>
            <div className="flex-1 overflow-auto prism-code-block custom-scrollbar bg-card/50 flex flex-col">
              {isEditing ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="flex-1 w-full h-full min-h-full p-4 bg-transparent text-[13px] font-mono leading-6 text-foreground resize-none focus:outline-none"
                  spellCheck={false}
                />
              ) : (
                <div className="p-4">
                  <HighlightedCode code={selectedFileContent} language={language} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-background to-muted/20">
            <div className="text-center">
              <div className="w-20 h-20 rounded-3xl bg-muted/30 flex items-center justify-center mx-auto mb-5 border border-border/50">
                <FileCode size={36} className="text-muted-foreground/40" />
              </div>
              <p className="text-base font-semibold text-foreground">
                {hasFiles ? "Select a file" : "No files yet"}
              </p>
              <p className="text-sm text-muted-foreground mt-2 max-w-[240px]">
                {hasFiles
                  ? "Choose a file from the explorer to view its contents"
                  : "Files created by the AI will appear here"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CodePreview;
