import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { defaultImageSlots } from './data/imageSlots.js';
import {
  getDb,
  getAllSlots,
  getSlotById,
  getSlotByFilename,
  saveSlotUpload,
  resetSlotById,
  resetAllSlots,
  authenticateAdminUser,
  insertContactMessage
} from './db.js';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Supabase credentials
const DEFAULT_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoYWpvaGhuc3F6cG53c21hc29hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTExNzQxNywiZXhwIjoyMTA0NjkzNDE3fQ.cbtxhuzYc9f5yYXNYsGNniTToGHer1QH1Wk8tNoGJvg';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://hhajohhnsqzpnwsmasoa.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SERVICE_ROLE_KEY;
const BUCKET_NAME = process.env.SUPABASE_BUCKET || process.env.VITE_SUPABASE_BUCKET || 'portfolio-images';

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// Helper to upload to Supabase Storage with bucket auto-detection
export async function uploadToSupabaseStorage(storagePath, buffer, mimeType) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;

  const bucketCandidates = Array.from(new Set([
    process.env.SUPABASE_BUCKET,
    process.env.VITE_SUPABASE_BUCKET,
    BUCKET_NAME,
    'portfolio-images',
    'portfolio_images',
    'portfolio',
    'images',
    'uploads'
  ].filter(Boolean)));

  for (const bucket of bucketCandidates) {
    try {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: true
        });

      if (!error && data) {
        const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
        if (urlData?.publicUrl) {
          console.log(`[Supabase Storage Success] Uploaded to bucket '${bucket}': ${urlData.publicUrl}`);
          return { bucket, publicUrl: urlData.publicUrl };
        }
      } else if (error) {
        console.warn(`[Supabase Storage attempt '${bucket}']:`, error.message);
      }
    } catch (err) {
      console.warn(`[Supabase Storage exception '${bucket}']:`, err.message);
    }
  }
  return null;
}

// Helper to determine exact original extension without altering format
export function getOriginalExtension(originalname, mimetype) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (ext && ext.length > 1) {
    return ext;
  }
  switch (mimetype) {
    case 'image/webp': return '.webp';
    case 'image/jpeg':
    case 'image/jpg': return '.jpg';
    case 'image/png': return '.png';
    case 'image/svg+xml': return '.svg';
    case 'image/gif': return '.gif';
    case 'image/avif': return '.avif';
    case 'image/bmp': return '.bmp';
    case 'image/tiff': return '.tiff';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon': return '.ico';
    case 'image/heic': return '.heic';
    case 'image/heif': return '.heif';
    default: return '.webp';
  }
}

// PostgreSQL connection pool with short connection timeout so it never blocks requests
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Shashank#08ms',
  host: process.env.DB_HOST || 'db.hhajohhnsqzpnwsmasoa.supabase.co',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 1500
});

pool.on('error', (err) => {
  // Silent catch to prevent unhandled errors when remote DB is offline/paused
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[Unhandled Rejection]:', reason);
});

// Local paths & fallback registry
const isVercel = Boolean(process.env.VERCEL);
const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const dataDir = isVercel ? '/tmp' : path.join(__dirname, 'data');
const registryFile = path.join(dataDir, 'registry.json');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function readLocalRegistry() {
  try {
    if (fs.existsSync(registryFile)) {
      return JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    }
  } catch (err) {
    console.warn('[Local Registry] Read warning:', err.message);
  }
  return {};
}

function writeLocalRegistry(registry) {
  try {
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Local Registry] Write warning:', err.message);
  }
}

function getMimeTypeForExt(filenameOrExt) {
  const ext = path.extname(filenameOrExt || '').toLowerCase();
  switch (ext) {
    case '.webp': return 'image/webp';
    case '.jpg':
    case '.jpeg':
    case '.pjpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.gif': return 'image/gif';
    case '.avif': return 'image/avif';
    case '.bmp': return 'image/bmp';
    case '.tiff':
    case '.tif': return 'image/tiff';
    case '.ico': return 'image/x-icon';
    case '.heic': return 'image/heic';
    case '.heif': return 'image/heif';
    default: return 'image/png';
  }
}

// Memory upload for multer - accepts ANY image type up to 100MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    // Accept all images (any image MIME type, any image extension, or any file passed to image upload)
    cb(null, true);
  }
});

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Dedicated handler for serving uploaded images with database fallback
app.get('/uploads/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename);
  const diskPath = path.join(uploadsDir, filename);

  if (fs.existsSync(diskPath)) {
    res.setHeader('Content-Type', getMimeTypeForExt(filename));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(diskPath);
  }

  // Fallback: Check if image binary is stored in SQLite database
  try {
    const dbRecord = getSlotByFilename(filename);
    if (dbRecord && dbRecord.image_data) {
      const commaIdx = dbRecord.image_data.indexOf(',');
      if (commaIdx !== -1) {
        const meta = dbRecord.image_data.slice(0, commaIdx);
        const rawBase64 = dbRecord.image_data.slice(commaIdx + 1);
        const mimeMatch = meta.match(/^data:([^;]+)/);
        const mime = mimeMatch ? mimeMatch[1] : (dbRecord.mime_type || getMimeTypeForExt(filename));
        const buffer = Buffer.from(rawBase64, 'base64');
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(buffer);
      }
    }
  } catch (err) {
    console.warn('[Uploads DB Fallback Warning]:', err.message);
  }

  next();
});

// Serve static uploads
app.use('/uploads', express.static(uploadsDir));

// Dedicated slot image endpoint
app.get('/api/images/:slotId/file', (req, res) => {
  const { slotId } = req.params;
  const slot = getSlotById(slotId);
  if (!slot) {
    return res.status(404).json({ error: `Image slot '${slotId}' not found` });
  }

  if (slot.image_data) {
    const commaIdx = slot.image_data.indexOf(',');
    if (commaIdx !== -1) {
      const meta = slot.image_data.slice(0, commaIdx);
      const rawBase64 = slot.image_data.slice(commaIdx + 1);
      const mimeMatch = meta.match(/^data:([^;]+)/);
      const mime = mimeMatch ? mimeMatch[1] : (slot.mime_type || 'image/png');
      const buffer = Buffer.from(rawBase64, 'base64');
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    }
  }

  if (slot.active_src && slot.active_src.startsWith('/uploads/')) {
    const filename = path.basename(slot.active_src);
    const diskPath = path.join(uploadsDir, filename);
    if (fs.existsSync(diskPath)) {
      res.setHeader('Content-Type', getMimeTypeForExt(filename));
      return res.sendFile(diskPath);
    }
  }

  // Redirect to active or default image
  const target = slot.active_src || slot.default_src;
  if (target) {
    return res.redirect(target);
  }
  return res.status(404).json({ error: 'No image available for this slot' });
});

// --- API ROUTES ---

// Root status endpoint
app.get('/', (req, res) => {
  const slots = getAllSlots();
  res.json({
    status: 'online',
    service: "Shashank's Portfolio API & Storage Engine",
    database: 'SQLite (Native Embedded) + Supabase Dual-Engine',
    totalSlots: slots.length,
    customSlotsCount: slots.filter((s) => s.isCustom).length,
    endpoints: {
      health: '/api/health',
      images: '/api/images',
      upload: 'POST /api/images/upload',
      reset: 'POST /api/images/reset',
      resetAll: 'POST /api/images/reset-all',
      login: 'POST /api/admin/login',
      contact: 'POST /api/contact'
    }
  });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const slots = getAllSlots();
    const customCount = slots.filter((s) => s.isCustom).length;

    let supabaseConnected = false;
    try {
      const { error } = await Promise.race([
        supabaseAdmin.from('portfolio_images').select('id', { count: 'exact', head: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500))
      ]);
      if (!error) supabaseConnected = true;
    } catch (_supaErr) {
      try {
        const client = await Promise.race([
          pool.query('SELECT 1;'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
        ]);
        if (client) supabaseConnected = true;
      } catch (_pgErr) {
        supabaseConnected = false;
      }
    }

    res.json({
      status: 'ok',
      database: 'SQLite (Active & Persistent)',
      supabase: supabaseConnected ? 'connected' : 'standby_or_offline',
      totalSlots: slots.length,
      customSlotsCount: customCount,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    res.json({
      status: 'ok',
      database: 'SQLite (Active)',
      error: err.message
    });
  }
});

// POST /api/admin/login - Authenticate admin credentials
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const authResult = authenticateAdminUser(email, password);

    if (authResult.success) {
      const token = `admin_token_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
      return res.json({
        success: true,
        message: 'Admin authentication successful',
        user: authResult.user,
        token
      });
    }

    return res.status(401).json({ error: 'Invalid email or password' });
  } catch (err) {
    console.error('Error during admin login:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

// GET /api/images - Fetch all slots from persistent database
app.get('/api/images', async (req, res) => {
  try {
    const slots = getAllSlots();

    // 1. Try Supabase REST query (works on Vercel over HTTPS without pg pooling)
    try {
      const { data: supaRows } = await supabaseAdmin
        .from('portfolio_images')
        .select('*')
        .eq('is_custom', true);
      if (supaRows && supaRows.length > 0) {
        const supaMap = new Map(supaRows.map((r) => [r.id, r]));
        slots.forEach((s) => {
          if (supaMap.has(s.id)) {
            const row = supaMap.get(s.id);
            s.activeSrc = row.active_src || s.activeSrc;
            s.isCustom = true;
            s.customFileName = row.custom_file_name || s.customFileName;
            s.fileSize = row.file_size || s.fileSize;
            s.storagePath = row.storage_path || s.storagePath;
            s.lastUpdated = row.last_updated || s.lastUpdated;
          }
        });
      }
    } catch (_supaRestErr) {
      // Supabase REST notice
    }

    // 2. Also try remote PostgreSQL pool if available
    try {
      const pgResult = await Promise.race([
        pool.query('SELECT id, active_src, is_custom FROM portfolio_images WHERE is_custom = TRUE;'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1200))
      ]);
      if (pgResult?.rows && pgResult.rows.length > 0) {
        const pgMap = new Map(pgResult.rows.map((r) => [r.id, r]));
        slots.forEach((s) => {
          if (pgMap.has(s.id)) {
            const pgRow = pgMap.get(s.id);
            s.activeSrc = pgRow.active_src || s.activeSrc;
            s.isCustom = Boolean(pgRow.is_custom);
          }
        });
      }
    } catch (_pgPoolErr) {
      // Supabase pool standby
    }

    return res.json({
      source: 'database_sqlite_persistent',
      slots,
      totalSlots: slots.length,
      customSlotsCount: slots.filter((s) => s.isCustom).length
    });
  } catch (err) {
    console.error('[API /images] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve image slots' });
  }
});

// POST /api/images/upload - Upload file, save in database and storage
app.post('/api/images/upload', (req, res) => {
  upload.single('image')(req, res, async (multerErr) => {
    if (multerErr) {
      console.error('[Upload Multer Error]:', multerErr);
      return res.status(400).json({ error: multerErr.message || 'File upload error' });
    }
    try {
      const { slotId } = req.body;
      if (!slotId) {
        return res.status(400).json({ error: 'slotId is required in form-data' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const slotDef = defaultImageSlots.find((s) => s.id === slotId);
      if (!slotDef) {
        return res.status(404).json({ error: `Image slot with ID '${slotId}' not found` });
      }

    // Preserve exact original extension (.webp, .png, .jpg, .jpeg, .svg, .gif, .avif, etc.)
    const originalExt = getOriginalExtension(req.file.originalname, req.file.mimetype);
    const cleanSlotId = slotId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `${cleanSlotId}_${Date.now()}${originalExt}`;
    const storagePath = `uploads/${fileName}`;

    // 1. Save file to local uploads directory
    const localFilePath = path.join(uploadsDir, fileName);
    try {
      fs.writeFileSync(localFilePath, req.file.buffer);
    } catch (fsErr) {
      console.warn('[Local Disk Write Notice]:', fsErr.message);
    }
    let publicUrl = `/uploads/${fileName}`;

    // 2. Prepare base64 data URI to store directly in SQLite
    const mimeType = req.file.mimetype || 'image/png';
    const base64Data = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;

    // 3. AWAIT upload to Supabase Storage Bucket (essential for Vercel serverless so function does not freeze)
    let uploadedToSupabase = false;
    try {
      const supaResult = await uploadToSupabaseStorage(storagePath, req.file.buffer, mimeType);
      if (supaResult?.publicUrl) {
        publicUrl = supaResult.publicUrl;
        uploadedToSupabase = true;

        // Upsert into Supabase database table via HTTPS REST client
        await supabaseAdmin.from('portfolio_images').upsert({
          id: slotDef.id,
          title: slotDef.title,
          category: slotDef.category,
          project_slug: slotDef.projectSlug,
          dimensions: slotDef.dimensions,
          aspect_ratio: slotDef.aspectRatio,
          default_src: slotDef.defaultSrc,
          active_src: publicUrl,
          is_custom: true,
          description: slotDef.description,
          custom_file_name: req.file.originalname,
          file_size: req.file.size,
          storage_path: storagePath,
          last_updated: new Date().toISOString()
        }, { onConflict: 'id' }).catch((dbErr) => {
          console.warn('[Supabase DB Upsert Note]:', dbErr.message);
        });

        // Also update via PostgreSQL pool if available
        pool.query(
          `INSERT INTO portfolio_images (id, active_src, is_custom, custom_file_name, file_size, storage_path, last_updated)
           VALUES ($1, $2, TRUE, $3, $4, $5, NOW())
           ON CONFLICT (id) DO UPDATE SET
             active_src = EXCLUDED.active_src,
             is_custom = TRUE,
             custom_file_name = EXCLUDED.custom_file_name,
             file_size = EXCLUDED.file_size,
             storage_path = EXCLUDED.storage_path,
             last_updated = NOW();`,
          [slotId, publicUrl, req.file.originalname, req.file.size, storagePath]
        ).catch(() => {});
      }
    } catch (supaErr) {
      console.warn('[Supabase Storage Sync Warning]:', supaErr.message);
    }

    // 4. Store in SQLite Database (instant local persistence)
    const updatedSlot = saveSlotUpload({
      slotId,
      publicUrl,
      originalName: req.file.originalname,
      size: req.file.size,
      storagePath,
      base64Data,
      mimeType
    });

    // Clean up any old files from disk for this slot
    try {
      const existingFiles = fs.readdirSync(uploadsDir);
      for (const oldFile of existingFiles) {
        if (oldFile.startsWith(`${cleanSlotId}_`) && oldFile !== fileName) {
          const oldFilePath = path.join(uploadsDir, oldFile);
          if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
        }
      }
    } catch (cleanupErr) {
      console.warn('[Disk Cleanup Warning]:', cleanupErr.message);
    }

    // 5. Update local registry file cache
    const registry = readLocalRegistry();
    registry[slotId] = {
      url: publicUrl,
      storagePath,
      originalName: req.file.originalname,
      size: req.file.size,
      updatedAt: new Date().toISOString()
    };
    writeLocalRegistry(registry);

    console.log(`[Upload Success] Saved image for slot '${slotId}' (Supabase: ${uploadedToSupabase}, URL: ${publicUrl.substring(0, 50)}...)`);

    res.json({
      success: true,
      message: `Image for '${slotDef.title}' stored successfully! (${originalExt.toUpperCase()})`,
      storage: uploadedToSupabase ? 'supabase_storage' : 'database_and_local',
      fileExtension: originalExt,
      slot: updatedSlot
    });
  } catch (err) {
    console.error('Error handling upload:', err);
    res.status(500).json({ error: err.message || 'Internal server error during upload' });
  }
  });
});

// POST /api/images/reset - Reset single slot to default
app.post('/api/images/reset', async (req, res) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      return res.status(400).json({ error: 'slotId is required' });
    }

    const resetSlot = resetSlotById(slotId);

    // Delete disk file if it exists
    if (resetSlot.previousActiveSrc && resetSlot.previousActiveSrc.startsWith('/uploads/')) {
      const diskPath = path.join(uploadsDir, path.basename(resetSlot.previousActiveSrc));
      if (fs.existsSync(diskPath)) {
        try { fs.unlinkSync(diskPath); } catch (_fsErr) {}
      }
    }

    // Clean from registry
    const registry = readLocalRegistry();
    if (registry[slotId]) {
      delete registry[slotId];
      writeLocalRegistry(registry);
    }

    // Asynchronously update remote Supabase if available
    supabaseAdmin.from('portfolio_images').update({
      active_src: resetSlot.default_src,
      is_custom: false,
      custom_file_name: null,
      file_size: null,
      storage_path: null,
      last_updated: new Date().toISOString()
    }).eq('id', slotId).then(() => {}).catch(() => {});
    pool.query('UPDATE portfolio_images SET active_src = default_src, is_custom = FALSE WHERE id = $1;', [slotId]).catch(() => {});

    res.json({
      success: true,
      message: `Slot '${resetSlot.title}' reset to default in database`,
      slot: resetSlot
    });
  } catch (err) {
    console.error('Error resetting slot:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/images/reset-all - Reset all slots to default
app.post('/api/images/reset-all', async (req, res) => {
  try {
    const customRows = resetAllSlots();

    // Clean custom files from uploads
    for (const row of customRows) {
      if (row.active_src && row.active_src.startsWith('/uploads/')) {
        const diskPath = path.join(uploadsDir, path.basename(row.active_src));
        if (fs.existsSync(diskPath)) {
          try { fs.unlinkSync(diskPath); } catch (_cleanErr) {}
        }
      }
    }

    writeLocalRegistry({});

    supabaseAdmin.from('portfolio_images').update({
      is_custom: false,
      last_updated: new Date().toISOString()
    }).eq('is_custom', true).then(() => {}).catch(() => {});
    pool.query('UPDATE portfolio_images SET active_src = default_src, is_custom = FALSE WHERE is_custom = TRUE;').catch(() => {});

    res.json({
      success: true,
      message: 'All image slots reset to defaults in database'
    });
  } catch (err) {
    console.error('Error resetting all slots:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contact - Store contact message in database
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message, projectType, budget } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }

    const saved = insertContactMessage({ name, email, message, projectType, budget });

    // Also sync to PostgreSQL if connected
    pool.query(
      `INSERT INTO contact_messages (id, name, email, message, project_type, budget) VALUES ($1, $2, $3, $4, $5, $6);`,
      [saved.id, name, email, message, projectType || null, budget || null]
    ).catch(() => {});

    res.json({
      success: true,
      message: 'Message received and stored in database successfully!',
      id: saved.id
    });
  } catch (err) {
    console.error('Error saving contact message:', err);
    res.status(500).json({ error: err.message || 'Failed to save contact message' });
  }
});

// Start server when run standalone via CLI
const isDirectCli = Boolean(
  process.argv[1] &&
  (process.argv[1].endsWith('server/index.js') ||
   process.argv[1].endsWith('server/index') ||
   process.argv[1].endsWith('server/initDb.js'))
);

if (isDirectCli && process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`[Portfolio Backend] Server running on http://localhost:${PORT}`);
    console.log(`[Portfolio Backend] SQLite Database active at ${dataDir}`);
    console.log(`[Portfolio Backend] Ready to serve uploads & database slots`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Portfolio Backend] Port ${PORT} already active, continuing.`);
    } else {
      console.error('[Portfolio Backend] Server listen error:', err);
    }
  });
}

export default app;
