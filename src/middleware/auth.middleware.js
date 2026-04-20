import { pool } from "../db.js";

export const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta token (Bearer)" });
  }

  const token = header.replace("Bearer ", "").trim();

  // busca sesión activa por token
  const q = `
    SELECT s.id AS session_id, s.user_id, s.active,
           u.id, u.username, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.active = true
    LIMIT 1
  `;
  const r = await pool.query(q, [token]);

  if (r.rowCount === 0) {
    return res.status(401).json({ error: "Sesión inválida o expirada" });
  }

  // opcional: actualizar last_activity
  await pool.query("UPDATE sessions SET last_activity = NOW() WHERE token = $1", [token]);

  // dejar info lista para la ruta
  req.user = {
    id: r.rows[0].id,
    username: r.rows[0].username,
    role: r.rows[0].role,
  };

  req.session = { id: r.rows[0].session_id, token };

  next();
};
