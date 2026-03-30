
import { auth, db } from '../firebase';
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from 'firebase/firestore';

export const trackEvent = async (eventName: string, properties: Record<string, any> = {}) => {
  try {
    const eventsRef = collection(db, 'analytics_events');
    await addDoc(eventsRef, {
      event_name: eventName,
      properties: {
        ...properties,
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
      userId: auth.currentUser?.uid || 'anonymous',
      timestamp: serverTimestamp(),
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to track event:", error);
    return { success: false, error };
  }
};

export const getAnalyticsReport = async (startDate?: string, endDate?: string) => {
  try {
    const eventsRef = collection(db, 'analytics_events');
    let q = query(eventsRef, orderBy('timestamp', 'desc'));
    
    // In a real app, we'd add where clauses for dates
    
    const snapshot = await getDocs(q);
    const events = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        userId: data.userId as string || 'anonymous',
        timestamp: data.timestamp?.toDate()?.toISOString() || new Date().toISOString()
      };
    });
    
    // Calculate simple stats
    const totalEvents = events.length;
    const uniqueUsers = new Set(events.map(e => e.userId)).size;
    
    return { 
      success: true, 
      data: {
        totalEvents,
        uniqueUsers,
        events: events.slice(0, 50) // Just return recent ones for the report
      }
    };
  } catch (error) {
    console.error("Failed to fetch analytics report:", error);
    return { success: false, error };
  }
};
