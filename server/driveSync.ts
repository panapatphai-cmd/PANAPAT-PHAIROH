import path from 'path';
import fs from 'fs';
import { backupDatabaseToFile, reloadDatabaseFromBuffer, getDatabasePath } from './db';
import db from './db';

export const TARGET_FOLDER_ID = '13HNTSUiWxBqxnAON6rmMxLpx_ynbkvmC';
export const TARGET_FOLDER_URL = `https://drive.google.com/drive/folders/${TARGET_FOLDER_ID}?usp=sharing`;

export interface DriveApiErrorDetails {
  status: number;
  message: string;
  reason?: string;
  activationUrl?: string;
}

export class DriveApiError extends Error {
  details: DriveApiErrorDetails;

  constructor(status: number, errorBody: string) {
    let message = errorBody;
    let reason = '';
    let activationUrl: string | undefined;

    try {
      const parsed = JSON.parse(errorBody);
      const err = parsed.error || {};
      const firstError = err.errors?.[0] || {};
      message = err.message || firstError.message || errorBody;
      reason = firstError.reason || err.status || '';

      if (
        message.includes('drive.googleapis.com') ||
        reason === 'accessNotConfigured' ||
        reason === 'SERVICE_DISABLED'
      ) {
        activationUrl = 'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=806732324578';
      }
    } catch {
      // not json
    }

    super(message);
    this.name = 'DriveApiError';
    this.details = {
      status,
      message,
      reason,
      activationUrl,
    };
  }
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
}

/**
 * Searches for a file by name inside the target Google Drive folder.
 */
export async function findFileInDrive(accessToken: string, fileName: string): Promise<DriveFile | null> {
  const query = encodeURIComponent(`'${TARGET_FOLDER_ID}' in parents and name = '${fileName}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,size)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new DriveApiError(res.status, errorBody);
  }

  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0] as DriveFile;
  }
  return null;
}

/**
 * Lists all backup files in the target folder.
 */
export async function listBackupsInDrive(accessToken: string): Promise<DriveFile[]> {
  const query = encodeURIComponent(`'${TARGET_FOLDER_ID}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=30&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new DriveApiError(res.status, errorBody);
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Creates a clean SQLite snapshot and uploads it to Google Drive into TARGET_FOLDER_ID.
 */
export async function syncDatabaseToDrive(accessToken: string): Promise<{
  success: boolean;
  fileId: string;
  fileName: string;
  folderId: string;
  folderUrl: string;
  lastSynced: string;
  size: number;
}> {
  const tempBackupPath = path.join(process.cwd(), 'data', `temp-sync-${Date.now()}.db`);

  try {
    // 1. Perform atomic SQLite backup to avoid reading partial or locked state
    await backupDatabaseToFile(tempBackupPath);

    const fileBuffer = fs.readFileSync(tempBackupPath);
    const existingFile = await findFileInDrive(accessToken, 'lis.db');

    let fileId: string;
    let fileName = 'lis.db';

    if (existingFile) {
      // 2. Update existing file content
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media&supportsAllDrives=true`;
      const updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-sqlite3',
        },
        body: fileBuffer,
      });

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        throw new DriveApiError(updateRes.status, errText);
      }

      const updated = await updateRes.json();
      fileId = updated.id;
    } else {
      // 3. Create new file with parent folder set to TARGET_FOLDER_ID
      const metadata = {
        name: 'lis.db',
        parents: [TARGET_FOLDER_ID],
        description: 'Permanent DMSc ATMPs LIS Database File',
      };

      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody = Buffer.concat([
        Buffer.from(
          delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(metadata) +
          delimiter +
          'Content-Type: application/x-sqlite3\r\n\r\n'
        ),
        fileBuffer,
        Buffer.from(closeDelimiter),
      ]);

      const createUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`;
      const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new DriveApiError(createRes.status, errText);
      }

      const created = await createRes.json();
      fileId = created.id;
    }

    const now = new Date().toISOString();

    // 4. Update sync settings in database
    try {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('drive_last_synced', ?)").run(now);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('drive_file_id', ?)").run(fileId);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('drive_folder_id', ?)").run(TARGET_FOLDER_ID);
    } catch (e) {
      console.warn('Could not update sync settings in local database:', e);
    }

    // 5. Also sync activity logs to Google Drive
    try {
      await syncLogsToGoogleDrive(accessToken);
    } catch (logErr) {
      console.warn('Could not sync activity logs alongside db:', logErr);
    }

    // 6. Also sync any uploaded result files to Google Drive
    try {
      await syncAllResultsToDrive(accessToken);
    } catch (resErr) {
      console.warn('Could not sync result files alongside db:', resErr);
    }

    return {
      success: true,
      fileId,
      fileName,
      folderId: TARGET_FOLDER_ID,
      folderUrl: TARGET_FOLDER_URL,
      lastSynced: now,
      size: fileBuffer.length,
    };
  } finally {
    // Clean up temporary backup file
    if (fs.existsSync(tempBackupPath)) {
      try {
        fs.unlinkSync(tempBackupPath);
      } catch (_) {}
    }
  }
}

/**
 * Downloads lis.db from Google Drive TARGET_FOLDER_ID and restores it locally.
 */
export async function restoreDatabaseFromDrive(accessToken: string, specificFileId?: string): Promise<{
  success: boolean;
  message: string;
  stats: { requests: number; users: number; tests: number };
}> {
  let fileId = specificFileId;

  if (!fileId) {
    const file = await findFileInDrive(accessToken, 'lis.db');
    if (!file) {
      throw new Error(`No 'lis.db' file found in Google Drive folder: ${TARGET_FOLDER_ID}`);
    }
    fileId = file.id;
  }

  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new DriveApiError(res.status, errText);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < 100) {
    throw new Error('Downloaded file is too small or invalid for a SQLite database');
  }

  // Backup current db locally before overwriting
  const dbPath = getDatabasePath();
  if (fs.existsSync(dbPath)) {
    const localBackup = `${dbPath}.pre-restore-${Date.now()}`;
    try {
      fs.copyFileSync(dbPath, localBackup);
    } catch (_) {}
  }

  // Reload database cleanly
  reloadDatabaseFromBuffer(buffer);

  // Read stats from freshly reloaded database
  const userCount = (db.prepare('SELECT count(*) as count FROM users').get() as any)?.count || 0;
  const requestCount = (db.prepare('SELECT count(*) as count FROM requests').get() as any)?.count || 0;
  const testCount = (db.prepare('SELECT count(*) as count FROM test_items').get() as any)?.count || 0;

  const now = new Date().toISOString();
  try {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('drive_last_synced', ?)").run(now);
  } catch (_) {}

  return {
    success: true,
    message: 'Database successfully restored from Google Drive',
    stats: {
      requests: requestCount,
      users: userCount,
      tests: testCount,
    },
  };
}

/**
 * Uploads a file or updates its content if it already exists in TARGET_FOLDER_ID.
 */
export async function uploadOrUpdateFileInDrive(
  accessToken: string,
  fileName: string,
  mimeType: string,
  contentBuffer: Buffer
): Promise<{ id: string; name: string }> {
  const existingFile = await findFileInDrive(accessToken, fileName);

  if (existingFile) {
    const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media&supportsAllDrives=true`;
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType,
      },
      body: contentBuffer,
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      throw new DriveApiError(updateRes.status, errText);
    }

    const updated = await updateRes.json();
    return { id: updated.id, name: fileName };
  } else {
    const metadata = {
      name: fileName,
      parents: [TARGET_FOLDER_ID],
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody = Buffer.concat([
      Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${mimeType}\r\n\r\n`
      ),
      contentBuffer,
      Buffer.from(closeDelimiter),
    ]);

    const createUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new DriveApiError(createRes.status, errText);
    }

    const created = await createRes.json();
    return { id: created.id, name: fileName };
  }
}

/**
 * Finds an existing folder inside a parent folder, or creates it if it doesn't exist.
 */
export async function getOrCreateFolderInDrive(
  accessToken: string,
  folderName: string,
  parentFolderId: string = TARGET_FOLDER_ID
): Promise<{ id: string; name: string }> {
  const safeName = folderName.replace(/'/g, "\\'");
  const query = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${safeName}' and '${parentFolderId}' in parents and trashed = false`);
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  try {
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        return { id: data.files[0].id, name: data.files[0].name };
      }
    }
  } catch (err) {
    console.warn('[Drive Folder Search Warning]:', err);
  }

  // Not found, create it inside parentFolderId
  const createUrl = `https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name`;
  const metadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId],
  };

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(metadata),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new DriveApiError(createRes.status, errText);
  }

  const created = await createRes.json();
  return { id: created.id, name: created.name || folderName };
}

/**
 * Uploads a laboratory result file to the Google Drive folder.
 * If file with same name already exists in target folder, updates it cleanly.
 */
export async function uploadResultFileToDrive(
  accessToken: string,
  fileName: string,
  mimeType: string,
  contentBuffer: Buffer,
  description?: string,
  parentFolderId: string = TARGET_FOLDER_ID
): Promise<{ id: string; name: string; webViewLink: string; webContentLink?: string; folderId: string }> {
  // Check if file already exists in parentFolderId
  try {
    const safeName = fileName.replace(/'/g, "\\'");
    const query = encodeURIComponent(`name = '${safeName}' and '${parentFolderId}' in parents and trashed = false`);
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink,webContentLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        const existing = data.files[0];
        const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink`;
        const updateRes = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': mimeType || 'application/octet-stream',
          },
          body: contentBuffer,
        });

        if (updateRes.ok) {
          const updated = await updateRes.json();
          return {
            id: updated.id,
            name: updated.name || fileName,
            webViewLink: updated.webViewLink || `https://drive.google.com/file/d/${updated.id}/view?usp=drivesdk`,
            webContentLink: updated.webContentLink,
            folderId: parentFolderId,
          };
        }
      }
    }
  } catch (_) {
    // If search fails, proceed to creation
  }

  const metadata = {
    name: fileName,
    parents: [parentFolderId],
    description: description || 'DMSc ATMPs LIS Laboratory Result File',
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartBody = Buffer.concat([
    Buffer.from(
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`
    ),
    contentBuffer,
    Buffer.from(closeDelimiter),
  ]);

  const createUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new DriveApiError(createRes.status, errText);
  }

  const created = await createRes.json();
  return {
    id: created.id,
    name: created.name || fileName,
    webViewLink: created.webViewLink || `https://drive.google.com/file/d/${created.id}/view?usp=drivesdk`,
    webContentLink: created.webContentLink,
    folderId: parentFolderId,
  };
}

/**
 * Synchronizes any local result files that are not yet uploaded to Google Drive.
 * Organizes files into subfolders by Lot Number, with files named as Lab Number.
 */
export async function syncAllResultsToDrive(accessToken: string): Promise<{ syncedCount: number; errors: number }> {
  const pendingResults = db.prepare(`
    SELECT r.id, r.request_id, r.file_path, r.original_name, req.lab_number, req.sample_name, req.lot_number
    FROM results r
    LEFT JOIN requests req ON r.request_id = req.id
    WHERE r.drive_file_id IS NULL OR r.drive_file_id = ''
  `).all() as any[];

  let syncedCount = 0;
  let errors = 0;

  for (const res of pendingResults) {
    const filePath = path.join(process.cwd(), 'uploads', res.file_path);
    if (!fs.existsSync(filePath)) continue;

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const ext = path.extname(res.original_name || res.file_path) || '.pdf';
      const lotFolderName = (res.lot_number || 'General').trim();
      
      // Get or create Lot Number subfolder in TARGET_FOLDER_ID
      const lotFolder = await getOrCreateFolderInDrive(accessToken, lotFolderName, TARGET_FOLDER_ID);
      
      // Set file name as Lab Number
      const driveFileName = `${res.lab_number || ('Req-' + res.request_id)}${ext}`;

      const uploaded = await uploadResultFileToDrive(
        accessToken,
        driveFileName,
        'application/pdf',
        fileBuffer,
        `Result for ${res.sample_name || ''} (Request #${res.request_id}, Lab ${res.lab_number || '-'}, Lot ${lotFolderName})`,
        lotFolder.id
      );

      db.prepare(`
        UPDATE results 
        SET drive_file_id = ?, drive_web_link = ? 
        WHERE id = ?
      `).run(uploaded.id, uploaded.webViewLink, res.id);

      syncedCount++;
    } catch (e) {
      errors++;
      console.warn(`Failed to sync result file ${res.file_path} to Drive:`, e);
    }
  }

  return { syncedCount, errors };
}

function escapeCsvField(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Synchronizes all activity logs to Google Drive as both JSON and CSV files.
 */
export async function syncLogsToGoogleDrive(accessToken: string): Promise<{
  success: boolean;
  count: number;
  lastSynced: string;
  folderUrl: string;
  jsonFileId: string;
  csvFileId: string;
}> {
  const logs = db.prepare('SELECT * FROM activity_logs ORDER BY id DESC').all() as any[];

  // 1. JSON file
  const jsonContent = JSON.stringify(logs, null, 2);
  const jsonBuffer = Buffer.from(jsonContent, 'utf-8');

  // 2. CSV file (with BOM for Excel Thai text compatibility)
  const headers = ['ID', 'Timestamp', 'Username', 'Role', 'Category', 'Action', 'Details', 'IP_Address'];
  const csvRows = [headers.join(',')];
  for (const log of logs) {
    csvRows.push([
      log.id,
      escapeCsvField(log.created_at),
      escapeCsvField(log.username),
      escapeCsvField(log.user_role),
      escapeCsvField(log.category),
      escapeCsvField(log.action),
      escapeCsvField(log.details),
      escapeCsvField(log.ip_address)
    ].join(','));
  }
  const csvBuffer = Buffer.from('\uFEFF' + csvRows.join('\r\n'), 'utf-8');

  // Upload or update in TARGET_FOLDER_ID
  const jsonFile = await uploadOrUpdateFileInDrive(accessToken, 'dalm_activity_log.json', 'application/json', jsonBuffer);
  const csvFile = await uploadOrUpdateFileInDrive(accessToken, 'dalm_activity_log.csv', 'text/csv', csvBuffer);

  const now = new Date().toISOString();
  try {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('logs_last_synced', ?)").run(now);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('logs_json_file_id', ?)").run(jsonFile.id);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('logs_csv_file_id', ?)").run(csvFile.id);
  } catch (_) {}

  return {
    success: true,
    count: logs.length,
    lastSynced: now,
    folderUrl: TARGET_FOLDER_URL,
    jsonFileId: jsonFile.id,
    csvFileId: csvFile.id,
  };
}

/**
 * Returns current sync status.
 */
export function getLocalDriveSyncStatus() {
  try {
    const lastSynced = (db.prepare("SELECT value FROM settings WHERE key = 'drive_last_synced'").get() as any)?.value || null;
    const fileId = (db.prepare("SELECT value FROM settings WHERE key = 'drive_file_id'").get() as any)?.value || null;
    const logsLastSynced = (db.prepare("SELECT value FROM settings WHERE key = 'logs_last_synced'").get() as any)?.value || null;
    const logsJsonFileId = (db.prepare("SELECT value FROM settings WHERE key = 'logs_json_file_id'").get() as any)?.value || null;
    const logsCsvFileId = (db.prepare("SELECT value FROM settings WHERE key = 'logs_csv_file_id'").get() as any)?.value || null;
    return {
      folderId: TARGET_FOLDER_ID,
      folderUrl: TARGET_FOLDER_URL,
      lastSynced,
      fileId,
      logsLastSynced,
      logsJsonFileId,
      logsCsvFileId,
    };
  } catch (err) {
    return {
      folderId: TARGET_FOLDER_ID,
      folderUrl: TARGET_FOLDER_URL,
      lastSynced: null,
      fileId: null,
      logsLastSynced: null,
      logsJsonFileId: null,
      logsCsvFileId: null,
    };
  }
}
