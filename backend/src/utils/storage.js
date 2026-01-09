const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const db = require('../db');
const axios = require('axios');
const { Transform } = require('stream');
const { child: makeLogger } = require('./logger');
const log = makeLogger('storage');

// B2/S3 Client Configuration will be created lazily

// Check if using custom S3 endpoint (MinIO or other S3-compatible storage)
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === 'true' || Boolean(S3_ENDPOINT);
// S3_PUBLIC_URL is the browser-accessible URL (e.g., http://localhost:9000 for local dev)
// Falls back to S3_ENDPOINT with Docker hostname replacement
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL;

// Function to get storage configuration with validation
function getB2Config() {
  // Support both B2 and generic S3 env vars (S3_* takes precedence for local dev)
  const bucketName = process.env.S3_BUCKET_NAME || process.env.B2_BUCKET_NAME;
  const region = process.env.S3_REGION || process.env.B2_REGION || 'us-east-1';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.B2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.B2_SECRET_ACCESS_KEY;

  // For local development with MinIO, only bucket and credentials are required
  if (S3_ENDPOINT) {
    if (!bucketName || !accessKeyId || !secretAccessKey) {
      console.error('❌ Missing S3/MinIO environment variables:');
      console.error('S3_ACCESS_KEY_ID:', accessKeyId ? '✅ Set' : '❌ Missing');
      console.error('S3_BUCKET_NAME:', bucketName ? '✅ Set' : '❌ Missing');
      console.error('S3_SECRET_ACCESS_KEY:', secretAccessKey ? '✅ Set' : '❌ Missing');
      throw new Error('S3 credentials required for custom endpoint');
    }
  } else {
    // B2 requires all variables
    if (!bucketName || !region || !accessKeyId || !secretAccessKey) {
      console.error('❌ Missing B2 environment variables:');
      console.error('B2_ACCESS_KEY_ID:', accessKeyId ? '✅ Set' : '❌ Missing');
      console.error('B2_BUCKET_NAME:', bucketName ? '✅ Set' : '❌ Missing');
      console.error('B2_REGION:', region ? '✅ Set' : '❌ Missing');
      console.error('B2_SECRET_ACCESS_KEY:', secretAccessKey ? '✅ Set' : '❌ Missing');
      throw new Error('All B2 environment variables are required');
    }
  }

  return { bucketName, region, accessKeyId, secretAccessKey };
}

// Lazy B2 client creation
let b2Client = null;
let BUCKET_NAME = null;

function getB2Client() {
  if (!b2Client) {
    const config = getB2Config();
    BUCKET_NAME = config.bucketName;

    // Build S3 client configuration
    const clientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    };

    // Custom endpoint support (MinIO, LocalStack, etc.)
    if (S3_ENDPOINT) {
      clientConfig.endpoint = S3_ENDPOINT;
      clientConfig.forcePathStyle = S3_FORCE_PATH_STYLE;
      console.log('✅ S3 Configuration loaded (custom endpoint):');
      console.log('  Endpoint:', S3_ENDPOINT);
      console.log('  Bucket:', config.bucketName);
      console.log('  Force Path Style:', S3_FORCE_PATH_STYLE);
    } else {
      // Default B2 endpoint
      clientConfig.endpoint = `https://s3.${config.region}.backblazeb2.com`;
      console.log('✅ B2 Configuration loaded:');
      console.log('  Bucket:', config.bucketName);
      console.log('  Region:', config.region);
    }
    console.log('  Access Key ID: Set');
    console.log('  Secret Access Key: Set');

    b2Client = new S3Client(clientConfig);
  }
  return b2Client;
}

/**
 * Get the public URL for a file in storage
 * Handles both MinIO (custom endpoint) and B2 URLs
 * For local Docker development, uses S3_PUBLIC_URL or converts Docker hostnames to localhost
 */
function getPublicUrl(bucketName, key) {
  if (S3_ENDPOINT) {
    // For MinIO/local: prefer S3_PUBLIC_URL for browser-accessible URLs
    let endpoint;
    if (S3_PUBLIC_URL) {
      endpoint = S3_PUBLIC_URL.replace(/\/$/, '');
    } else {
      // Auto-convert Docker internal hostnames to localhost for browser access
      endpoint = S3_ENDPOINT.replace(/\/$/, '')
        .replace('http://minio:', 'http://localhost:')
        .replace('http://minio/', 'http://localhost/');
    }
    return `${endpoint}/${bucketName}/${key}`;
  }
  // B2 public download endpoint
  return `https://f005.backblazeb2.com/file/${bucketName}/${key}`;
}

// Upload file to B2 with tool-specific folder
async function uploadToB2(fileBuffer, filename, contentType, tool = 'general') {
  try {
    // Get B2 client and bucket name
    const client = getB2Client();
    const bucketName = BUCKET_NAME; // This will be set by getB2Client()
    
    // Determine folder based on tool
    let folder;
    switch (tool) {
      case 'byteplus-seedream':
        folder = process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream';
        break;
      case 'byteplus-seedream-4':
        folder = process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4';
        break;
      case 'google-veo3':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/google-veo3';
        break;
      case 'google-veo31':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/google-veo31';
        break;
      case 'seedance-1-0':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0';
        break;
      case 'sora-2':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/sora-2';
        break;
      case 'sora-ref':
        folder = process.env.B2_IMAGES_FOLDER || 'generated-content/sora-ref';
        break;
      case 'seedance-ref':
        folder = process.env.B2_IMAGES_FOLDER || 'generated-content/seedance-ref';
        break;
      default:
        folder = 'generated-content/general';
    }
    
    const key = `${folder}/${filename}`;
    
    // Use multipart Upload helper for both Buffers and Streams to avoid decoded-content-length issues
    const uploader = new Upload({
      client,
      params: {
        Bucket: bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        ACL: 'public-read',
        Metadata: {
          'uploaded-by': 'cooly-ai',
          'generation-tool': tool,
          'upload-date': new Date().toISOString()
        }
      }
    });
    await uploader.done();

    // Return permanent URL (works for both B2 and MinIO/custom endpoints)
    const permanentUrl = getPublicUrl(bucketName, key);

    console.log(`✅ File uploaded to storage (${tool}): ${permanentUrl}`);
    return permanentUrl;
    
  } catch (error) {
    console.error('❌ Failed to upload to B2:', error);
    throw new Error(`B2 upload failed: ${error.message}`);
  }
}

// Upload image specifically for BytePlus Seedream
async function uploadSeedreamImage(fileBuffer, filename) {
  return uploadToB2(fileBuffer, filename, 'image/png', 'byteplus-seedream');
}

// Upload image specifically for BytePlus Seedream 4.0
async function uploadSeedream4Image(fileBuffer, filename) {
  return uploadToB2(fileBuffer, filename, 'image/png', 'byteplus-seedream-4');
}

// Upload reference image for Seedream 4.0
async function uploadSeedream4RefImage(fileBuffer, filename, mime = 'image/png') {
  return uploadToB2(fileBuffer, filename, mime || 'image/png', 'seedream4-ref');
}

// Upload video specifically for Google Veo 3
async function uploadVeo3Video(fileBuffer, filename) {
  return uploadToB2(fileBuffer, filename, 'video/mp4', 'google-veo3');
}

// Upload video specifically for Seedance 1.0
async function uploadSeedanceVideo(fileBuffer, filename) {
  return uploadToB2(fileBuffer, filename, 'video/mp4', 'seedance-1-0');
}

// Upload reference image for Seedance drag & drop
async function uploadSeedanceRefImage(fileBuffer, filename, mime = 'image/png') {
  return uploadToB2(fileBuffer, filename, mime || 'image/png', 'seedance-ref');
}

// Upload video specifically for Sora 2
async function uploadSoraVideo(fileBuffer, filename) {
  return uploadToB2(fileBuffer, filename, 'video/mp4', 'sora-2');
}

// Delete file from B2
async function deleteFromB2(filename, tool = 'general') {
  try {
    let folder;
    switch (tool) {
      case 'byteplus-seedream':
        folder = process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream';
        break;
      case 'byteplus-seedream-4':
        folder = process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4';
        break;
      case 'google-veo3':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/google-veo3';
        break;
      case 'google-veo31':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/google-veo31';
        break;
      case 'seedance-1-0':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0';
        break;
      case 'sora-2':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/sora-2';
        break;
      default:
        folder = 'generated-content/general';
    }
    
    const key = `${folder}/${filename}`;
    
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    });
    
    const client = getB2Client();
    await client.send(command);
    console.log(`✅ File deleted from B2: ${key}`);
    
  } catch (error) {
    console.error('❌ Failed to delete from B2:', error);
    throw error;
  }
}

// Get file info with tool information
async function getFileInfo(filename, tool = 'general') {
  try {
    let folder;
    switch (tool) {
      case 'byteplus-seedream':
        folder = process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream';
        break;
      case 'byteplus-seedream-4':
        folder = process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4';
        break;
      case 'google-veo3':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/google-veo3';
        break;
      case 'seedance-1-0':
        folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0';
        break;
      default:
        folder = 'generated-content/general';
    }
    
    const key = `${folder}/${filename}`;
    
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    });
    
    const client = getB2Client();
    const response = await client.send(command);
    return {
      size: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
      metadata: response.Metadata,
      tool: tool,
      folder: folder
    };
    
  } catch (error) {
    console.error('❌ Failed to get file info:', error);
    throw error;
  }
}

// Delete all files for a specific user
async function deleteUserFiles(userId) {
  try {
    const client = await db.getClient();
    
    // Get all image files for this user
    const { rows: imageRows } = await client.query(`
      SELECT i.b2_url, i.url 
      FROM images i 
      JOIN generation_sessions gs ON i.session_id = gs.id 
      WHERE gs.user_id = $1
    `, [userId]);

    // Get all video files for this user
    const { rows: videoRows } = await client.query(`
      SELECT v.b2_url, v.url 
      FROM videos v 
      JOIN video_generation_sessions vgs ON v.session_id = vgs.id 
      WHERE vgs.user_id = $1
    `, [userId]);

    const allFiles = [...imageRows, ...videoRows];
    
    if (allFiles.length === 0) {
      console.log(`📁 No files to delete for user ${userId}`);
      return;
    }

    console.log(`🗂️ Deleting ${allFiles.length} files for user ${userId}`);

    // Delete each file from B2
    for (const file of allFiles) {
      try {
        if (file.b2_url) {
          // Extract filename from B2 URL
          const urlParts = file.b2_url.split('/');
          const filename = urlParts[urlParts.length - 1];
          
          // Determine tool type based on URL pattern
          let tool = 'general';
          if (file.b2_url.includes('byteplus-seedream-4')) {
            tool = 'byteplus-seedream-4';
          } else if (file.b2_url.includes('byteplus-seedream')) {
            tool = 'byteplus-seedream';
          } else if (file.b2_url.includes('google-veo3')) {
            tool = 'google-veo3';
          } else if (file.b2_url.includes('seedance-1-0')) {
            tool = 'seedance-1-0';
          } else if (file.b2_url.includes('sora-2')) {
            tool = 'sora-2';
          }
          
          await deleteFromB2(filename, tool);
          console.log(`✅ Deleted B2 file: ${filename}`);
        }
      } catch (fileError) {
        console.error(`⚠️ Failed to delete file ${file.b2_url}:`, fileError);
        // Continue with other files even if one fails
      }
    }

    console.log(`✅ Completed file cleanup for user ${userId}`);
    
  } catch (error) {
    console.error('❌ Failed to cleanup user files:', error);
    throw error;
  }
}

module.exports = {
  uploadSeedreamImage,
  uploadSeedream4Image,
  uploadSeedream4RefImage,
  uploadVeo3Video,
  uploadSeedanceVideo,
  uploadSeedanceRefImage,
  uploadSoraVideo,
  uploadToB2,
  deleteFromB2,
  deleteUserFiles,
  getFileInfo,
  getPublicUrl,
  S3_ENDPOINT
};

/**
 * Stream a remote URL directly into B2, enforcing a maximum byte budget.
 * Returns { url: permanentUrl, bytes: number, filename: string }.
 */
async function streamUrlToB2({ url, filename, contentType, tool = 'general', headers = {}, timeoutMs = 600000, maxBytes }) {
  const MAX = Math.max(1, Number(maxBytes || process.env.MAX_REMOTE_DOWNLOAD_BYTES || 500 * 1024 * 1024)); // default 500MB for videos
  // Build a limiter transform that aborts if exceeded
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > MAX) {
        cb(new Error(`download exceeded limit ${MAX} bytes`));
        return;
      }
      cb(null, chunk);
    }
  });

  const t0 = Date.now();
  try { log.info({ event: 'stream.start', tool, filename, maxBytes: MAX, url }); } catch {}
  const resp = await axios.get(url, { responseType: 'stream', timeout: Number(timeoutMs) || 600000, headers });
  const tHeaders = Date.now();
  const streamBody = resp.data.pipe(limiter);
  const client = getB2Client();
  const bucketName = BUCKET_NAME;

  // Determine folder like uploadToB2
  let folder;
  switch (tool) {
    case 'byteplus-seedream':
      folder = process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream'; break;
    case 'byteplus-seedream-4':
      folder = process.env.B2_IMAGES_FOLDER || 'generated-content/byteplus-seedream-4'; break;
    case 'google-veo3':
      folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/google-veo3'; break;
    case 'google-veo31':
      folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/google-veo31'; break;
    case 'seedance-1-0':
      folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/seedance-1-0'; break;
    case 'sora-2':
      folder = process.env.B2_VIDEOS_FOLDER || 'generated-content/sora-2'; break;
    case 'seedream4-ref':
      folder = process.env.B2_IMAGES_FOLDER || 'generated-content/general'; break;
    default:
      folder = 'generated-content/general';
  }
  const key = `${folder}/${filename}`;
  // Use multipart Upload helper for streamed bodies (avoids undefined decoded-content-length)
  const uploader = new Upload({
    client,
    params: {
      Bucket: bucketName,
      Key: key,
      Body: streamBody,
      ContentType: contentType || 'application/octet-stream',
      ACL: 'public-read',
      Metadata: {
        'uploaded-by': 'cooly-ai',
        'generation-tool': tool,
        'upload-date': new Date().toISOString()
      }
    }
  });
  await uploader.done();
  const tDone = Date.now();
  // Use getPublicUrl helper for both B2 and MinIO support
  const permanentUrl = getPublicUrl(bucketName, key);
  try { log.info({ event: 'stream.done', tool, filename, bytes: received, tHeadersMs: tHeaders - t0, tUploadMs: tDone - tHeaders, totalMs: tDone - t0 }); } catch {}
  return { url: permanentUrl, bytes: received, filename };
}

module.exports.streamUrlToB2 = streamUrlToB2;
