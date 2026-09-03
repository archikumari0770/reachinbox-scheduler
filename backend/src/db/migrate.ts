import fs from "fs";
import path from "path";
import { pool } from "./client";

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  console.log("[migrate] applying schema.sql ...");
  await pool.query(sql);
  console.log("[migrate] done.");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
