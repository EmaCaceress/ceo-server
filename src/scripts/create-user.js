// src/scripts/create-user.js
import "dotenv/config";
import bcrypt from "bcrypt";
import { pool } from "../db.js";

const [,, username, password, role = "tecnico"] = process.argv;

if (!username || !password) {
  console.log("Uso: node src/scripts/create-user.js <username> <password> [role]");
  process.exit(1);
}

const run = async () => {
  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)",
    [username, hash, role]
  );

  console.log(`✅ Usuario creado: ${username} (role: ${role})`);
  process.exit(0);
};

run().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
