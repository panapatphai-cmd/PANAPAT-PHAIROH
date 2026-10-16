import React, { useState, useEffect } from 'react';
import { 
  signInWithGoogleDrive, 
  signOutGoogleDrive, 
  getDriveAccessToken, 
  initDriveAuth, 
  TARGET_DRIVE_FOLDER_ID, 
  TARGET_DRIVE_FOLDER_URL 
} from '../lib/googleDriveAuth';
import { User } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { Cloud, CheckCircle2, AlertTriangle, RefreshCw, ExternalLink, HardDrive, ShieldCheck, Database, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

interface GoogleDrivePersistenceProps {
  token: string;
  onRefreshData?: () => void;
  compact?: boolean;
}

export default function GoogleDrivePersistence({ token, onRefreshData, compact = false }: GoogleDrivePersistenceProps) {
  const { t } = useTranslation();
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [driveFileInfo, setDriveFileInfo] = useState<any>(null);
  const [driveError, setDriveError] = useState<any>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    return localStorage.getItem('drive_auto_sync') !== 'false';
  });

  // Modals for Mandatory Destructive Operation Confirmation
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  // Initialize Auth listener
  useEffect(() => {
    const unsubscribe = initDriveAuth(
      (user, token) => {
        setGoogleUser(user);
        setDriveToken(token);
        fetchDriveStatus(token);
      },
      () => {
        setGoogleUser(null);
        setDriveToken(null);
        fetchDriveStatus();
      }
    );
    return () => unsubscribe();
  }, []);

  const fetchDriveStatus = async (currentDriveToken?: string | null) => {
    const activeToken = currentDriveToken !== undefined ? currentDriveToken : driveToken;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (activeToken) {
        headers['x-drive-token'] = activeToken;
      }
      const res = await fetch('/api/drive/status', { headers });
      if (res.ok) {
        const data = await res.json();
        setLastSynced(data.lastSynced);
        setDriveFileInfo(data.driveFileInfo);
        setDriveError(data.driveError || null);
      }
    } catch (err) {
      console.error('Failed to fetch drive status:', err);
    }
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setStatusMessage(null);
    try {
      const res = await signInWithGoogleDrive();
      if (res) {
        setGoogleUser(res.user);
        setDriveToken(res.accessToken);
        await fetchDriveStatus(res.accessToken);
        setStatusMessage({ text: t('drive.connectedAs') + ' ' + (res.user.email || res.user.displayName), type: 'success' });
      }
    } catch (err: any) {
      console.error('Sign-in failed:', err);
      setStatusMessage({ text: err.message || 'Google Drive Sign-in failed', type: 'error' });
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOutGoogleDrive();
    setGoogleUser(null);
    setDriveToken(null);
    setStatusMessage({ text: t('drive.disconnectGoogle'), type: 'info' });
  };

  // Perform Sync (after confirmation)
  const executeSync = async () => {
    const activeToken = driveToken || getDriveAccessToken();
    if (!activeToken) {
      setStatusMessage({ text: t('drive.needSignIn'), type: 'error' });
      return;
    }

    setSyncing(true);
    setShowSyncConfirm(false);
    setStatusMessage({ text: t('drive.syncing'), type: 'info' });

    try {
      const res = await fetch('/api/drive/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-drive-token': activeToken,
        },
        body: JSON.stringify({ driveAccessToken: activeToken }),
      });

      const data = await res.json();
      if (res.ok) {
        setLastSynced(data.lastSynced);
        setStatusMessage({ text: t('drive.syncSuccess'), type: 'success' });
        await fetchDriveStatus(activeToken);
      } else {
        throw new Error(data.error || 'Failed to sync database to Drive');
      }
    } catch (err: any) {
      console.error('Sync error:', err);
      setStatusMessage({ text: err.message || 'Sync failed', type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  // Perform Restore (after confirmation)
  const executeRestore = async () => {
    const activeToken = driveToken || getDriveAccessToken();
    if (!activeToken) {
      setStatusMessage({ text: t('drive.needSignIn'), type: 'error' });
      return;
    }

    setRestoring(true);
    setShowRestoreConfirm(false);
    setStatusMessage({ text: t('drive.restoring'), type: 'info' });

    try {
      const res = await fetch('/api/drive/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-drive-token': activeToken,
        },
        body: JSON.stringify({ driveAccessToken: activeToken }),
      });

      const data = await res.json();
      if (res.ok) {
        setStatusMessage({ text: `${t('drive.restoreSuccess')} (${data.stats.requests} requests restored)`, type: 'success' });
        if (onRefreshData) onRefreshData();
      } else {
        throw new Error(data.error || 'Failed to restore database from Drive');
      }
    } catch (err: any) {
      console.error('Restore error:', err);
      setStatusMessage({ text: err.message || 'Restore failed', type: 'error' });
    } finally {
      setRestoring(false);
    }
  };

  const handleToggleAutoSync = (checked: boolean) => {
    setAutoSync(checked);
    localStorage.setItem('drive_auto_sync', checked ? 'true' : 'false');
  };

  const formatDisplayTime = (isoString: string | null) => {
    if (!isoString) return t('drive.neverSynced');
    try {
      const d = new Date(isoString);
      return new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return isoString;
    }
  };

  // Compact header badge view
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {googleUser ? (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-medium shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <Cloud className="w-3.5 h-3.5 text-emerald-600" />
            <span className="hidden sm:inline">Drive Synced</span>
          </div>
        ) : (
          <button
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs px-2.5 py-1 rounded-full transition-colors font-medium cursor-pointer"
            title="Connect Google Drive for permanent storage"
          >
            <Cloud className="w-3.5 h-3.5 text-indigo-600" />
            <span>Connect Drive</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-base font-bold text-slate-900">{t('drive.title')}</h4>
            <p className="text-xs text-slate-500 mt-0.5">{t('drive.description')}</p>
          </div>
        </div>

        {/* Target Folder Link */}
        <a 
          href={TARGET_DRIVE_FOLDER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors self-start sm:self-auto"
        >
          <span>{t('drive.openFolder')}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Target Folder Details */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-500 font-medium">{t('drive.targetFolder')}:</span>
          <code className="bg-white px-2 py-0.5 rounded border border-slate-200 font-mono text-slate-800 text-[11px]">
            {TARGET_DRIVE_FOLDER_ID}
          </code>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-500 font-medium">{t('drive.lastSynced')}:</span>
          <span className="font-semibold text-slate-800">{formatDisplayTime(lastSynced)}</span>
        </div>
        {driveFileInfo && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200">
            <span className="text-emerald-700 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>lis.db online in Drive ({Math.round(Number(driveFileInfo.size || 0) / 1024)} KB)</span>
            </span>
            <span className="text-slate-400 text-[11px]">{driveFileInfo.modifiedTime ? formatDisplayTime(driveFileInfo.modifiedTime) : ''}</span>
          </div>
        )}
      </div>

      {/* Google Authentication Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 bg-white">
        {googleUser ? (
          <div className="flex items-center gap-3">
            {googleUser.photoURL ? (
              <img src={googleUser.photoURL} alt="Avatar" className="w-10 h-10 rounded-full border border-slate-200" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-sm">
                {(googleUser.email || 'G')[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-slate-900">{googleUser.displayName || 'Google User'}</p>
              <p className="text-xs text-slate-500">{googleUser.email}</p>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Authorized with Drive scope</span>
              </span>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-slate-900">{t('drive.connectGoogle')}</p>
            <p className="text-xs text-slate-500 mt-0.5">{t('drive.needSignIn')}</p>
          </div>
        )}

        <div>
          {googleUser ? (
            <button
              onClick={handleSignOut}
              className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200 font-medium transition-colors cursor-pointer"
            >
              {t('drive.disconnectGoogle')}
            </button>
          ) : (
            /* Official Google Sign-in Styled Button */
            <button
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="inline-flex items-center gap-3 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 font-medium text-xs px-4 py-2.5 rounded-xl border border-slate-300 shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                <path fill="none" d="M0 0h48v48H0z"></path>
              </svg>
              <span>{isSigningIn ? 'Connecting...' : 'Sign in with Google'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
          statusMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
          statusMessage.type === 'error' ? 'bg-rose-50 text-rose-800 border border-rose-200' :
          'bg-blue-50 text-blue-800 border border-blue-200'
        }`}>
          {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> :
           statusMessage.type === 'error' ? <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" /> :
           <RefreshCw className="w-4 h-4 text-blue-600 shrink-0 animate-spin" />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Drive API Error Banner (e.g. Needs API activation in Cloud Console) */}
      {driveError && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <p className="font-bold text-amber-950">
                {driveError.activationUrl ? 'ต้องเปิดใช้งาน Google Drive API ในโปรเจกต์ Google Cloud' : 'Google Drive Notice'}
              </p>
              <p className="text-amber-800 leading-relaxed text-[11px]">
                {driveError.activationUrl ? (
                  <>
                    โปรเจกต์ Google Cloud (<code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-amber-900">806732324578</code>) ยังไม่ได้เปิดใช้งาน Google Drive API กรุณากดปุ่มด้านล่างเพื่อเปิดใช้งาน (Enable API) บน Google Cloud Console แล้วกลับมาซิงค์ได้ทันที
                  </>
                ) : (
                  driveError.message || 'Unable to access Google Drive'
                )}
              </p>
              {driveError.activationUrl && (
                <div className="pt-1.5">
                  <a
                    href={driveError.activationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs transition-colors"
                  >
                    <span>เปิดใช้งาน Google Drive API (Google Cloud Console)</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync / Restore Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Sync Button */}
        <button
          onClick={() => setShowSyncConfirm(true)}
          disabled={!googleUser || syncing || restoring}
          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-xs px-4 py-3 rounded-xl transition-all shadow-sm shadow-indigo-100 cursor-pointer disabled:cursor-not-allowed"
        >
          <ArrowUpFromLine className={`w-4 h-4 ${syncing ? 'animate-bounce' : ''}`} />
          <span>{syncing ? t('drive.syncing') : t('drive.syncNow')}</span>
        </button>

        {/* Restore Button */}
        <button
          onClick={() => setShowRestoreConfirm(true)}
          disabled={!googleUser || syncing || restoring}
          className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-300 text-slate-800 font-semibold text-xs px-4 py-3 rounded-xl border border-slate-200 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          <ArrowDownToLine className={`w-4 h-4 ${restoring ? 'animate-bounce' : ''}`} />
          <span>{restoring ? t('drive.restoring') : t('drive.restoreFromDrive')}</span>
        </button>
      </div>

      {/* Auto-Sync Option */}
      <div className="flex items-center justify-between pt-2">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
          <input 
            type="checkbox"
            checked={autoSync}
            onChange={(e) => handleToggleAutoSync(e.target.checked)}
            className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
          />
          <span>{t('drive.autoSync')}</span>
        </label>
        <span className="text-[11px] text-slate-400 font-mono">Folder: ...{TARGET_DRIVE_FOLDER_ID.slice(-8)}</span>
      </div>

      {/* Confirmation Modal for Syncing (Mandatory per Skill Constitution) */}
      {showSyncConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-indigo-600">
              <div className="p-2 bg-indigo-50 rounded-xl">
                <Database className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">{t('drive.confirmSyncTitle')}</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t('drive.confirmSyncMessage')}
            </p>
            <div className="bg-slate-50 p-3 rounded-xl text-[11px] text-slate-600 space-y-1 border border-slate-200">
              <div><strong>{t('drive.folderId')}:</strong> {TARGET_DRIVE_FOLDER_ID}</div>
              <div><strong>File:</strong> lis.db (SQLite database)</div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowSyncConfirm(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={executeSync}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs cursor-pointer"
              >
                Confirm & Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Restoring (Mandatory Destructive Confirmation) */}
      {showRestoreConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-2 bg-amber-50 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">{t('drive.confirmRestoreTitle')}</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t('drive.confirmRestoreMessage')}
            </p>
            <div className="bg-amber-50 p-3 rounded-xl text-[11px] text-amber-900 space-y-1 border border-amber-200">
              <div><strong>Source:</strong> Google Drive Folder {TARGET_DRIVE_FOLDER_ID}</div>
              <div><strong>Notice:</strong> Current local database will be backed up before replacing.</div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowRestoreConfirm(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={executeRestore}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors shadow-xs cursor-pointer"
              >
                Confirm & Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
