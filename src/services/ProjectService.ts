import { auth, db } from '../firebase';
import { SandboxFile, Project } from '../types';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc, query, where, orderBy, serverTimestamp, writeBatch } from 'firebase/firestore';

export const ProjectService = {
  async saveProject(name: string, description: string, snapshotName: string | null, files: Map<string, SandboxFile>, existingProjectId?: string) {
    if (!auth.currentUser) throw new Error("User must be authenticated to save projects.");
    const userId = auth.currentUser.uid;
    
    let projectId = existingProjectId;
    let isOwner = false;
    
    if (projectId) {
      try {
        const projectRef = doc(db, 'projects', projectId);
        const projectSnap = await getDoc(projectRef);
        if (projectSnap.exists()) {
          if (projectSnap.data().ownerId === userId) {
            isOwner = true;
          } else {
            projectId = undefined;
            console.log("User is not owner, creating a fork...");
          }
        } else {
          projectId = undefined;
        }
      } catch (e) {
        console.warn("Failed to check project ownership, creating new project:", e);
        projectId = undefined;
      }
    }
    
    if (!projectId) {
      projectId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
    
    console.log(`Saving project ${name} to Firestore with ID ${projectId}`);
    
    const projectRef = doc(db, 'projects', projectId);
    const projectData: any = {
      id: projectId,
      name,
      description: description || null,
      ownerId: userId,
      snapshotName: snapshotName || null,
      lastModified: serverTimestamp(),
    };
    
    if (!isOwner) {
      projectData.createdAt = serverTimestamp();
    }
    
    await setDoc(projectRef, projectData, { merge: true });

    // Save files in a batch
    const batch = writeBatch(db);
    
    // Delete existing files first (this is a simplified approach, in a real app you might want to diff)
    const filesRef = collection(db, 'projects', projectId, 'files');
    const existingFiles = await getDocs(filesRef);
    existingFiles.forEach(doc => {
      batch.delete(doc.ref);
    });

    const filesArray = Array.from(files.values()).map(f => ({
      path: f.path,
      content: typeof f.content === 'string' ? f.content : ""
    })).filter(f => f.path && f.path.trim() !== '' && f.content.length < 500000); // 500KB limit for Firestore document

    filesArray.forEach(file => {
      // Use a safe ID for the file document
      const fileId = file.path.replace(/[/\\?%*:|"<>]/g, '_');
      const fileDocRef = doc(filesRef, fileId);
      batch.set(fileDocRef, {
        path: file.path,
        content: file.content,
        ownerId: userId
      });
    });

    await batch.commit();
    
    return projectId;
  },

  async getProjects() {
    if (!auth.currentUser) return [];
    const userId = auth.currentUser.uid;
    
    const projectsRef = collection(db, 'projects');
    const q = query(projectsRef, where('ownerId', '==', userId), orderBy('lastModified', 'desc'));
    
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as Project);
  },

  async loadProject(projectId: string) {
    const projectRef = doc(db, 'projects', projectId);
    const projectSnap = await getDoc(projectRef);
    
    if (!projectSnap.exists()) {
      throw new Error("Project not found");
    }
    
    const filesRef = collection(db, 'projects', projectId, 'files');
    const filesSnap = await getDocs(filesRef);
    
    const files = filesSnap.docs.map(doc => doc.data());
    
    return { project: projectSnap.data() as Project, files };
  },

  async deleteProject(projectId: string, storagePath?: string) {
    if (!auth.currentUser) throw new Error("User must be authenticated to delete projects.");
    
    // Delete files first
    const filesRef = collection(db, 'projects', projectId, 'files');
    const filesSnap = await getDocs(filesRef);
    
    const batch = writeBatch(db);
    filesSnap.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Delete project document
    const projectRef = doc(db, 'projects', projectId);
    batch.delete(projectRef);
    
    await batch.commit();
  }
};
