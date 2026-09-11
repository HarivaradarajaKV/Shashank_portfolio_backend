import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { defaultImageSlots } from './data/imageSlots.js';

dotenv.config();

const { Client } = pg;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hhajohhnsqzpnwsmasoa.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

export function hashPassword(password) {
  const salt = 'shashank_portfolio_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

export function getDbClient() {
  return new Client({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'Shashank#08ms',
    host: process.env.DB_HOST || 'db.hhajohhnsqzpnwsmasoa.supabase.co',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false }
  });
}

export async function initializeDatabase() {
  console.log('[DB Init] Connecting to Supabase PostgreSQL database...');
  
  const client = getDbClient();

  try {
    await client.connect();
    console.log('[DB Init] Connected successfully to PostgreSQL.');

    // 1. Create portfolio_images table
    const createImagesTableQuery = `
      CREATE TABLE IF NOT EXISTS portfolio_images (
        id VARCHAR(120) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(120) NOT NULL,
        project_slug VARCHAR(120) NOT NULL,
        dimensions VARCHAR(80) NOT NULL,
        aspect_ratio VARCHAR(80) NOT NULL,
        default_src TEXT NOT NULL,
        active_src TEXT NOT NULL,
        is_custom BOOLEAN DEFAULT FALSE,
        description TEXT,
        custom_file_name VARCHAR(255),
        file_size BIGINT,
        storage_path TEXT,
        last_updated TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await client.query(createImagesTableQuery);
    console.log('[DB Init] Table "portfolio_images" verified/created.');

    // 2. Create contact_messages table for contact submissions
    const createMessagesTableQuery = `
      CREATE TABLE IF NOT EXISTS contact_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        project_type VARCHAR(120),
        budget VARCHAR(120),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await client.query(createMessagesTableQuery);
    console.log('[DB Init] Table "contact_messages" verified/created.');

    // 3. Create admin_users table
    const createAdminTableQuery = `
      CREATE TABLE IF NOT EXISTS admin_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(80) DEFAULT 'superadmin',
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await client.query(createAdminTableQuery);
    console.log('[DB Init] Table "admin_users" verified/created.');

    // 4. Seed / Update Admin user
    const adminEmail = 'shashankms08112000@gmail.com';
    const adminPassword = 'Shashi@08';
    const passHash = hashPassword(adminPassword);

    const checkAdminQuery = `SELECT id, email FROM admin_users WHERE email = $1;`;
    const adminRes = await client.query(checkAdminQuery, [adminEmail]);

    if (adminRes.rows.length === 0) {
      await client.query(
        `INSERT INTO admin_users (email, password_hash, role) VALUES ($1, $2, 'superadmin');`,
        [adminEmail, passHash]
      );
      console.log(`[DB Init] Admin user "${adminEmail}" created in database.`);
    } else {
      await client.query(
        `UPDATE admin_users SET password_hash = $1 WHERE email = $2;`,
        [passHash, adminEmail]
      );
      console.log(`[DB Init] Admin user "${adminEmail}" password updated in database.`);
    }

    // Also sync admin user in Supabase Auth via Admin API if possible
    try {
      if (SUPABASE_SERVICE_ROLE_KEY) {
        const { data: userList, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (!listErr) {
          const existingAuthUser = userList?.users?.find(u => u.email === adminEmail);
          if (!existingAuthUser) {
            await supabaseAdmin.auth.admin.createUser({
              email: adminEmail,
              password: adminPassword,
              email_confirm: true,
              user_metadata: { role: 'superadmin', name: 'Shashank MS' }
            });
            console.log(`[DB Init] Supabase Auth user created for "${adminEmail}".`);
          } else {
            await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
              password: adminPassword,
              email_confirm: true
            });
            console.log(`[DB Init] Supabase Auth user updated for "${adminEmail}".`);
          }
        }
      }
    } catch (authErr) {
      console.warn('[DB Init] Supabase Auth sync note:', authErr.message);
    }

    // 5. Seed initial image slots if missing
    for (const slot of defaultImageSlots) {
      const checkQuery = `SELECT id FROM portfolio_images WHERE id = $1;`;
      const res = await client.query(checkQuery, [slot.id]);

      if (res.rows.length === 0) {
        const insertQuery = `
          INSERT INTO portfolio_images (
            id, title, category, project_slug, dimensions, aspect_ratio, default_src, active_src, is_custom, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
        `;
        await client.query(insertQuery, [
          slot.id,
          slot.title,
          slot.category,
          slot.projectSlug,
          slot.dimensions,
          slot.aspectRatio,
          slot.defaultSrc,
          slot.defaultSrc,
          false,
          slot.description
        ]);
      }
    }
    console.log(`[DB Init] Initialized/synchronized ${defaultImageSlots.length} image slots.`);

    // 6. Ensure Supabase Storage Bucket exists for images
    try {
      const { data: buckets, error: getBucketsError } = await supabaseAdmin.storage.listBuckets();
      if (!getBucketsError) {
        const bucketExists = buckets?.some(b => b.name === 'portfolio-images');
        if (!bucketExists) {
          const { error: createBucketError } = await supabaseAdmin.storage.createBucket('portfolio-images', {
            public: true,
            fileSizeLimit: 25 * 1024 * 1024 // 25MB
          });
          if (createBucketError) {
            console.warn('[DB Init] Notice on creating storage bucket:', createBucketError.message);
          } else {
            console.log('[DB Init] Public storage bucket "portfolio-images" created successfully.');
          }
        } else {
          console.log('[DB Init] Storage bucket "portfolio-images" already exists.');
        }
      }
    } catch (bucketErr) {
      console.warn('[DB Init] Storage bucket check note:', bucketErr.message);
    }

  } catch (error) {
    console.error('[DB Init] Database initialization error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run standalone if executed directly
if (process.argv[1] && process.argv[1].endsWith('initDb.js')) {
  initializeDatabase()
    .then(() => {
      console.log('[DB Init] Database and Admin account setup completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[DB Init] Fatal setup error:', err);
      process.exit(1);
    });
}
