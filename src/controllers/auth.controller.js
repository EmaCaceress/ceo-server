import bcrypt from "bcrypt";
import crypto from "crypto";
import { pool } from "../db.js";

const generateToken = () => crypto.randomBytes(48).toString("hex");

export const login = async (req, res) => {
  const { username, password } = req.body ?? {};

  
  if (!username || !password) {
    return res.status(400).json({ error: "Falta username o password" });
  }
  console.log("Intento de login:", username);
  try {
    // 1) buscar usuario
    const userRes = await pool.query(
      "SELECT id, username, password_hash, role FROM users WHERE username = $1",
      [username]
    );

    if (userRes.rowCount === 0) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const user = userRes.rows[0];

    // 2) comparar password con el hash guardado
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // 3) crear sesión única: desactivar la anterior + crear nueva
    const token = generateToken();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // desactiva la sesión activa anterior de ese usuario
      await client.query(
        "UPDATE sessions SET active = false WHERE user_id = $1 AND active = true",
        [user.id]
      );

      // crea nueva sesión
      await client.query(
        "INSERT INTO sessions (user_id, token, active) VALUES ($1, $2, true)",
        [user.id, token]
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Error creando sesión" });
    } finally {
      client.release();
    }

    // 4) devolver token + datos básicos
    return res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
