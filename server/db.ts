import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
// Change: Always use process.cwd() instead of /tmp for persistence in this environment
const baseDir = process.cwd();
const dataDir = path.join(baseDir, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure uploads directory exists
const uploadDir = path.join(baseDir, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const logoDir = path.join(uploadDir, 'logos');
if (!fs.existsSync(logoDir)) {
  fs.mkdirSync(logoDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'lis.db');

function createDbConnection(): Database.Database {
  try {
    const conn = new Database(dbPath);
    // Verify database integrity
    conn.pragma('quick_check');
    return conn;
  } catch (err: any) {
    console.error('[DB] Corrupted or invalid database detected:', err.message);
    if (fs.existsSync(dbPath)) {
      const backupPath = path.join(dataDir, `lis.db.corrupt-${Date.now()}`);
      try {
        fs.renameSync(dbPath, backupPath);
        console.warn(`[DB] Corrupted database backed up to ${backupPath}`);
      } catch (e) {
        try { fs.unlinkSync(dbPath); } catch (_) {}
      }
    }
    return new Database(dbPath);
  }
}

let activeDb = createDbConnection();

const dbProxy = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const val = (activeDb as any)[prop];
    if (typeof val === 'function') {
      return val.bind(activeDb);
    }
    return val;
  }
});

const db = dbProxy;

function runSchema() {
  activeDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'requester', 'lab_tech')),
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS test_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      reference_range TEXT,
      price REAL NOT NULL,
      is_active BOOLEAN DEFAULT 1
    )
  `);

  // ... (rest of the schema creation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      lot_number TEXT NOT NULL,
      sample_name TEXT NOT NULL,
      case_name TEXT,
      tube_count INTEGER DEFAULT 1,
      is_initial BOOLEAN DEFAULT 0,
      is_in_process BOOLEAN DEFAULT 0,
      is_finish_product BOOLEAN DEFAULT 0,
      processing_day INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'received', 'completed', 'cancelled')),
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      received_at DATETIME,
      lab_number TEXT,
      FOREIGN KEY (requester_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      test_item_id INTEGER NOT NULL,
      FOREIGN KEY (request_id) REFERENCES requests(id),
      FOREIGN KEY (test_item_id) REFERENCES test_items(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      uploaded_by INTEGER NOT NULL,
      drive_file_id TEXT,
      drive_web_link TEXT,
      uploaded_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (request_id) REFERENCES requests(id),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      user_role TEXT,
      action TEXT NOT NULL,
      category TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  // Migration logic (shortened for brevity but keeping essential)
  try {
    const tableInfo = db.prepare("PRAGMA table_info(requests)").all() as any[];
    // (all column checks)
    const columnsToAdd = [
      { name: 'tube_count', type: 'INTEGER DEFAULT 1' },
      { name: 'case_name', type: 'TEXT' },
      { name: 'received_at', type: 'DATETIME' },
      { name: 'is_initial', type: 'BOOLEAN DEFAULT 0' },
      { name: 'is_in_process', type: 'BOOLEAN DEFAULT 0' },
      { name: 'is_finish_product', type: 'BOOLEAN DEFAULT 0' },
      { name: 'lab_number', type: 'TEXT' },
      { name: 'processing_day', type: 'INTEGER DEFAULT 0' }
    ];

    columnsToAdd.forEach(col => {
      if (!tableInfo.some(c => c.name === col.name)) {
        db.exec(`ALTER TABLE requests ADD COLUMN ${col.name} ${col.type}`);
      }
    });

    const hasSampleName = tableInfo.some(col => col.name === 'sample_name');
    const hasPatientName = tableInfo.some(col => col.name === 'patient_name');
    if (!hasSampleName && hasPatientName) {
      db.exec('ALTER TABLE requests RENAME COLUMN patient_name TO sample_name');
    }

    // Results table migration for Google Drive file link
    const resultTableInfo = db.prepare("PRAGMA table_info(results)").all() as any[];
    const resultColumnsToAdd = [
      { name: 'drive_file_id', type: 'TEXT' },
      { name: 'drive_web_link', type: 'TEXT' }
    ];
    resultColumnsToAdd.forEach(col => {
      if (!resultTableInfo.some(c => c.name === col.name)) {
        db.exec(`ALTER TABLE results ADD COLUMN ${col.name} ${col.type}`);
      }
    });
  } catch (err) {
    console.error('Migration error:', err);
  }

  // Seed Initial Data
  const userCount = db.prepare('SELECT count(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const salt = bcrypt.genSaltSync(10);
    const password = bcrypt.hashSync('password123', salt);
    const insertUser = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
    insertUser.run('admin', password, 'admin', 'System Administrator');
    insertUser.run('doctor', password, 'requester', 'Requester User');
    insertUser.run('lab', password, 'lab_tech', 'Lab Technician');
  }

  // --- Seed New Test List ---
  const testsToSeed = [
    { code: 'ST', name: 'ส่งตัวอย่างเพื่อตรวจ Sterility' },
    { code: 'ID', name: 'ส่งตัวอย่างเพื่อตรวจ Identity ด้วยวิธี Flow Cytometry' },
    { code: 'VI', name: 'ส่งตัวอย่างเพื่อตรวจ Viability ด้วยวิธี Fluorescence staining assay' },
    { code: 'PO', name: 'ส่งตัวอย่างเพื่อตรวจ Potency (Cytotoxicity) ด้วยวิธี Cell Base assay' },
    { code: 'IM', name: 'ส่งตัวอย่างเพื่อตรวจ Impurity (GroBoost Detection) ด้วยวิธี qRT-PCR Assay' },
    { code: 'PU', name: 'ส่งตัวอย่างเพื่อตรวจ Purity ด้วยวิธี LAL Assay' },
    { code: 'MY', name: 'ส่งตัวอย่างเพื่อตรวจ Mycoplasma ด้วยวิธี PCR Assay' },
    { code: 'EM', name: 'การส่งตรวจ Environment Monitoring' },
    { code: 'AP', name: 'การส่งตรวจ Appearance' },
    { code: 'PH', name: 'การส่งตรวจ pH' },
    { code: 'OS', name: 'การส่งตรวจ Osmolarity' },
  ];

  const insertTest = db.prepare('INSERT OR IGNORE INTO test_items (code, name, description, reference_range, price) VALUES (?, ?, ?, ?, ?)');
  testsToSeed.forEach(test => {
    insertTest.run(test.code, test.name, '-', '-', 0.0);
  });

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('app_name', 'DMSc ATMPs LIS Management (DALM)');
  insertSetting.run('app_logo', '');
}

export function initDb() {
  try {
    runSchema();
  } catch (err: any) {
    console.error('[DB] Error during initDb:', err);
    if (err.code === 'SQLITE_CORRUPT' || err.message?.includes('malformed')) {
      console.warn('[DB] Re-creating database due to corruption...');
      try { activeDb.close(); } catch (_) {}
      const backupPath = path.join(dataDir, `lis.db.corrupt-${Date.now()}`);
      try { fs.renameSync(dbPath, backupPath); } catch (_) { try { fs.unlinkSync(dbPath); } catch (_) {} }
      activeDb = new Database(dbPath);
      runSchema();
    } else {
      throw err;
    }
  }
}

export async function backupDatabaseToFile(destinationPath: string): Promise<void> {
  await activeDb.backup(destinationPath);
}

export function reloadDatabaseFromBuffer(buffer: Buffer): void {
  try {
    activeDb.close();
  } catch (_) {}
  fs.writeFileSync(dbPath, buffer);
  activeDb = createDbConnection();
  runSchema();
}

export function getDatabasePath(): string {
  return dbPath;
}

export function recordActivityLog(params: {
  userId?: number | null;
  username?: string | null;
  userRole?: string | null;
  action: string;
  category: string;
  details?: any;
  ipAddress?: string | null;
}) {
  try {
    const detailsStr = typeof params.details === 'object' ? JSON.stringify(params.details) : (params.details || null);
    db.prepare(`
      INSERT INTO activity_logs (user_id, username, user_role, action, category, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.userId ?? null,
      params.username ?? null,
      params.userRole ?? null,
      params.action,
      params.category,
      detailsStr,
      params.ipAddress ?? null
    );
  } catch (err) {
    console.warn('[ActivityLog] Failed to record log entry:', err);
  }
}

export default dbProxy;
