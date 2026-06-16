// PM2 — DEV (port 3005).  Start with:  pm2 start ecosystem.dev.config.cjs
// ANTHROPIC_API_KEY and MONGODB_URI come from the gitignored .env file (loaded by dotenv).
module.exports = {
  apps: [
    {
      name: "pallet-estimator-dev",
      script: "src/server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
        PORT: 3005,
        DB_NAME: "pallet-estimator-dev",
      },
    },
  ],
};
