'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const seedAdmin = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const User = require('../src/modules/auth/models/User.model');

  const existing = await User.findOne({ email: 'admin@collectly.dev' });

  if (existing) {
    if (existing.role !== 'admin') {
      await User.updateOne(
        { email: 'admin@collectly.dev' },
        { $set: { role: 'admin' } }
      );
      console.log('Existing user promoted to admin');
    } else {
      console.log('Admin already exists — skipping');
    }
    await mongoose.disconnect();
    return;
  }

  await User.create({
    name:             'Platform Admin',
    email:            'admin@collectly.dev',
    password:         await bcrypt.hash('Admin@Collectly123', 12),
    role:             'admin',
    subscriptionPlan: 'enterprise',
    oauthProvider:    'local',
    isEmailVerified:  true,
    isActive:         true,
  });

  console.log('Admin user created successfully');
  console.log('Email:    admin@collectly.dev');
  console.log('Password: Admin@Collectly123');
  console.log('IMPORTANT: Change this password immediately after first login');

  await mongoose.disconnect();
};

seedAdmin().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});