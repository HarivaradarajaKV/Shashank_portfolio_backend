import pg from 'pg';
import dotenv from 'dotenv';
import { getDb, hashPassword } from './db.js';
import { defaultImageSlots } from './data/imageSlots.js';

dotenv.config();

const { Client } = pg;

export async function initializeDatabase() {
  console.log('[DB Init] Initializing Local SQLite Database...');
  const db = getDb();
  console.log('[DB Init] SQLite tables and slots initialized successfully.');

  // Check remote PostgreSQL connection
  console.log('[DB Init] Checking remote PostgreSQL / Supabase connection...');
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'Shashank#08ms',
    host: process.env.DB_HOST || 'db.hhajohhnsqzpnwsmasoa.supabase.co',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 3000
  });

  try {
    await client.connect();
    console.log('[DB Init] Connected successfully to remote PostgreSQL.');

    await client.query(`
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
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        project_type VARCHAR(120),
        budget VARCHAR(120),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(80) DEFAULT 'superadmin',
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const adminEmail = 'shashankms08112000@gmail.com';
    const passHash = hashPassword('Shashi@08');
    await client.query(`
      INSERT INTO admin_users (email, password_hash, role)
      VALUES ($1, $2, 'superadmin')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
    `, [adminEmail, passHash]);

    for (const slot of defaultImageSlots) {
      await client.query(`
        INSERT INTO portfolio_images (
          id, title, category, project_slug, dimensions, aspect_ratio, default_src, active_src, is_custom, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9)
        ON CONFLICT (id) DO NOTHING;
      `, [slot.id, slot.title, slot.category, slot.projectSlug, slot.dimensions, slot.aspectRatio, slot.defaultSrc, slot.defaultSrc, slot.description]);
    }

    console.log('[DB Init] Remote PostgreSQL synced successfully!');
    await client.end();
  } catch (err) {
    console.log('[DB Init] Remote PostgreSQL connection standby (will sync when database is unpaused):', err.message);
  }

  console.log('[DB Init] Database initialization complete.');
}

initializeDatabase().catch((e) => console.error(e));
