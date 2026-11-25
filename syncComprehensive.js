import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defaultImageSlots } from './data/imageSlots.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const SUPABASE_URL = 'https://hhajohhnsqzpnwsmasoa.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoYWpvaGhuc3F6cG53c21hc29hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTExNzQxNywiZXhwIjoyMTA0NjkzNDE3fQ.cbtxhuzYc9f5yYXNYsGNniTToGHer1QH1Wk8tNoGJvg';
const BUCKET_NAME = 'portfolio-images';

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

async function uploadLocalFile(localRelPath, storagePath) {
  if (!localRelPath) return null;
  const cleanRel = localRelPath.startsWith('/') ? localRelPath.slice(1) : localRelPath;
  const localFullPath = path.join(publicDir, cleanRel);
  if (!fs.existsSync(localFullPath)) {
    return null;
  }
  const stat = fs.statSync(localFullPath);
  if (!stat.isFile()) {
    return null;
  }
  const fileBuffer = fs.readFileSync(localFullPath);
  const mimeType = getMimeType(localFullPath);

  const { error } = await supa.storage.from(BUCKET_NAME).upload(storagePath, fileBuffer, {
    contentType: mimeType,
    upsert: true
  });
  if (error) {
    console.error(`Upload error for ${storagePath}:`, error.message);
    return null;
  }
  const { data } = supa.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  return data?.publicUrl || null;
}

async function run() {
  console.log('--- Step 1: Listing all uploaded files in Supabase Storage uploads/ ---');
  const { data: objects, error: listErr } = await supa.storage
    .from(BUCKET_NAME)
    .list('uploads', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });

  if (listErr) {
    console.error('Failed to list uploads:', listErr);
    process.exit(1);
  }

  // Find newest file for each slot
  const customUploads = new Map();
  for (const obj of objects) {
    const match = obj.name.match(/^([a-zA-Z0-9-]+)_(\d+)\.[a-zA-Z0-9]+$/);
    if (match) {
      const slotId = match[1];
      const timestamp = parseInt(match[2], 10);
      if (!customUploads.has(slotId) || customUploads.get(slotId).timestamp < timestamp) {
        customUploads.set(slotId, {
          fileName: obj.name,
          timestamp,
          fileSize: obj.metadata?.size || null
        });
      }
    }
  }

  console.log(`Found ${customUploads.size} unique slot uploads in Supabase Storage.`);

  console.log('\n--- Step 2: Synchronizing all slots into portfolio_images table ---');
  let customCount = 0;
  let catalogCount = 0;

  for (const slot of defaultImageSlots) {
    const hasCustom = customUploads.has(slot.id);
    let finalActiveSrc = '';
    let storagePath = null;
    let isCustom = false;
    let customFileName = null;
    let fileSize = null;

    if (hasCustom) {
      const customInfo = customUploads.get(slot.id);
      storagePath = `uploads/${customInfo.fileName}`;
      finalActiveSrc = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}`;
      isCustom = true;
      customFileName = customInfo.fileName;
      fileSize = customInfo.fileSize;
      customCount++;
    } else {
      // Default asset: upload to catalog if local path
      const cleanSlotId = slot.id.replace(/[^a-zA-Z0-9-_]/g, '_');
      const localRelPath = slot.defaultSrc.startsWith('/') ? slot.defaultSrc.slice(1) : slot.defaultSrc;
      const ext = path.extname(localRelPath) || '.webp';
      const catalogPath = `catalog/${slot.projectSlug || 'general'}/${cleanSlotId}${ext}`;

      if (slot.defaultSrc.startsWith('http')) {
        finalActiveSrc = slot.defaultSrc;
      } else {
        const publicUrl = await uploadLocalFile(localRelPath, catalogPath);
        finalActiveSrc = publicUrl || slot.defaultSrc;
        storagePath = catalogPath;
      }
      catalogCount++;
    }

    const row = {
      id: slot.id,
      title: slot.title || slot.id,
      category: slot.category || 'General',
      project_slug: slot.projectSlug || '',
      dimensions: slot.dimensions || '',
      aspect_ratio: slot.aspectRatio || '',
      default_src: slot.defaultSrc.startsWith('http') ? slot.defaultSrc : finalActiveSrc,
      active_src: finalActiveSrc,
      is_custom: isCustom,
      description: slot.description || '',
      custom_file_name: customFileName,
      file_size: fileSize,
      storage_path: storagePath,
      last_updated: new Date().toISOString()
    };

    const { error: upsertErr } = await supa.from('portfolio_images').upsert(row, { onConflict: 'id' });
    if (upsertErr) {
      console.error(`Failed to upsert ${slot.id}:`, upsertErr.message);
    } else {
      console.log(`[Synced] ${slot.id} -> ${isCustom ? 'CUSTOM (' + storagePath + ')' : 'DEFAULT'}`);
    }
  }

  // Handle any slots in customUploads that might not be in defaultImageSlots
  for (const [slotId, customInfo] of customUploads.entries()) {
    const inDefaults = defaultImageSlots.some(s => s.id === slotId);
    if (!inDefaults) {
      const storagePath = `uploads/${customInfo.fileName}`;
      const finalActiveSrc = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}`;
      const row = {
        id: slotId,
        title: slotId,
        category: 'Custom Uploads',
        project_slug: '',
        dimensions: '',
        aspect_ratio: '',
        default_src: finalActiveSrc,
        active_src: finalActiveSrc,
        is_custom: true,
        description: 'Uploaded from Admin Dashboard',
        custom_file_name: customInfo.fileName,
        file_size: customInfo.fileSize,
        storage_path: storagePath,
        last_updated: new Date().toISOString()
      };
      const { error: extraErr } = await supa.from('portfolio_images').upsert(row, { onConflict: 'id' });
      if (extraErr) {
        console.error(`Failed to upsert extra custom ${slotId}:`, extraErr.message);
      } else {
        console.log(`[Extra Synced] ${slotId} -> CUSTOM (${storagePath})`);
        customCount++;
      }
    }
  }

  console.log(`\n🎉 Finished Sync:`);
  console.log(`- Custom uploaded slots registered in DB: ${customCount}`);
  console.log(`- Default/catalog slots registered in DB: ${catalogCount}`);
}

run().catch(console.error);
