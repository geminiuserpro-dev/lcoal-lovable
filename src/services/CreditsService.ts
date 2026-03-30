import { auth, db } from '../firebase';
import { doc, getDoc, updateDoc, increment, serverTimestamp, setDoc } from 'firebase/firestore';

export const FREE_CREDITS_PER_MONTH = 30;
export const PRO_CREDITS_PER_MONTH = 500;
export const TEAM_CREDITS_PER_MONTH = 2000;

export type Plan = 'free' | 'pro' | 'team';

export interface UserCredits {
  credits: number;
  creditsUsed: number;
  plan: Plan;
  creditsResetAt: Date | null;
}

export const CreditsService = {
  async getCredits(): Promise<UserCredits> {
    if (!auth.currentUser || !db) {
      return { credits: FREE_CREDITS_PER_MONTH, creditsUsed: 0, plan: 'free', creditsResetAt: null };
    }
    const ref = doc(db, 'users', auth.currentUser.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return { credits: FREE_CREDITS_PER_MONTH, creditsUsed: 0, plan: 'free', creditsResetAt: null };
    }
    const data = snap.data();
    const plan: Plan = data.plan || 'free';
    const max = plan === 'team' ? TEAM_CREDITS_PER_MONTH : plan === 'pro' ? PRO_CREDITS_PER_MONTH : FREE_CREDITS_PER_MONTH;
    const creditsUsed = data.creditsUsed || 0;
    return {
      credits: Math.max(0, max - creditsUsed),
      creditsUsed,
      plan,
      creditsResetAt: data.creditsResetAt?.toDate?.() || null,
    };
  },

  async canUseCredits(): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const { credits } = await this.getCredits();
      if (credits <= 0) {
        return { allowed: false, reason: 'You have used all your credits for this month. Upgrade to continue.' };
      }
      return { allowed: true };
    } catch {
      return { allowed: true }; // Fail open — don't block if Firestore is down
    }
  },

  async deductCredit(): Promise<void> {
    if (!auth.currentUser || !db) return;
    const ref = doc(db, 'users', auth.currentUser.uid);
    await updateDoc(ref, {
      creditsUsed: increment(1),
      lastActiveAt: serverTimestamp(),
    }).catch(() => {}); // Fail silently
  },

  async resetMonthlyCredits(uid: string): Promise<void> {
    if (!db) return;
    const ref = doc(db, 'users', uid);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);
    await setDoc(ref, {
      creditsUsed: 0,
      creditsResetAt: nextMonth,
    }, { merge: true });
  },

  async upgradePlan(plan: Plan): Promise<void> {
    if (!auth.currentUser || !db) return;
    const ref = doc(db, 'users', auth.currentUser.uid);
    await setDoc(ref, { plan, creditsUsed: 0 }, { merge: true });
  },
};
