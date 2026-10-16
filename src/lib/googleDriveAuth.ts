import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const TARGET_DRIVE_FOLDER_ID = '13HNTSUiWxBqxnAON6rmMxLpx_ynbkvmC';
export const TARGET_DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/13HNTSUiWxBqxnAON6rmMxLpx_ynbkvmC?usp=sharing';

// Reuse existing app if already initialized
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
];

const provider = new GoogleAuthProvider();
SCOPES.forEach(scope => provider.addScope(scope));
provider.setCustomParameters({
  prompt: 'select_account',
});

const TOKEN_KEY = 'drive_oauth_access_token';
const TOKEN_TIME_KEY = 'drive_oauth_token_time';

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;

export const getStoredDriveToken = (): string | null => {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const time = localStorage.getItem(TOKEN_TIME_KEY);
    if (!token || !time) return null;
    const ageMs = Date.now() - parseInt(time, 10);
    // Tokens typically last 60 minutes; keep for 55 minutes
    if (ageMs > 55 * 60 * 1000) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_TIME_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
};

export const initDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      cachedUser = user;
      const storedToken = getStoredDriveToken();
      if (storedToken) {
        cachedAccessToken = storedToken;
        if (onAuthSuccess) onAuthSuccess(user, storedToken);
      } else if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      cachedUser = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_TIME_KEY);
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const signInWithGoogleDrive = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Drive access token from authentication');
    }

    cachedAccessToken = credential.accessToken;
    cachedUser = result.user;

    try {
      localStorage.setItem(TOKEN_KEY, credential.accessToken);
      localStorage.setItem(TOKEN_TIME_KEY, Date.now().toString());
    } catch (_) {}

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Google Drive sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getDriveAccessToken = (): string | null => {
  if (cachedAccessToken) return cachedAccessToken;
  const stored = getStoredDriveToken();
  if (stored) {
    cachedAccessToken = stored;
    return stored;
  }
  return null;
};

export const getCurrentDriveUser = (): User | null => {
  return cachedUser;
};

export const signOutGoogleDrive = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  cachedUser = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_TIME_KEY);
  } catch (_) {}
};

let autoSyncTimer: any = null;

/**
 * Triggers an automatic snapshot sync to Google Drive.
 * Defaults to enabled unless explicitly set to 'false' by user.
 */
export const triggerAutoDriveSync = (appAuthToken: string) => {
  const isAutoSync = localStorage.getItem('drive_auto_sync') !== 'false';
  const driveToken = getDriveAccessToken();
  if (!isAutoSync || !driveToken) return;

  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/drive/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appAuthToken}`,
          'x-drive-token': driveToken,
        },
        body: JSON.stringify({ driveAccessToken: driveToken }),
      });
      if (res.ok) {
        console.log('[Auto-Drive-Sync] Database snapshot & logs uploaded to Google Drive folder');
      } else {
        const data = await res.json().catch(() => ({}));
        console.warn('[Auto-Drive-Sync] Sync warning:', data.error || res.statusText);
      }
    } catch (e) {
      console.warn('[Auto-Drive-Sync] Background sync failed:', e);
    }
  }, 400);
};
