const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool(config.postgres);

pool.on("connect", () => {
  console.log("[PostgreSQL] Connected successfully to database:", config.postgres.database);
});

pool.on("error", (err) => {
  console.error("[PostgreSQL] Unexpected error on idle client:", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
