import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { defaultImageSlots } from './data/imageSlots.js';

dotenv.config();

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hhajohhnsqzpnwsmasoa.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET_NAME = 'portfolio-images';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.webp': return 'image/webp';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

async function uploadFileToSupabase(localRelativePath, storagePath) {
  const localFullPath = path.join(publicDir, localRelativePath);
  if (!fs.existsSync(localFullPath)) {
    console.warn(`[Skip] Local file not found: ${localFullPath}`);
    return null;
  }

  const fileBuffer = fs.readFileSync(localFullPath);
  const mimeType = getMimeType(localFullPath);

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) {
    console.error(`[Error uploading ${storagePath}]:`, error.message);
    return null;
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(BUCKET_NAME)
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

export async function syncAllImages() {
  console.log('🚀 Starting bulk upload of all portfolio images to Supabase Storage bucket:', BUCKET_NAME);

  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'Shashank#08ms',
    host: process.env.DB_HOST || 'db.hhajohhnsqzpnwsmasoa.supabase.co',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('✅ Connected to Supabase PostgreSQL database.');

  let uploadedCount = 0;
  let updatedDbCount = 0;

  for (const slot of defaultImageSlots) {
    const cleanSlotId = slot.id.replace(/[^a-zA-Z0-9-_]/g, '_');
    const localRelPath = slot.defaultSrc.startsWith('/') ? slot.defaultSrc.slice(1) : slot.defaultSrc;
    const ext = path.extname(localRelPath) || '.webp';
    const storagePath = `catalog/${slot.projectSlug}/${cleanSlotId}${ext}`;

    process.stdout.write(`Uploading [${slot.id}] -> Supabase Storage... `);
    const publicUrl = await uploadFileToSupabase(localRelPath, storagePath);

    if (publicUrl) {
      uploadedCount++;
      console.log(`✅ OK (${publicUrl.split('/').pop()})`);

      // Update in PostgreSQL portfolio_images table if currently default
      try {
        const checkQuery = `SELECT is_custom FROM portfolio_images WHERE id = $1;`;
        const res = await client.query(checkQuery, [slot.id]);
        const isCustom = res.rows[0]?.is_custom;

        if (!isCustom) {
          await client.query(
            `UPDATE portfolio_images 
             SET default_src = $1, active_src = $1, storage_path = $2, last_updated = NOW() 
             WHERE id = $3;`,
            [publicUrl, storagePath, slot.id]
          );
        } else {
          await client.query(
            `UPDATE portfolio_images 
             SET default_src = $1 
             WHERE id = $2;`,
            [publicUrl, slot.id]
          );
        }
        updatedDbCount++;
      } catch (dbErr) {
        console.warn(`[DB update note for ${slot.id}]:`, dbErr.message);
      }
    } else {
      console.log(`❌ Failed or Skipped`);
    }
  }

  console.log(`\n🎉 Summary:`);
  console.log(`- Uploaded to Supabase Bucket: ${uploadedCount}/${defaultImageSlots.length} images`);
  console.log(`- Updated in Supabase PostgreSQL: ${updatedDbCount} records`);
  
  await client.end();
}

syncAllImages()
  .then(() => {
    console.log('🏁 All portfolio images are now loaded into Supabase Storage & Database!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal sync error:', err);
    process.exit(1);
  });
