'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const ADMIN_EMAIL    = process.env.SEED_ADMIN_EMAIL    || 'admin@collectly.dev';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ADMIN_NAME     = process.env.SEED_ADMIN_NAME     || 'Platform Admin';

const seedAdmin = async () => {
  if (!ADMIN_PASSWORD) {
    console.error('ERROR: SEED_ADMIN_PASSWORD environment variable is required.');
    console.error('Usage: SEED_ADMIN_PASSWORD=yourpassword node scripts/seed-admin.js');
    process.exit(1);
  }
  if (ADMIN_PASSWORD.length < 12) {
    console.error('ERROR: SEED_ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');
  const User = require('../src/modules/auth/models/User.model');
  const existing = await User.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    if (existing.role !== 'admin') {
      await User.updateOne({ email: ADMIN_EMAIL }, { $set: { role: 'admin' } });
      console.log('Existing user promoted to admin');
    } else {
      console.log('Admin already exists — skipping');
    }
    await mongoose.disconnect();
    return;
  }
  await User.create({
    name:             ADMIN_NAME,
    email:            ADMIN_EMAIL,
    password:         await bcrypt.hash(ADMIN_PASSWORD, 12),
    role:             'admin',
    subscriptionPlan: 'enterprise',
    oauthProvider:    'local',
    isEmailVerified:  true,
    isActive:         true,
  });
  console.log('Admin created successfully');
  console.log(`Email: ${ADMIN_EMAIL}`);
  await mongoose.disconnect();
};

seedAdmin().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});