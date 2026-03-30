import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
const firebaseConfig = {
  projectId: import.meta.env.FIREBASE_PROJECT_ID,
  appId: import.meta.env.FIREBASE_APP_ID,
  apiKey: import.meta.env.FIREBASE_API_KEY,
  authDomain: import.meta.env.FIREBASE_AUTH_DOMAIN,
  firestoreDatabaseId: import.meta.env.FIREBASE_FIRESTORE_DATABASE_ID,
  storageBucket: import.meta.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.FIREBASE_MEASUREMENT_ID,
};

// Check if Firebase is configured
export const isFirebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: any;
let db: any;
let auth: any;
let storage: any;

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId); // Use the specific databaseId if provided
    auth = getAuth(app);
    storage = getStorage(app);
  } catch (error) {
    console.error("Firebase initialization error:", error);
  }
} else {
  console.warn("Firebase is not configured.");
}

export { app, db, auth, storage };
export default app;
