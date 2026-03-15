'use strict';

const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer   = require('multer');
const multerS3 = require('multer-s3');
const path     = require('path');
const AppError = require('../errors/AppError');
const logger   = require('./logger');

// ── S3 availability guard ─────────────────────────────────────────────────────

const isS3Enabled = () =>
  !!(process.env.AWS_ACCESS_KEY_ID &&
     process.env.AWS_SECRET_ACCESS_KEY &&
     process.env.AWS_S3_BUCKET &&
     !process.env.AWS_ACCESS_KEY_ID.includes('your_'));

// ── Lazy S3 client ────────────────────────────────────────────────────────────

let _s3Client = null;

const getS3Client = () => {
  if (_s3Client) return _s3Client;
  if (!isS3Enabled()) return null;
  _s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return _s3Client;
};

// ── File filter — PDF only ────────────────────────────────────────────────────

const pdfFileFilter = (req, file, cb) => {
  const ext      = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  if (mimeType === 'application/pdf' && ext === '.pdf') {
    return cb(null, true);
  }
  cb(new AppError('Only PDF files are allowed.', 400, 'INVALID_FILE_TYPE'));
};

// ── Build S3 object key ───────────────────────────────────────────────────────

const buildS3Key = (req, file) => {
  const userId    = req.user?.id    || 'unknown';
  const invoiceId = req.params?.id  || 'unknown';
  const timestamp = Date.now();
  const safeName  = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `attachments/${userId}/${invoiceId}/${timestamp}-${safeName}`;
};

// ── Create upload middleware ───────────────────────────────────────────────────

const createUploadMiddleware = () => {
  const s3 = getS3Client();

  if (!s3) {
    // Memory storage fallback for test/dev without S3 credentials
    logger.warn('S3 not configured — using memory storage fallback');
    return multer({
      storage: multer.memoryStorage(),
      limits:  { fileSize: 10 * 1024 * 1024 },
      fileFilter: pdfFileFilter,
    });
  }

  return multer({
    storage: multerS3({
      s3,
      bucket:      process.env.AWS_S3_BUCKET,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => cb(null, buildS3Key(req, file)),
      metadata: (req, file, cb) => {
        cb(null, {
          userId:    req.user?.id || 'unknown',
          uploadedAt: new Date().toISOString(),
        });
      },
    }),
    limits:     { fileSize: 10 * 1024 * 1024 },
    fileFilter: pdfFileFilter,
  });
};

// ── Delete object from S3 ─────────────────────────────────────────────────────

const deleteFromS3 = async (key) => {
  const s3 = getS3Client();
  if (!s3 || !key) return;

  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key:    key,
    }));
    logger.info(`S3 object deleted: ${key}`);
  } catch (err) {
    logger.error(`S3 delete failed for key ${key}: ${err.message}`);
  }
};

// ── Generate pre-signed download URL (expires 1 hour) ────────────────────────

const getSignedDownloadUrl = async (key, expiresIn = 3600) => {
  const s3 = getS3Client();
  if (!s3 || !key) return null;

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key:    key,
    });
    return await getSignedUrl(s3, command, { expiresIn });
  } catch (err) {
    logger.error(`S3 signed URL generation failed: ${err.message}`);
    return null;
  }
};

module.exports = {
  isS3Enabled,
  getS3Client,
  createUploadMiddleware,
  deleteFromS3,
  getSignedDownloadUrl,
};