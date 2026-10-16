import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { initDb, recordActivityLog } from './server/db';
import db from './server/db';
import { 
  syncDatabaseToDrive, 
  restoreDatabaseFromDrive, 
  syncLogsToGoogleDrive,
  uploadResultFileToDrive,
  syncAllResultsToDrive,
  findFileInDrive,
  getOrCreateFolderInDrive,
  getLocalDriveSyncStatus, 
  listBackupsInDrive,
  TARGET_FOLDER_ID,
  TARGET_FOLDER_URL
} from './server/driveSync';

process.env.TZ = 'Asia/Bangkok';

// Initialize Database
console.log('[App] Initializing database...');
initDb();
console.log('[App] Database initialized.');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-prod';
// Change: Always use process.cwd() for permanent storage in this environment
const baseDir = process.cwd();
const UPLOAD_DIR = path.join(baseDir, 'uploads');

// Multer Setup for PDF Uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Multer Setup for Logo Uploads
const logoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(UPLOAD_DIR, 'logos'));
  },
  filename: function (req, file, cb) {
    cb(null, 'app-logo' + path.extname(file.originalname));
  }
});

const logoUpload = multer({
  storage: logoStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed!'));
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- Middleware ---

  // Authentication Middleware
  const authenticateToken = (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    // Fallback: Check query parameter for token (useful for direct file links)
    if (!token && req.query.token) {
      token = req.query.token as string;
    }

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // RBAC Middleware
  const requireRole = (roles: string[]) => {
    return (req: any, res: Response, next: NextFunction) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      next();
    };
  };

  // --- API Routes ---

  // Auth: Login
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '8h' });
    recordActivityLog({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action: `User ${user.name} logged in`,
      category: 'auth',
      ipAddress: req.ip
    });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
  });

  // Settings: Get (Public)
  app.get('/api/settings', (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    const result: Record<string, string> = {};
    settings.forEach(s => {
      result[s.key] = s.value;
    });
    res.json(result);
  });

  // Settings: Update (Admin only)
  app.patch('/api/settings', authenticateToken, requireRole(['admin']), (req, res) => {
    const { app_name } = req.body;
    try {
      if (app_name) {
        db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(app_name, 'app_name');
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Settings: Upload Logo (Admin only)
  app.post('/api/settings/logo', authenticateToken, requireRole(['admin']), logoUpload.single('logo'), (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const logoPath = `/api/logos/${req.file.filename}?v=${Date.now()}`;
    try {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(logoPath, 'app_logo');
      res.json({ success: true, logoPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Logos: Serve
  app.get('/api/logos/:filename', (req, res) => {
    const filePath = path.join(UPLOAD_DIR, 'logos', req.params.filename);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'Logo not found' });
    }
  });

  // Users: List (Admin only)
  app.get('/api/users', authenticateToken, requireRole(['admin']), (req, res) => {
    const users = db.prepare('SELECT id, username, role, name, created_at FROM users ORDER BY created_at DESC').all();
    res.json(users);
  });

  // Users: Create (Admin only)
  app.post('/api/users', authenticateToken, requireRole(['admin']), (req, res) => {
    const { username, password, role, name } = req.body;
    
    // Validate role
    if (!['admin', 'requester', 'lab_tech'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    try {
      const salt = bcrypt.genSaltSync(10);
      const hashedPassword = bcrypt.hashSync(password, salt);
      
      const stmt = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
      const result = stmt.run(username, hashedPassword, role, name);
      
      res.json({ id: result.lastInsertRowid, username, role, name });
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(400).json({ error: 'Username already exists' });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Users: Update (Admin only) - Password reset or details update
  app.patch('/api/users/:id', authenticateToken, requireRole(['admin']), (req, res) => {
    const { password, role, name } = req.body;
    const userId = req.params.id;

    try {
      const updates = [];
      const params = [];

      if (password) {
        const salt = bcrypt.genSaltSync(10);
        updates.push('password = ?');
        params.push(bcrypt.hashSync(password, salt));
      }
      if (role) {
        if (!['admin', 'requester', 'lab_tech'].includes(role)) {
          return res.status(400).json({ error: 'Invalid role' });
        }
        updates.push('role = ?');
        params.push(role);
      }
      if (name) {
        updates.push('name = ?');
        params.push(name);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      params.push(userId);
      const stmt = db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`);
      const result = stmt.run(...params);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Users: Delete (Admin only)
  app.delete('/api/users/:id', authenticateToken, requireRole(['admin']), (req, res) => {
    try {
      // Prevent deleting self
      if (parseInt(req.params.id) === (req as any).user.id) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
      }

      const stmt = db.prepare('DELETE FROM users WHERE id = ?');
      const result = stmt.run(req.params.id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Tests: List (Public/Authenticated)
  app.get('/api/tests', authenticateToken, (req, res) => {
    const tests = db.prepare('SELECT * FROM test_items WHERE is_active = 1').all();
    res.json(tests);
  });

  // Tests: Create (Admin only)
  app.post('/api/tests', authenticateToken, requireRole(['admin']), (req, res) => {
    const { code, name, description, reference_range, price } = req.body;
    try {
      const stmt = db.prepare('INSERT INTO test_items (code, name, description, reference_range, price) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(code, name, description, reference_range, price);
      res.json({ id: result.lastInsertRowid, ...req.body });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Tests: Update (Admin only)
  app.patch('/api/tests/:id', authenticateToken, requireRole(['admin']), (req, res) => {
    const { code, name, description, reference_range, price } = req.body;
    try {
      const stmt = db.prepare('UPDATE test_items SET code = ?, name = ?, description = ?, reference_range = ?, price = ? WHERE id = ?');
      const result = stmt.run(code, name, description, reference_range, price, req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: 'Test not found' });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Tests: Delete (Admin only)
  app.delete('/api/tests/:id', authenticateToken, requireRole(['admin']), (req, res) => {
    try {
      // Soft delete by setting is_active = 0 to preserve historical requests
      const stmt = db.prepare('UPDATE test_items SET is_active = 0 WHERE id = ?');
      const result = stmt.run(req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: 'Test not found' });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Requests: Create (Requester only)
  app.post('/api/requests', authenticateToken, requireRole(['requester', 'admin']), (req: any, res) => {
    const { lot_number, sample_name, case_name, tube_count, test_item_ids, is_initial, is_in_process, is_finish_product, processing_day } = req.body; // test_item_ids is array of numbers
    
    const createRequest = db.transaction(() => {
      const stmt = db.prepare('INSERT INTO requests (requester_id, lot_number, sample_name, case_name, tube_count, is_initial, is_in_process, is_finish_product, processing_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const result = stmt.run(req.user.id, lot_number, sample_name, case_name || null, tube_count || 1, is_initial ? 1 : 0, is_in_process ? 1 : 0, is_finish_product ? 1 : 0, processing_day || 0);
      const requestId = result.lastInsertRowid;

      const itemStmt = db.prepare('INSERT INTO request_items (request_id, test_item_id) VALUES (?, ?)');
      for (const testId of test_item_ids) {
        itemStmt.run(requestId, testId);
      }

      // Notification: Notify Lab Techs
      const labTechs = db.prepare("SELECT id FROM users WHERE role = 'lab_tech'").all() as any[];
      const notifStmt = db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)');
      for (const tech of labTechs) {
        notifStmt.run(tech.id, `New request #${requestId} for ${sample_name} (${tube_count || 1} tubes) created by ${req.user.name}`);
      }

      return requestId;
    });

    try {
      const requestId = createRequest();
      recordActivityLog({
        userId: req.user.id,
        username: req.user.username,
        userRole: req.user.role,
        action: `Created sample request #${requestId} (${sample_name})`,
        category: 'request',
        details: { requestId, sample_name, lot_number, case_name, tube_count },
        ipAddress: req.ip
      });
      res.json({ id: requestId, message: 'Request created successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Requests: List (All users see all requests)
  app.get('/api/requests', authenticateToken, (req: any, res) => {
    const stmt = db.prepare(`
      SELECT r.*, u.name as requester_name, count(ri.id) as test_count, res.file_path as result_file, res.drive_file_id, res.drive_web_link, GROUP_CONCAT(ti.code) as test_codes
      FROM requests r 
      JOIN users u ON r.requester_id = u.id
      LEFT JOIN request_items ri ON r.id = ri.request_id 
      LEFT JOIN test_items ti ON ri.test_item_id = ti.id
      LEFT JOIN results res ON r.id = res.request_id
      GROUP BY r.id 
      ORDER BY r.created_at DESC
    `);
    res.json(stmt.all());
  });

  // Request: Get Details
  app.get('/api/requests/:id', authenticateToken, (req, res) => {
    const request = db.prepare(`
      SELECT r.*, u.name as requester_name 
      FROM requests r 
      JOIN users u ON r.requester_id = u.id 
      WHERE r.id = ?
    `).get(req.params.id);

    if (!request) return res.status(404).json({ error: 'Request not found' });

    const items = db.prepare(`
      SELECT ti.* 
      FROM request_items ri 
      JOIN test_items ti ON ri.test_item_id = ti.id 
      WHERE ri.request_id = ?
    `).all(req.params.id);

    const results = db.prepare(`
      SELECT * FROM results WHERE request_id = ?
    `).all(req.params.id);

    res.json({ ...request, items, results });
  });

  // Request: Delete (Admin only)
  app.delete('/api/requests/:id', authenticateToken, requireRole(['admin']), (req, res) => {
    const requestId = parseInt(req.params.id);
    const { password } = req.body;
    
    console.log(`[DELETE] Attempting to delete request #${requestId} by user ${(req as any).user.username}`);

    if (isNaN(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required to confirm deletion' });
    }

    // Verify admin password
    const adminId = (req as any).user.id;
    const adminUser = db.prepare('SELECT password FROM users WHERE id = ?').get(adminId) as { password: string };

    if (!adminUser || !bcrypt.compareSync(password, adminUser.password)) {
      return res.status(403).json({ error: 'Invalid password' });
    }

    try {
      const deleteTx = db.transaction(() => {
        // Delete related items first
        const itemsRes = db.prepare('DELETE FROM request_items WHERE request_id = ?').run(requestId);
        console.log(`[DELETE] Deleted ${itemsRes.changes} request items`);

        const resultsRes = db.prepare('DELETE FROM results WHERE request_id = ?').run(requestId);
        console.log(`[DELETE] Deleted ${resultsRes.changes} result files`);

        // We don't delete notifications as they are historical records for users
        
        const result = db.prepare('DELETE FROM requests WHERE id = ?').run(requestId);
        console.log(`[DELETE] Deleted request record. Changes: ${result.changes}`);

        if (result.changes === 0) throw new Error('Request not found');
      });

      deleteTx();
      recordActivityLog({
        userId: (req as any).user.id,
        username: (req as any).user.username,
        userRole: (req as any).user.role,
        action: `Deleted sample request #${requestId}`,
        category: 'request',
        details: { requestId },
        ipAddress: req.ip
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE] Error:', error);
      res.status(error.message === 'Request not found' ? 404 : 500).json({ error: error.message });
    }
  });

  // Request: Update Details (Admin only)
  app.patch('/api/requests/:id', authenticateToken, requireRole(['admin']), (req, res) => {
    const { sample_name, case_name, lot_number, tube_count, test_item_ids, is_initial, is_in_process, is_finish_product, processing_day } = req.body;
    const requestId = req.params.id;

    try {
      const updateTx = db.transaction(() => {
        const updates: string[] = [];
        const params: any[] = [];

        if (sample_name !== undefined) { updates.push('sample_name = ?'); params.push(sample_name); }
        if (case_name !== undefined) { updates.push('case_name = ?'); params.push(case_name); }
        if (lot_number !== undefined) { updates.push('lot_number = ?'); params.push(lot_number); }
        if (tube_count !== undefined) { updates.push('tube_count = ?'); params.push(tube_count); }
        if (is_initial !== undefined) { updates.push('is_initial = ?'); params.push(is_initial ? 1 : 0); }
        if (is_in_process !== undefined) { updates.push('is_in_process = ?'); params.push(is_in_process ? 1 : 0); }
        if (is_finish_product !== undefined) { updates.push('is_finish_product = ?'); params.push(is_finish_product ? 1 : 0); }
        if (processing_day !== undefined) { updates.push('processing_day = ?'); params.push(processing_day); }
        
        updates.push('updated_at = strftime(\'%Y-%m-%dT%H:%M:%SZ\', \'now\')');

        if (updates.length > 0) {
           params.push(requestId);
           db.prepare(`UPDATE requests SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        if (test_item_ids && Array.isArray(test_item_ids)) {
          db.prepare('DELETE FROM request_items WHERE request_id = ?').run(requestId);
          const itemStmt = db.prepare('INSERT INTO request_items (request_id, test_item_id) VALUES (?, ?)');
          for (const testId of test_item_ids) {
            itemStmt.run(requestId, testId);
          }
        }
      });

      updateTx();
      recordActivityLog({
        userId: (req as any).user.id,
        username: (req as any).user.username,
        userRole: (req as any).user.role,
        action: `Updated sample request #${requestId}`,
        category: 'request',
        details: { requestId, sample_name, lot_number, tube_count },
        ipAddress: req.ip
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Request: Suggest Lab Number
  app.get('/api/requests/:id/suggest-lab-number', authenticateToken, requireRole(['lab_tech', 'admin']), (req, res) => {
    const requestId = req.params.id;
    const request = db.prepare('SELECT sample_name, case_name, is_initial, is_in_process, is_finish_product FROM requests WHERE id = ?').get(requestId) as any;
    
    if (!request) return res.status(404).json({ error: 'Request not found' });

    // 1. Prefix QC
    const prefix = 'QC';

    // 2. Sample Name
    const sampleName = request.sample_name || '';

    // 3. Stage Code (IN, IP, FP)
    let stageCode = '';
    if (request.is_initial) stageCode = 'IN';
    else if (request.is_in_process) stageCode = 'IP';
    else if (request.is_finish_product) stageCode = 'FP';

    // 4. Test Code (2 characters from the first test item)
    const firstTest = db.prepare(`
      SELECT ti.code 
      FROM request_items ri 
      JOIN test_items ti ON ri.test_item_id = ti.id 
      WHERE ri.request_id = ? 
      LIMIT 1
    `).get(requestId) as { code: string } | undefined;
    
    const testCode = (firstTest?.code || 'XX').substring(0, 2).toUpperCase();

    // 5. Sequence (001-999) for this Patient Name (case_name)
    const patientName = request.case_name || '';
    // We count how many requests for THIS patient exist that were created AT OR BEFORE this request
    const countResult = db.prepare('SELECT count(*) as count FROM requests WHERE case_name = ? AND id <= ?').get(patientName, requestId) as { count: number };
    const sequence = String(countResult.count).padStart(3, '0');

    const suggested = `${prefix}${stageCode}${sampleName}${testCode}${sequence}`;
    res.json({ suggested });
  });

  // Request: Receive Sample (Lab Tech only)
  app.patch('/api/requests/:id/receive', authenticateToken, requireRole(['lab_tech', 'admin']), (req: any, res) => {
    const requestId = req.params.id;
    const { lab_number } = req.body;
    
    const stmt = db.prepare("UPDATE requests SET status = 'received', lab_number = ?, received_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND status = 'pending'");
    const result = stmt.run(lab_number || null, requestId);

    if (result.changes === 0) {
      return res.status(400).json({ error: 'Request not found or not in pending status' });
    }

    // Notification: Notify Requester
    const request = db.prepare('SELECT requester_id, sample_name FROM requests WHERE id = ?').get(requestId) as any;
    if (request) {
      db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(
        request.requester_id, 
        `Sample ${request.sample_name} (Request #${requestId}) has been received by lab.`
      );
    }

    recordActivityLog({
      userId: req.user.id,
      username: req.user.username,
      userRole: req.user.role,
      action: `Confirmed sample received & assigned Lab Number ${lab_number || '-'} for request #${requestId}`,
      category: 'sample',
      details: { requestId, lab_number },
      ipAddress: req.ip
    });

    res.json({ success: true });
  });

  // Request: Update Status (Lab Tech only)
  app.patch('/api/requests/:id/status', authenticateToken, requireRole(['lab_tech', 'admin']), (req, res) => {
    const { status } = req.body;
    const stmt = db.prepare('UPDATE requests SET status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%SZ\', \'now\') WHERE id = ?');
    stmt.run(status, req.params.id);
    recordActivityLog({
      userId: (req as any).user.id,
      username: (req as any).user.username,
      userRole: (req as any).user.role,
      action: `Updated request #${req.params.id} status to ${status}`,
      category: 'sample',
      details: { requestId: req.params.id, status },
      ipAddress: req.ip
    });
    res.json({ success: true });
  });

  // Result: Upload PDF (Lab Tech only)
  app.post('/api/requests/:id/result', authenticateToken, requireRole(['lab_tech', 'admin']), upload.single('file'), async (req: any, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const requestId = req.params.id;
    const driveToken = (req.headers['x-drive-token'] as string) || req.body.driveAccessToken;
    
    let driveFileId: string | null = null;
    let driveWebLink: string | null = null;
    let driveUploaded = false;

    // Fetch request details for naming and notifications
    const request = db.prepare('SELECT requester_id, sample_name, lab_number, lot_number FROM requests WHERE id = ?').get(requestId) as any;

    // If Google Drive token is provided, upload file to Google Drive subfolder for this Lot Number
    if (driveToken && req.file.path && fs.existsSync(req.file.path)) {
      try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const ext = path.extname(req.file.originalname) || '.pdf';
        const lotFolderName = (request?.lot_number || 'General').trim();

        // 1. Get or create folder for this Lot Number in TARGET_FOLDER_ID
        const lotFolder = await getOrCreateFolderInDrive(driveToken, lotFolderName, TARGET_FOLDER_ID);

        // 2. Set file name as Lab Number
        const driveFileName = `${request?.lab_number || ('Req-' + requestId)}${ext}`;

        const uploaded = await uploadResultFileToDrive(
          driveToken,
          driveFileName,
          req.file.mimetype || 'application/pdf',
          fileBuffer,
          `Result for ${request?.sample_name || ''} (Request #${requestId}, Lab ${request?.lab_number || '-'}, Lot ${lotFolderName})`,
          lotFolder.id
        );

        driveFileId = uploaded.id;
        driveWebLink = uploaded.webViewLink;
        driveUploaded = true;
      } catch (driveErr: any) {
        console.warn('[Upload to Drive Warning]: Failed to upload result to Google Drive:', driveErr.message);
      }
    }
    
    const uploadTx = db.transaction(() => {
      // Save result record with drive file details
      const stmt = db.prepare('INSERT INTO results (request_id, file_path, original_name, uploaded_by, drive_file_id, drive_web_link) VALUES (?, ?, ?, ?, ?, ?)');
      stmt.run(requestId, req.file.filename, req.file.originalname, req.user.id, driveFileId, driveWebLink);

      // Auto-update status to completed
      db.prepare("UPDATE requests SET status = 'completed', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?").run(requestId);

      // Notification: Notify Requester and Admins
      if (request) {
        const message = `Result for ${request.sample_name} (Request #${requestId}) is ready.`;
        
        // Notify original requester
        db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(request.requester_id, message);
        
        // Also notify all admins (except the one who might have uploaded it)
        const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND id != ?").all(req.user.id) as any[];
        const adminNotifStmt = db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)');
        for (const admin of admins) {
          if (admin.id !== request.requester_id) { // Don't notify twice if requester is admin
            adminNotifStmt.run(admin.id, message);
          }
        }
      }
    });

    try {
      uploadTx();
      recordActivityLog({
        userId: req.user.id,
        username: req.user.username,
        userRole: req.user.role,
        action: `Uploaded test result for request #${requestId} (${req.file.originalname})${driveUploaded ? ' and saved to Google Drive' : ''}`,
        category: 'result',
        details: { requestId, fileName: req.file.originalname, driveUploaded, driveFileId, driveWebLink },
        ipAddress: req.ip
      });
      res.json({ 
        success: true, 
        file: req.file.filename,
        driveUploaded,
        driveFileId,
        driveWebLink 
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Result: Manually sync existing result to Google Drive
  app.post('/api/requests/:id/sync-drive-result', authenticateToken, requireRole(['lab_tech', 'admin']), async (req: any, res) => {
    const driveToken = (req.headers['x-drive-token'] as string) || req.body.driveAccessToken;
    if (!driveToken) {
      return res.status(400).json({ error: 'Google Drive authorization token required' });
    }

    const requestId = req.params.id;
    const resultRecord = db.prepare('SELECT * FROM results WHERE request_id = ? ORDER BY id DESC LIMIT 1').get(requestId) as any;
    if (!resultRecord) {
      return res.status(404).json({ error: 'No result file found for this request' });
    }

    const filePath = path.join(UPLOAD_DIR, resultRecord.file_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Local result file not found on server' });
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const request = db.prepare('SELECT sample_name, lab_number, lot_number FROM requests WHERE id = ?').get(requestId) as any;
      const ext = path.extname(resultRecord.original_name || resultRecord.file_path) || '.pdf';
      const lotFolderName = (request?.lot_number || 'General').trim();

      // 1. Get or create folder for this Lot Number in TARGET_FOLDER_ID
      const lotFolder = await getOrCreateFolderInDrive(driveToken, lotFolderName, TARGET_FOLDER_ID);

      // 2. Set file name as Lab Number
      const driveFileName = `${request?.lab_number || ('Req-' + requestId)}${ext}`;

      const uploaded = await uploadResultFileToDrive(
        driveToken,
        driveFileName,
        'application/pdf',
        fileBuffer,
        `Result for ${request?.sample_name || ''} (Request #${requestId}, Lab ${request?.lab_number || '-'}, Lot ${lotFolderName})`,
        lotFolder.id
      );

      db.prepare('UPDATE results SET drive_file_id = ?, drive_web_link = ? WHERE id = ?').run(
        uploaded.id,
        uploaded.webViewLink,
        resultRecord.id
      );

      recordActivityLog({
        userId: req.user.id,
        username: req.user.username,
        userRole: req.user.role,
        action: `Synced test result for request #${requestId} to Google Drive (Lot ${lotFolderName}, File ${driveFileName})`,
        category: 'drive',
        details: { requestId, lotFolderName, driveFileName, driveWebLink: uploaded.webViewLink },
        ipAddress: req.ip
      });

      res.json({
        success: true,
        driveFileId: uploaded.id,
        driveWebLink: uploaded.webViewLink
      });
    } catch (error: any) {
      const details = error.details || { message: error.message };
      res.status(details.status || 500).json({ error: error.message, details });
    }
  });

  // Results: Download
  app.get('/api/results/:filename', authenticateToken, (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Notifications: Get My Notifications
  app.get('/api/notifications', authenticateToken, (req: any, res) => {
    const notifs = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
    res.json(notifs);
  });

  // Patients: Search (for auto-fill)
  app.get('/api/patients/search', authenticateToken, (req: any, res) => {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.length < 1) return res.json([]);

    try {
      const stmt = db.prepare(`
        SELECT lot_number, case_name, sample_name
        FROM requests
        WHERE lot_number LIKE ? OR case_name LIKE ? OR sample_name LIKE ?
        GROUP BY lot_number, case_name, sample_name
        ORDER BY MAX(created_at) DESC
        LIMIT 5
      `);
      const results = stmt.all(`%${q}%`, `%${q}%`, `%${q}%`);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Notifications: Mark All as Read
  app.patch('/api/notifications/read', authenticateToken, (req: any, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ success: true });
  });

  // --- Google Drive Database Persistence Endpoints ---

  // Drive: Get sync status
  app.get('/api/drive/status', authenticateToken, async (req: any, res) => {
    try {
      const status = getLocalDriveSyncStatus();
      const driveToken = (req.headers['x-drive-token'] as string) || (req.query.driveToken as string);
      let driveFileInfo = null;
      let driveError = null;

      if (driveToken) {
        try {
          const { findFileInDrive } = await import('./server/driveSync');
          driveFileInfo = await findFileInDrive(driveToken, 'lis.db');
        } catch (err: any) {
          driveError = err.details || { message: err.message, status: 500 };
        }
      }
      res.json({ ...status, driveFileInfo, driveError });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Drive: List backups in folder
  app.get('/api/drive/backups', authenticateToken, async (req: any, res) => {
    const driveToken = (req.headers['x-drive-token'] as string) || (req.query.driveToken as string);
    if (!driveToken) {
      return res.status(400).json({ error: 'Google Drive authorization token required (header x-drive-token)' });
    }
    try {
      const files = await listBackupsInDrive(driveToken);
      res.json(files);
    } catch (error: any) {
      const details = error.details || { message: error.message };
      res.status(details.status || 500).json({ error: error.message, details });
    }
  });

  // Drive: Sync database to Google Drive folder
  app.post('/api/drive/sync', authenticateToken, async (req: any, res) => {
    const driveToken = (req.headers['x-drive-token'] as string) || req.body.driveAccessToken;
    if (!driveToken) {
      return res.status(400).json({ error: 'Google Drive authorization token is required' });
    }

    try {
      const result = await syncDatabaseToDrive(driveToken);
      recordActivityLog({
        userId: req.user.id,
        username: req.user.username,
        userRole: req.user.role,
        action: 'Synced database and activity logs to Google Drive',
        category: 'drive',
        details: { folderId: TARGET_FOLDER_ID, lastSynced: result.lastSynced },
        ipAddress: req.ip
      });
      res.json(result);
    } catch (error: any) {
      const details = error.details || { message: error.message };
      res.status(details.status || 500).json({ error: error.message, details });
    }
  });

  // Drive: Restore database from Google Drive
  app.post('/api/drive/restore', authenticateToken, requireRole(['admin']), async (req: any, res) => {
    const driveToken = (req.headers['x-drive-token'] as string) || req.body.driveAccessToken;
    const fileId = req.body.fileId;
    if (!driveToken) {
      return res.status(400).json({ error: 'Google Drive authorization token is required' });
    }

    try {
      const result = await restoreDatabaseFromDrive(driveToken, fileId);
      recordActivityLog({
        userId: req.user.id,
        username: req.user.username,
        userRole: req.user.role,
        action: 'Restored database from Google Drive',
        category: 'drive',
        details: { folderId: TARGET_FOLDER_ID },
        ipAddress: req.ip
      });
      res.json(result);
    } catch (error: any) {
      const details = error.details || { message: error.message };
      res.status(details.status || 500).json({ error: error.message, details });
    }
  });

  // Drive: Auto-Sync on App Open
  // Automatically synchronizes latest state when application is opened
  app.post('/api/drive/auto-sync-open', authenticateToken, async (req: any, res) => {
    const driveToken = (req.headers['x-drive-token'] as string) || req.body.driveAccessToken;
    if (!driveToken) {
      return res.status(400).json({ error: 'Google Drive authorization token is required' });
    }

    try {
      const driveFile = await findFileInDrive(driveToken, 'lis.db');

      if (!driveFile) {
        // If Google Drive folder does not have lis.db yet, sync current local database
        const syncResult = await syncDatabaseToDrive(driveToken);
        return res.json({
          action: 'synced_to_drive',
          message: 'Initial database snapshot synced to Google Drive',
          lastSynced: syncResult.lastSynced,
        });
      }

      // Check local sync time
      const localLastSynced = (db.prepare("SELECT value FROM settings WHERE key = 'drive_last_synced'").get() as any)?.value;
      const driveModified = driveFile.modifiedTime ? new Date(driveFile.modifiedTime).getTime() : 0;
      const localTime = localLastSynced ? new Date(localLastSynced).getTime() : 0;

      // If local database has never synced or Drive file is newer (or app was freshly launched on new container)
      if (!localLastSynced || driveModified > localTime) {
        const restoreResult = await restoreDatabaseFromDrive(driveToken, driveFile.id);
        recordActivityLog({
          userId: req.user.id,
          username: req.user.username,
          userRole: req.user.role,
          action: 'Auto-synced latest database from Google Drive on app launch',
          category: 'drive',
          details: { driveModified: driveFile.modifiedTime, stats: restoreResult.stats },
          ipAddress: req.ip
        });

        return res.json({
          action: 'restored_from_drive',
          message: 'Restored latest database from Google Drive',
          stats: restoreResult.stats,
          lastSynced: new Date().toISOString(),
          driveFileInfo: driveFile
        });
      }

      return res.json({
        action: 'already_up_to_date',
        message: 'Database is already up to date with Google Drive',
        lastSynced: localLastSynced,
        driveFileInfo: driveFile
      });
    } catch (error: any) {
      const details = error.details || { message: error.message };
      res.status(details.status || 500).json({ error: error.message, details });
    }
  });

  // --- Activity Log Management Endpoints (Admin Only) ---

  // Logs: List activity logs with filtering and pagination
  app.get('/api/logs', authenticateToken, requireRole(['admin']), (req: any, res: Response) => {
    try {
      const { category, search, limit = '100', offset = '0' } = req.query;
      let query = 'SELECT * FROM activity_logs WHERE 1=1';
      const params: any[] = [];

      if (category && category !== 'all') {
        query += ' AND category = ?';
        params.push(category);
      }

      if (search) {
        query += ' AND (action LIKE ? OR username LIKE ? OR details LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

      const logs = db.prepare(query).all(...params);

      // Total count
      let countQuery = 'SELECT COUNT(*) as count FROM activity_logs WHERE 1=1';
      const countParams: any[] = [];
      if (category && category !== 'all') {
        countQuery += ' AND category = ?';
        countParams.push(category);
      }
      if (search) {
        countQuery += ' AND (action LIKE ? OR username LIKE ? OR details LIKE ?)';
        countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      const total = (db.prepare(countQuery).get(...countParams) as any)?.count || 0;

      // Stats
      const today = new Date().toISOString().slice(0, 10);
      const totalToday = (db.prepare("SELECT COUNT(*) as count FROM activity_logs WHERE created_at LIKE ?").get(`${today}%`) as any)?.count || 0;
      const categoriesSummary = db.prepare("SELECT category, COUNT(*) as count FROM activity_logs GROUP BY category").all();

      res.json({
        logs,
        total,
        stats: {
          totalToday,
          categoriesSummary,
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Logs: Sync activity logs to Google Drive
  app.post('/api/logs/sync-drive', authenticateToken, requireRole(['admin']), async (req: any, res: Response) => {
    const driveToken = (req.headers['x-drive-token'] as string) || req.body.driveAccessToken;
    if (!driveToken) {
      return res.status(400).json({ error: 'Google Drive authorization token required' });
    }

    try {
      const result = await syncLogsToGoogleDrive(driveToken);
      recordActivityLog({
        userId: req.user.id,
        username: req.user.username,
        userRole: req.user.role,
        action: 'Manual sync activity logs to Google Drive',
        category: 'drive',
        details: { count: result.count, folderUrl: result.folderUrl },
        ipAddress: req.ip
      });
      res.json(result);
    } catch (error: any) {
      const details = error.details || { message: error.message };
      res.status(details.status || 500).json({ error: error.message, details });
    }
  });

  // Logs: Export (CSV or JSON)
  app.get('/api/logs/export', authenticateToken, requireRole(['admin']), (req: any, res: Response) => {
    try {
      const format = (req.query.format as string) || 'csv';
      const logs = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC').all() as any[];

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="dalm_activity_logs.json"');
        return res.send(JSON.stringify(logs, null, 2));
      }

      // CSV export
      const headers = ['ID', 'Timestamp', 'Username', 'Role', 'Category', 'Action', 'Details', 'IP_Address'];
      const escape = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const rows = [headers.join(',')];
      for (const log of logs) {
        rows.push([
          log.id,
          escape(log.created_at),
          escape(log.username),
          escape(log.user_role),
          escape(log.category),
          escape(log.action),
          escape(log.details),
          escape(log.ip_address)
        ].join(','));
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dalm_activity_logs.csv"');
      res.send('\uFEFF' + rows.join('\r\n'));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[SERVER ERROR]:', err);
    res.status(err.status || 500).json({ 
      error: err.message || 'Internal Server Error' 
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    
    // SPA Fallback for development
    app.get('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[App] ${process.env.NODE_ENV === 'production' ? 'Production' : 'Development'} server running on http://localhost:${PORT}`);
  });
}

startServer();

