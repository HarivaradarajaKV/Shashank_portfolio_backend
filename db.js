import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { defaultImageSlots } from './data/imageSlots.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database directory & path
// On Vercel serverless, /tmp is the only writable directory
const isVercel = Boolean(process.env.VERCEL);
const dbDir = isVercel ? '/tmp' : path.join(__dirname, 'data');
const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const dbPath = path.join(dbDir, 'portfolio.db');

if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Password hashing helper matching project salt
export function hashPassword(password) {
  const salt = 'shashank_portfolio_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

// Initialize SQLite database connection
let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(dbPath);
    // Enable WAL mode for better concurrency and performance
    try {
      dbInstance.exec('PRAGMA journal_mode = WAL;');
      dbInstance.exec('PRAGMA synchronous = NORMAL;');
    } catch (e) {
      // In-memory or restricted filesystem fallback
    }
    initializeTables(dbInstance);
  }
  return dbInstance;
}

function initializeTables(db) {
  // 1. portfolio_images table
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_images (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      default_src TEXT NOT NULL,
      active_src TEXT NOT NULL,
      is_custom INTEGER DEFAULT 0,
      description TEXT,
      custom_file_name TEXT,
      file_size INTEGER,
      storage_path TEXT,
      image_data TEXT,
      mime_type TEXT,
      last_updated TEXT,
      created_at TEXT
    );
  `);

  // 2. admin_users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'superadmin',
      last_login TEXT,
      created_at TEXT
    );
  `);

  // 3. contact_messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      project_type TEXT,
      budget TEXT,
      created_at TEXT
    );
  `);

  // Seed Admin user
  const adminEmail = 'shashankms08112000@gmail.com';
  const adminPass = 'Shashi@08';
  const passHash = hashPassword(adminPass);
  const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE LOWER(email) = ?;').get(adminEmail);
  if (!existingAdmin) {
    db.prepare(`
      INSERT INTO admin_users (id, email, password_hash, role, created_at)
      VALUES (?, ?, ?, 'superadmin', ?);
    `).run(crypto.randomUUID(), adminEmail, passHash, new Date().toISOString());
  }

  // Seed default image slots
  const selectSlot = db.prepare('SELECT id, is_custom, active_src FROM portfolio_images WHERE id = ?;');
  const insertSlot = db.prepare(`
    INSERT INTO portfolio_images (
      id, title, category, project_slug, dimensions, aspect_ratio,
      default_src, active_src, is_custom, description, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?);
  `);
  const updateSlotMeta = db.prepare(`
    UPDATE portfolio_images SET
      title = ?, category = ?, project_slug = ?, dimensions = ?,
      aspect_ratio = ?, default_src = ?, description = ?
    WHERE id = ?;
  `);

  const now = new Date().toISOString();
  for (const slot of defaultImageSlots) {
    const existing = selectSlot.get(slot.id);
    if (!existing) {
      insertSlot.run(
        slot.id,
        slot.title,
        slot.category,
        slot.projectSlug,
        slot.dimensions,
        slot.aspectRatio,
        slot.defaultSrc,
        slot.defaultSrc,
        slot.description,
        now
      );
    } else {
      updateSlotMeta.run(
        slot.title,
        slot.category,
        slot.projectSlug,
        slot.dimensions,
        slot.aspectRatio,
        slot.defaultSrc,
        slot.description,
        slot.id
      );
    }
  }

  // Scan local uploads directory for any already uploaded files and attach to slot if unassigned
  try {
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        if (file === '.gitkeep' || file === '.DS_Store') continue;
        // Check slot id from file name pattern: <slotId>_<timestamp>.<ext>
        const match = file.match(/^(.+)_\d+\.[a-zA-Z0-9]+$/);
        if (match) {
          const rawPrefix = match[1];
          // Find matching slot (convert _ back to - if needed)
          const matchedSlot = defaultImageSlots.find(
            (s) => s.id === rawPrefix || s.id.replace(/[^a-zA-Z0-9-_]/g, '_') === rawPrefix
          );
          if (matchedSlot) {
            const currentSlot = selectSlot.get(matchedSlot.id);
            if (currentSlot && !currentSlot.is_custom) {
              const fullFilePath = path.join(uploadsDir, file);
              const stats = fs.statSync(fullFilePath);
              const ext = path.extname(file).toLowerCase();
              let mime = 'image/png';
              if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
              else if (ext === '.webp') mime = 'image/webp';
              else if (ext === '.svg') mime = 'image/svg+xml';
              else if (ext === '.gif') mime = 'image/gif';

              let base64 = null;
              try {
                const buf = fs.readFileSync(fullFilePath);
                base64 = `data:${mime};base64,${buf.toString('base64')}`;
              } catch {}

              db.prepare(`
                UPDATE portfolio_images SET
                  active_src = ?,
                  is_custom = 1,
                  custom_file_name = ?,
                  file_size = ?,
                  storage_path = ?,
                  image_data = ?,
                  mime_type = ?,
                  last_updated = ?
                WHERE id = ?;
              `).run(
                `/uploads/${file}`,
                file,
                stats.size,
                file,
                base64,
                mime,
                stats.mtime.toISOString(),
                matchedSlot.id
              );
              console.log(`[DB Init] Automatically associated existing upload ${file} to slot '${matchedSlot.id}'`);
            }
          }
        }
      }
    }
  } catch (scanErr) {
    console.warn('[DB Init] Uploads directory scan notice:', scanErr.message);
  }
}

// Database Operations

export function getAllSlots() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      id, title, category, project_slug, dimensions, aspect_ratio,
      default_src, active_src, is_custom, description, custom_file_name,
      file_size, storage_path, last_updated
    FROM portfolio_images
    ORDER BY project_slug, id;
  `).all();

  return rows.map((row) => ({
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
}

export function getSlotById(slotId) {
  const db = getDb();
  return db.prepare('SELECT * FROM portfolio_images WHERE id = ?;').get(slotId);
}

export function getSlotByFilename(filename) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM portfolio_images
    WHERE active_src LIKE ? OR storage_path = ? OR custom_file_name = ?
    LIMIT 1;
  `).get(`%${filename}%`, filename, filename);
}

export function saveSlotUpload({
  slotId,
  publicUrl,
  originalName,
  size,
  storagePath,
  base64Data,
  mimeType
}) {
  const db = getDb();
  const now = new Date().toISOString();

  const slotDef = defaultImageSlots.find((s) => s.id === slotId);
  if (!slotDef) {
    throw new Error(`Slot '${slotId}' not recognized`);
  }

  db.prepare(`
    INSERT INTO portfolio_images (
      id, title, category, project_slug, dimensions, aspect_ratio,
      default_src, active_src, is_custom, description,
      custom_file_name, file_size, storage_path, image_data, mime_type,
      last_updated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      active_src = excluded.active_src,
      is_custom = 1,
      custom_file_name = excluded.custom_file_name,
      file_size = excluded.file_size,
      storage_path = excluded.storage_path,
      image_data = excluded.image_data,
      mime_type = excluded.mime_type,
      last_updated = excluded.last_updated;
  `).run(
    slotDef.id,
    slotDef.title,
    slotDef.category,
    slotDef.projectSlug,
    slotDef.dimensions,
    slotDef.aspectRatio,
    slotDef.defaultSrc,
    publicUrl,
    slotDef.description,
    originalName,
    size,
    storagePath,
    base64Data,
    mimeType,
    now,
    now
  );

  return {
    ...slotDef,
    activeSrc: publicUrl,
    isCustom: true,
    lastUpdated: now,
    customFileName: originalName,
    fileSize: size
  };
}

export function resetSlotById(slotId) {
  const db = getDb();
  const slotDef = defaultImageSlots.find((s) => s.id === slotId);
  if (!slotDef) {
    throw new Error(`Slot '${slotId}' not found`);
  }

  const existing = db.prepare('SELECT storage_path, active_src FROM portfolio_images WHERE id = ?;').get(slotId);

  db.prepare(`
    UPDATE portfolio_images SET
      active_src = default_src,
      is_custom = 0,
      custom_file_name = NULL,
      file_size = NULL,
      storage_path = NULL,
      image_data = NULL,
      mime_type = NULL,
      last_updated = ?
    WHERE id = ?;
  `).run(new Date().toISOString(), slotId);

  return {
    ...slotDef,
    activeSrc: slotDef.defaultSrc,
    isCustom: false,
    lastUpdated: null,
    customFileName: null,
    previousStoragePath: existing?.storage_path,
    previousActiveSrc: existing?.active_src
  };
}

export function resetAllSlots() {
  const db = getDb();
  const customRows = db.prepare('SELECT id, storage_path, active_src FROM portfolio_images WHERE is_custom = 1;').all();

  db.prepare(`
    UPDATE portfolio_images SET
      active_src = default_src,
      is_custom = 0,
      custom_file_name = NULL,
      file_size = NULL,
      storage_path = NULL,
      image_data = NULL,
      mime_type = NULL,
      last_updated = ?;
  `).run(new Date().toISOString());

  return customRows;
}

export function authenticateAdminUser(email, password) {
  const db = getDb();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanPass = String(password).trim();
  const passHash = hashPassword(cleanPass);

  const admin = db.prepare('SELECT * FROM admin_users WHERE LOWER(email) = ?;').get(cleanEmail);

  const isHardcoded = cleanEmail === 'shashankms08112000@gmail.com' && cleanPass === 'Shashi@08';
  const isDbMatch = admin && (admin.password_hash === passHash || admin.password_hash === cleanPass);

  if (isDbMatch || isHardcoded) {
    if (admin) {
      db.prepare('UPDATE admin_users SET last_login = ? WHERE id = ?;').run(new Date().toISOString(), admin.id);
    }
    return {
      success: true,
      user: {
        email: cleanEmail,
        role: admin?.role || 'superadmin',
        name: 'Shashank MS'
      }
    };
  }

  return { success: false };
}

export function insertContactMessage({ name, email, message, projectType, budget }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contact_messages (id, name, email, message, project_type, budget, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?);
  `).run(id, name, email, message, projectType || null, budget || null, now);

  return { id, name, email, message, createdAt: now };
}

