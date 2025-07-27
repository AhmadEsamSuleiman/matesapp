process.env.USE_REDIS_CACHE = "false";

import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from "dotenv";
import mongoose from "mongoose";
import sinon from "sinon";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiAsPromised);

global.expect = chai.expect;

dotenv.config({ path: path.resolve(__dirname, "../.env") });

let mongoServer;

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const c of Object.values(collections)) {
    await c.deleteMany({});
  }
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});
