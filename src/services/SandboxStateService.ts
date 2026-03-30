import { db, auth } from '../firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

export interface SandboxState {
  sandboxId: string | null;
  workDir: string;
  repoUrl: string | null;
  projectId: string | null;
  previewActive: boolean;
  lastUpdated: any;
}

export const SandboxStateService = {
  async saveState(state: Omit<SandboxState, 'lastUpdated'>) {
    if (!auth?.currentUser || !db) return;
    
    const userId = auth.currentUser.uid;
    const stateRef = doc(db, 'sandbox_states', userId);
    
    try {
      await setDoc(stateRef, {
        sandboxId: state.sandboxId || null,
        workDir: state.workDir || "/home/daytona/workspace",
        repoUrl: state.repoUrl || null,
        projectId: state.projectId || null,
        previewActive: !!state.previewActive,
        lastUpdated: serverTimestamp(),
      });
    } catch (e) {
      console.error("Failed to save sandbox state to Firestore:", e);
    }
  },

  async loadState(): Promise<SandboxState | null> {
    if (!auth?.currentUser || !db) return null;
    
    const userId = auth.currentUser.uid;
    const stateRef = doc(db, 'sandbox_states', userId);
    
    try {
      const snap = await getDoc(stateRef);
      if (snap.exists()) {
        return snap.data() as SandboxState;
      }
    } catch (e) {
      console.error("Failed to load sandbox state from Firestore:", e);
    }
    return null;
  }
};
