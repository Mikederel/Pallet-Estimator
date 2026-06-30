import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = process.env.DB_NAME || "pallet-estimator-dev";

let client;
let db;

export async function connectDB() {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`[db] connected to ${uri} / ${dbName}`);
  return db;
}

export function getDB() {
  if (!db) throw new Error("DB not connected — call connectDB() first");
  return db;
}

export const collections = {
  // jobs is the hub: each job is estimated from a BOM (status "open") and later
  // closed with its real pallet results (status "closed" → becomes calibration).
  jobs: () => getDB().collection("jobs"),
  estimations: () => getDB().collection("estimations"),
};
