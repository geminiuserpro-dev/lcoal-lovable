import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, updateProfile as updateAuthProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../firebase';
import { AlertCircle, Settings } from 'lucide-react';
import { Button } from './ui/button';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'user' | 'admin';
  createdAt: any;
  lastLogin: any;
}

interface FirebaseContextType {
  user: User | null;
  profile: UserProfile | null;
  isAuthReady: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateUserProfile: (data: { displayName?: string; photoURL?: string }) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
};

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setIsAuthReady(true);
      return;
    }

    const testConnection = async () => {
      if (!db) return;
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();

    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser && db) {
        // Ensure user document exists
        const path = `users/${currentUser.uid}`;
        const userRef = doc(db, 'users', currentUser.uid);
        
        // Setup real-time profile listener
        unsubscribeProfile = onSnapshot(userRef, (doc) => {
          if (doc.exists()) {
            setProfile(doc.data() as UserProfile);
          }
        }, (error) => {
          if (error?.code === 'permission-denied' || error?.message?.includes('permissions')) {
            handleFirestoreError(error, OperationType.GET, path);
          }
        });

        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              role: 'user',
              createdAt: serverTimestamp(),
              lastLogin: serverTimestamp(),
            });
          } else {
            await setDoc(userRef, {
              lastLogin: serverTimestamp(),
            }, { merge: true });
          }
        } catch (error: any) {
          if (error?.code === 'permission-denied' || error?.message?.includes('permissions')) {
            handleFirestoreError(error, OperationType.WRITE, path);
          } else {
            console.error('Error ensuring user document:', error);
          }
        }
      } else {
        setProfile(null);
        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = undefined;
        }
      }
      
      setIsAuthReady(true);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const signInWithGoogle = async () => {
    if (!isFirebaseConfigured || !auth) {
      console.error('Firebase is not configured');
      return;
    }
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    provider.setCustomParameters({
      prompt: 'select_account'
    });

    try {
      console.log('Initiating Google Sign-in...');
      const result = await signInWithPopup(auth, provider);
      console.log('Sign-in successful:', result.user.email);
    } catch (error: any) {
      console.error('Error signing in with Google:', error);
      if (error.code === 'auth/unauthorized-domain') {
        alert(
          `Domain Unauthorized: Please add the following domains to your Firebase Console > Authentication > Settings > Authorized domains:\n\n` +
          `${window.location.hostname}`
        );
      } else {
        throw error;
      }
    }
  };

  const logout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const updateUserProfile = async (data: { displayName?: string; photoURL?: string }) => {
    if (!user || !db) return;
    const userRef = doc(db, 'users', user.uid);
    const path = `users/${user.uid}`;
    try {
      // Update Firestore
      await setDoc(userRef, {
        ...data,
        lastUpdated: serverTimestamp(),
      }, { merge: true });

      // Update Auth Profile if needed
      if (auth.currentUser) {
        await updateAuthProfile(auth.currentUser, {
          displayName: data.displayName,
          photoURL: data.photoURL
        });
      }
    } catch (error: any) {
      if (error?.code === 'permission-denied' || error?.message?.includes('permissions')) {
        handleFirestoreError(error, OperationType.WRITE, path);
      } else {
        console.error('Error updating user profile:', error);
        throw error;
      }
    }
  };

  if (!isFirebaseConfigured) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
        <div className="glass-panel max-w-md w-full p-8 rounded-3xl shadow-2xl border-orange-500/20 flex flex-col items-center text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center text-orange-500">
            <AlertCircle size={32} />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Firebase Setup Required</h2>
            <p className="text-muted-foreground">
              To use authentication and database features, you need to configure your Firebase environment variables.
            </p>
          </div>
          <div className="w-full space-y-3 pt-2">
            <div className="text-left bg-black/5 dark:bg-white/5 p-4 rounded-2xl text-xs font-mono overflow-x-auto">
              <p className="opacity-50 mb-2">// Required Secrets:</p>
              <p>VITE_FIREBASE_API_KEY</p>
              <p>VITE_FIREBASE_PROJECT_ID</p>
              <p>VITE_FIREBASE_AUTH_DOMAIN</p>
              <p>...</p>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Check the .env.example file for the full list of required keys.
            </p>
          </div>
          <Button 
            className="w-full rounded-xl bg-orange-500 hover:bg-orange-600 text-white border-0 h-12 font-semibold"
            onClick={() => window.location.reload()}
          >
            I've set the secrets, reload app
          </Button>
        </div>
      </div>
    );
  }

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground font-medium">Authenticating...</p>
        </div>
      </div>
    );
  }

  return (
    <FirebaseContext.Provider value={{ user, profile, isAuthReady, signInWithGoogle, logout, updateUserProfile }}>
      {children}
    </FirebaseContext.Provider>
  );
};
