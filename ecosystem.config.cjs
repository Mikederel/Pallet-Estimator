// PM2 — PRODUCTION (port 3004).  Start with:  pm2 start ecosystem.config.cjs
// ANTHROPIC_API_KEY and MONGODB_URI come from the gitignored .env file (loaded by dotenv).
module.exports = {
  apps: [
    {
      name: "pallet-estimator",
      script: "src/server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: 3004,
        DB_NAME: "pallet-estimator",
      },
    },
  ],
};
