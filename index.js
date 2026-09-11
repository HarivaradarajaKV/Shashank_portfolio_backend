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

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Supabase credentials
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hhajohhnsqzpnwsmasoa.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const BUCKET_NAME = 'portfolio-images';

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

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

// Password hashing helper
export function hashPassword(password) {
  const salt = 'shashank_portfolio_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

// PostgreSQL connection pool for Supabase with error handler
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Shashank#08ms',
  host: process.env.DB_HOST || 'db.hhajohhnsqzpnwsmasoa.supabase.co',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Prevent Node process exit on idle client socket disconnects
pool.on('error', (err) => {
  console.warn('[PostgreSQL Pool Warning]:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[Unhandled Rejection]:', reason);
});

// Local paths & fallback registry
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
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

// Memory upload for Supabase Storage - accepts any image format and preserves original type
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|svg|gif|avif|bmp|tiff|ico|heic|heif)$/i;
    if (!file.originalname.match(allowed) && !file.mimetype?.startsWith('image/')) {
      return cb(new Error('Only image files (webp, png, jpg, jpeg, svg, gif, avif, etc.) are allowed!'), false);
    }
    cb(null, true);
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// --- API ROUTES ---

// Root welcome & API info endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: "Shashank's Portfolio Supabase Backend API",
    database: 'PostgreSQL 17 (Supabase)',
    storage: 'portfolio-images',
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

// Health & connection status check
app.get('/api/health', async (req, res) => {
  try {
    const dbRes = await pool.query('SELECT NOW() as server_time, count(*) as image_count FROM portfolio_images;');
    res.json({
      status: 'ok',
      supabase: 'connected',
      database: 'PostgreSQL 17 (Supabase)',
      dbConnected: true,
      imageCount: dbRes.rows[0]?.image_count,
      serverTime: dbRes.rows[0]?.server_time
    });
  } catch (err) {
    res.json({
      status: 'ok',
      supabase: 'fallback_mode',
      dbConnected: false,
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

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPass = String(password).trim();

    // 1. Check in PostgreSQL database
    let adminFound = null;
    try {
      const dbRes = await pool.query('SELECT * FROM admin_users WHERE LOWER(email) = $1;', [cleanEmail]);
      if (dbRes.rows.length > 0) {
        adminFound = dbRes.rows[0];
      }
    } catch (dbErr) {
      console.warn('[Admin Login] DB query note:', dbErr.message);
    }

    const passHash = hashPassword(cleanPass);
    const isHardcodedMatch = cleanEmail === 'shashankms08112000@gmail.com' && cleanPass === 'Shashi@08';
    const isDbMatch = adminFound && (adminFound.password_hash === passHash || adminFound.password_hash === cleanPass);

    if (isDbMatch || isHardcodedMatch) {
      if (adminFound?.id) {
        pool.query('UPDATE admin_users SET last_login = NOW() WHERE id = $1;', [adminFound.id]).catch(() => {});
      }

      const token = `admin_token_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;

      return res.json({
        success: true,
        message: 'Admin authentication successful',
        user: {
          email: cleanEmail,
          role: adminFound?.role || 'superadmin',
          name: 'Shashank MS'
        },
        token
      });
    }

    return res.status(401).json({ error: 'Invalid email or password' });
  } catch (err) {
    console.error('Error during admin login:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

// GET /api/images - Fetch all slots from Supabase DB (with fallback)
app.get('/api/images', async (req, res) => {
  try {
    const dbResult = await pool.query(
      'SELECT id, title, category, project_slug, dimensions, aspect_ratio, default_src, active_src, is_custom, description, custom_file_name, file_size, storage_path, last_updated FROM portfolio_images ORDER BY project_slug, id;'
    );

    if (dbResult.rows && dbResult.rows.length > 0) {
      const slots = dbResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category,
        projectSlug: row.project_slug,
        dimensions: row.dimensions,
        aspectRatio: row.aspect_ratio,
        defaultSrc: row.default_src,
        activeSrc: row.active_src || row.default_src,
        isCustom: Boolean(row.is_custom),
        description: row.description,
        customFileName: row.custom_file_name,
        fileSize: row.file_size,
        storagePath: row.storage_path,
        lastUpdated: row.last_updated
      }));

      return res.json({
        source: 'supabase_postgres',
        slots,
        totalSlots: slots.length,
        customSlotsCount: slots.filter((s) => s.isCustom).length
      });
    }
  } catch (err) {
    console.warn('[API /images] DB query fallback to local:', err.message);
  }

  // Fallback to local default image slots + registry
  const registry = readLocalRegistry();
  const fallbackSlots = defaultImageSlots.map((slot) => {
    const override = registry[slot.id];
    return {
      ...slot,
      activeSrc: override?.url || slot.defaultSrc,
      isCustom: Boolean(override?.url),
      lastUpdated: override?.updatedAt || null,
      customFileName: override?.originalName || null
    };
  });

  res.json({
    source: 'local_fallback',
    slots: fallbackSlots,
    totalSlots: fallbackSlots.length,
    customSlotsCount: fallbackSlots.filter((s) => s.isCustom).length
  });
});

// POST /api/images/upload - Upload file to Supabase Storage & update Database preserving ORIGINAL EXTENSION
app.post('/api/images/upload', upload.single('image'), async (req, res) => {
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

    // Fetch previous image record to remove from storage bucket and local storage
    let oldStoragePath = null;
    let oldLocalFile = null;
    try {
      const prevResult = await pool.query('SELECT storage_path, active_src, is_custom FROM portfolio_images WHERE id = $1;', [slotId]);
      if (prevResult.rows.length > 0) {
        oldStoragePath = prevResult.rows[0].storage_path;
        if (prevResult.rows[0].active_src && prevResult.rows[0].active_src.startsWith('/uploads/')) {
          oldLocalFile = path.join(uploadsDir, path.basename(prevResult.rows[0].active_src));
        }
      }
    } catch (fetchErr) {
      console.warn('[Previous Image Fetch Warning]:', fetchErr.message);
    }

    // Preserve exact original extension (.webp, .png, .jpg, .jpeg, .svg, .gif, .avif, etc.)
    const originalExt = getOriginalExtension(req.file.originalname, req.file.mimetype);
    const cleanSlotId = slotId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const storagePath = `uploads/${cleanSlotId}_${Date.now()}${originalExt}`;

    let publicUrl = '';
    let uploadedToSupabase = false;

    // 1. Upload to Supabase Storage Bucket preserving exact binary and original mimetype
    try {
      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || 'application/octet-stream',
          upsert: true
        });

      if (!uploadError) {
        const { data: publicUrlData } = supabaseAdmin.storage
          .from(BUCKET_NAME)
          .getPublicUrl(storagePath);
        publicUrl = publicUrlData.publicUrl;
        uploadedToSupabase = true;

        // Clean up previous image from Supabase bucket
        if (oldStoragePath && oldStoragePath !== storagePath) {
          try {
            const { error: removeErr } = await supabaseAdmin.storage
              .from(BUCKET_NAME)
              .remove([oldStoragePath]);
            if (removeErr) {
              console.warn('[Previous Image Storage Delete Warning]:', removeErr.message);
            } else {
              console.log(`[Storage Cleanup] Deleted previous bucket image: ${oldStoragePath}`);
            }
          } catch (rmCatch) {
            console.warn('[Previous Image Storage Delete Catch]:', rmCatch.message);
          }
        }
      } else {
        console.warn('[Storage Upload Warning]:', uploadError.message);
      }
    } catch (storageErr) {
      console.warn('[Storage Catch Warning]:', storageErr.message);
    }

    // Clean up old local file if present
    if (oldLocalFile && fs.existsSync(oldLocalFile)) {
      try {
        fs.unlinkSync(oldLocalFile);
        console.log(`[Local Cleanup] Deleted previous local image: ${oldLocalFile}`);
      } catch (unlinkErr) {
        console.warn('[Local Unlink Warning]:', unlinkErr.message);
      }
    }

    // If Supabase storage was not reachable, save locally preserving original extension
    if (!uploadedToSupabase) {
      const localFileName = `${cleanSlotId}_${Date.now()}${originalExt}`;
      const localFilePath = path.join(uploadsDir, localFileName);
      fs.writeFileSync(localFilePath, req.file.buffer);
      publicUrl = `/uploads/${localFileName}`;
    }

    // 2. Update PostgreSQL table
    const now = new Date();
    try {
      const updateQuery = `
        INSERT INTO portfolio_images (
          id, title, category, project_slug, dimensions, aspect_ratio, default_src, active_src, is_custom, description, custom_file_name, file_size, storage_path, last_updated
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          active_src = EXCLUDED.active_src,
          is_custom = EXCLUDED.is_custom,
          custom_file_name = EXCLUDED.custom_file_name,
          file_size = EXCLUDED.file_size,
          storage_path = EXCLUDED.storage_path,
          last_updated = EXCLUDED.last_updated;
      `;
      await pool.query(updateQuery, [
        slotDef.id,
        slotDef.title,
        slotDef.category,
        slotDef.projectSlug,
        slotDef.dimensions,
        slotDef.aspectRatio,
        slotDef.defaultSrc,
        publicUrl,
        true,
        slotDef.description,
        req.file.originalname,
        req.file.size,
        uploadedToSupabase ? storagePath : null,
        now
      ]);
    } catch (dbErr) {
      console.warn('[DB Update Warning]:', dbErr.message);
    }

    // Also update local registry cache for offline safety
    const registry = readLocalRegistry();
    registry[slotId] = {
      url: publicUrl,
      storagePath: uploadedToSupabase ? storagePath : null,
      originalName: req.file.originalname,
      size: req.file.size,
      updatedAt: now.toISOString()
    };
    writeLocalRegistry(registry);

    const updatedSlot = {
      ...slotDef,
      activeSrc: publicUrl,
      isCustom: true,
      lastUpdated: now.toISOString(),
      customFileName: req.file.originalname
    };

    res.json({
      success: true,
      message: `Image for '${slotDef.title}' updated (${originalExt.toUpperCase()})`,
      storage: uploadedToSupabase ? 'supabase_storage' : 'local_storage',
      fileExtension: originalExt,
      slot: updatedSlot
    });
  } catch (err) {
    console.error('Error handling upload:', err);
    res.status(500).json({ error: err.message || 'Internal server error during upload' });
  }
});

// POST /api/images/reset - Reset single slot to default
app.post('/api/images/reset', async (req, res) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      return res.status(400).json({ error: 'slotId is required' });
    }

    const slotDef = defaultImageSlots.find((s) => s.id === slotId);
    if (!slotDef) {
      return res.status(404).json({ error: `Image slot with ID '${slotId}' not found` });
    }

    // Check existing record to clean storage
    try {
      const existing = await pool.query('SELECT storage_path FROM portfolio_images WHERE id = $1;', [slotId]);
      const oldStoragePath = existing.rows[0]?.storage_path;
      if (oldStoragePath && oldStoragePath.startsWith('uploads/')) {
        await supabaseAdmin.storage.from(BUCKET_NAME).remove([oldStoragePath]);
      }

      await pool.query(
        `UPDATE portfolio_images SET 
          active_src = default_src, 
          is_custom = FALSE, 
          custom_file_name = NULL, 
          file_size = NULL, 
          storage_path = NULL, 
          last_updated = NOW() 
        WHERE id = $1;`,
        [slotId]
      );
    } catch (dbErr) {
      console.warn('[DB Reset Warning]:', dbErr.message);
    }

    const registry = readLocalRegistry();
    if (registry[slotId]) {
      delete registry[slotId];
      writeLocalRegistry(registry);
    }

    res.json({
      success: true,
      message: `Slot '${slotDef.title}' reset to default`,
      slot: {
        ...slotDef,
        activeSrc: slotDef.defaultSrc,
        isCustom: false,
        lastUpdated: null,
        customFileName: null
      }
    });
  } catch (err) {
    console.error('Error resetting slot:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/images/reset-all - Reset all slots to default
app.post('/api/images/reset-all', async (req, res) => {
  try {
    try {
      const customRows = await pool.query('SELECT storage_path FROM portfolio_images WHERE is_custom = TRUE AND storage_path LIKE \'uploads/%\';');
      const pathsToDelete = customRows.rows.map((r) => r.storage_path).filter(Boolean);
      if (pathsToDelete.length > 0) {
        await supabaseAdmin.storage.from(BUCKET_NAME).remove(pathsToDelete);
      }

      await pool.query(
        `UPDATE portfolio_images SET 
          active_src = default_src, 
          is_custom = FALSE, 
          custom_file_name = NULL, 
          file_size = NULL, 
          storage_path = NULL, 
          last_updated = NOW();`
      );
    } catch (dbErr) {
      console.warn('[DB Reset-All Warning]:', dbErr.message);
    }

    writeLocalRegistry({});
    res.json({ success: true, message: 'All image slots reset to defaults in Supabase Database' });
  } catch (err) {
    console.error('Error resetting all slots:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contact - Store contact messages in Supabase
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message, projectType, budget } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }

    const result = await pool.query(
      `INSERT INTO contact_messages (name, email, message, project_type, budget) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at;`,
      [name, email, message, projectType || null, budget || null]
    );

    res.json({
      success: true,
      message: 'Message received and stored successfully!',
      id: result.rows[0]?.id
    });
  } catch (err) {
    console.error('Error saving contact message:', err);
    res.status(500).json({ error: err.message || 'Failed to save contact message' });
  }
});

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[Portfolio Backend] Server running on http://localhost:${PORT}`);
    console.log(`[Portfolio Backend] Supabase PostgreSQL connected at db.hhajohhnsqzpnwsmasoa.supabase.co`);
    console.log(`[Portfolio Backend] Supabase Storage bucket: ${BUCKET_NAME}`);
  });
}

export default app;

