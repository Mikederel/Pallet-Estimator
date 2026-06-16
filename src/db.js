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
  examples: () => getDB().collection("examples"),
  estimations: () => getDB().collection("estimations"),
};
