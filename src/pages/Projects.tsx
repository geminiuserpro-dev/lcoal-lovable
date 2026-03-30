import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useFirebase } from "@/components/FirebaseProvider";
import { ProjectService } from "@/services/ProjectService";
import { Project } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, FolderOpen, Trash2, Plus, Clock, Github } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Navbar from "@/components/Navbar";
import { toast } from "sonner";
import { motion } from "motion/react";

const Projects = () => {
  const { user } = useFirebase();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchProjects = async () => {
      try {
        const data = await ProjectService.getProjects();
        setProjects(data);
      } catch (error) {
        console.error("Failed to fetch projects:", error);
        toast.error("Failed to load projects");
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [user]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this project?")) return;
    
    setDeletingId(id);
    try {
      await ProjectService.deleteProject(id);
      setProjects(projects.filter(p => p.id !== id));
      toast.success("Project deleted successfully");
    } catch (error) {
      console.error("Failed to delete project:", error);
      toast.error("Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenProject = (id: string) => {
    navigate(`/editor?project=${id}`);
  };

  const handleNewProject = () => {
    navigate("/editor");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-4">
        <h2 className="text-2xl font-bold">Sign in to view your projects</h2>
        <Button onClick={() => navigate("/")}>Go to Home</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-6xl mx-auto pt-24 pb-12 px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Your Projects</h1>
            <p className="text-muted-foreground mt-1">Manage and continue your AI Tool Editor projects.</p>
          </div>
          <Button onClick={handleNewProject} className="gap-2">
            <Plus size={16} />
            New Project
          </Button>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-20 border border-dashed rounded-xl bg-muted/10">
            <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No projects yet</h3>
            <p className="text-muted-foreground mt-1 mb-6">Create your first project to get started.</p>
            <Button onClick={handleNewProject}>Create Project</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
              >
                <Card 
                  className="h-full flex flex-col cursor-pointer hover:border-primary/50 transition-colors group"
                  onClick={() => handleOpenProject(project.id)}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span className="truncate">{project.name || "Untitled Project"}</span>
                    </CardTitle>
                    <CardDescription className="line-clamp-2 h-10">
                      {project.description || "No description provided."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1">
                    {project.repoUrl && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Github size={14} />
                        <span className="truncate">{project.repoUrl.replace("https://github.com/", "")}</span>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} />
                      <span>
                        {project.lastModified?.toDate 
                          ? formatDistanceToNow(project.lastModified.toDate(), { addSuffix: true })
                          : "Recently"}
                      </span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleDelete(project.id, e)}
                      disabled={deletingId === project.id}
                    >
                      {deletingId === project.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Projects;
