import { fileURLToPath } from "url";
import path from "path";

import dotenv from "dotenv";
import mongoose from "mongoose";
import sinon from "sinon";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";

process.env.USE_REDIS_CACHE = "false";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chai.use(chaiAsPromised);

global.expect = chai.expect;

dotenv.config({ path: path.resolve(__dirname, "../.env") });

let mongoServer;

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  const { collections } = mongoose.connection;

  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});
