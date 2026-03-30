import { db, auth } from '../firebase';
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp, doc, updateDoc, limit } from 'firebase/firestore';
import { ChatMessage } from '../lib/tools';

export const ChatService = {
  async saveMessage(projectId: string, message: ChatMessage) {
    if (!auth.currentUser) return;
    
    const chatRef = collection(db, 'projects', projectId, 'messages');
    await addDoc(chatRef, {
      ...message,
      timestamp: serverTimestamp(),
    });
  },

  async getMessages(projectId: string) {
    if (!auth.currentUser) return [];
    
    const chatRef = collection(db, 'projects', projectId, 'messages');
    const q = query(chatRef, orderBy('timestamp', 'asc'), limit(100));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        timestamp: data.timestamp?.toDate() || new Date(),
      } as ChatMessage;
    });
  },

  async clearMessages(projectId: string) {
    // In a real app, we'd delete all docs in the subcollection
    // For now, we'll just leave it or implement a soft delete
  }
};
