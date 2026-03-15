'use strict';

const mongoose              = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectTestDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  mongoServer = await MongoMemoryServer.create({
    instance: { port: Math.floor(Math.random() * (65535 - 27017) + 27017) },
  });
  await mongoose.connect(mongoServer.getUri());
};

const clearTestDB = async () => {
  if (mongoose.connection.readyState !== 1) return;
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
};

const closeTestDB = async () => {
  try { await mongoose.connection.dropDatabase(); } catch {}
  try { await mongoose.connection.close(); } catch {}
  try { if (mongoServer) await mongoServer.stop(); } catch {}
  mongoServer = null;
};

module.exports = { connectTestDB, clearTestDB, closeTestDB };