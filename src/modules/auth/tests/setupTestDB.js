'use strict';

const mongoose            = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

/**
 * Start in-memory MongoDB instance and connect Mongoose.
 * Called once before all tests in a suite.
 */
const connectTestDB = async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri   = mongoServer.getUri();
  await mongoose.connect(uri);
};

/**
 * Drop all collections between tests for isolation.
 * Called before/after each test or describe block.
 */
const clearTestDB = async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((col) => col.deleteMany({}))
  );
};

/**
 * Disconnect Mongoose and stop the in-memory server.
 * Called once after all tests in a suite.
 */
const closeTestDB = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongoServer) await mongoServer.stop();
};

module.exports = { connectTestDB, clearTestDB, closeTestDB };