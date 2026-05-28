import { pool } from "../db.js";

export const getUsers = async (req, res) => {
  try {
    // 1) buscar usuario
    const usersRes = await pool.query(
      "SELECT * FROM users WHERE role = 'tecnico'"
    );

    if (usersRes.rowCount === 0) {
      return res.status(404).json({ error: "No se encontraron usuarios" });
    }

    const enabledUsersRes = await pool.query(
      "SELECT * FROM access"
    );

    // for (let i=0; i < usersRes.rows.length; i++) {
    //   const user = usersRes.rows[i];
    //   const access = enabledUsersRes.rows.find(a => a.technician_id === user.id);
    //   usersRes.rows[i].enabled = !!access;
    // }

    return res.json({
        users: usersRes.rows.map((u, index) => ({
            id: u.id,
            username: u.username,
            role: u.role,
            enabled: enabledUsersRes.rows.some(a => a.technician_id === u.id)
        }))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const enabledUsers = async (req, res) => {

  const { key, enabledUsers } = req.body;
  const token = req.headers.authorization?.split(" ")[1];
  let key_id;
  try {
    if(!key || !token || !Array.isArray(enabledUsers)) {
      return res.status(400).json({ error: "Faltan datos requeridos o formato incorrecto" });
    }
    // Busca usuario admin_id a partir del token
    const admin_id = (await pool.query(
      "SELECT user_id FROM sessions WHERE token = $1",
      [token])).rows[0]?.user_id || 0;

    if (admin_id === 0) {
      return res.status(404).json({ error: "No se encontraron usuarios" });
    }
   
   // Busca usuario repetido en la tabla keys
    const repId = await pool.query(
      "SELECT id FROM keys WHERE admin_id = $1",
      [admin_id]
    );

    await pool.query(
      `
      DELETE FROM access
      WHERE NOT (technician_id = ANY($1::int[]))
      `,
      [enabledUsers]
    );

    if (repId.rowCount > 0) {
      key_id = (await pool.query(
        "UPDATE keys SET secret_key = $1 WHERE admin_id = $2 RETURNING id",
        [key,admin_id])).rows[0].id;
    } else {
      // Agregar clave a la tabla keys
      key_id = (await pool.query(
        "INSERT INTO keys (secret_key, admin_id) VALUES ($1, $2) RETURNING id",
        [key, admin_id])).rows[0].id;
    }

    //----------------------------------
    // Habilitar o deshabilitar usuarios
    //----------------------------------

    if (enabledUsers) {
      for (const id of enabledUsers) {
        try {
          await pool.query(
            `
            INSERT INTO access (technician_id, key_id)
            VALUES ($1, $2)
            ON CONFLICT (technician_id)
            DO UPDATE SET key_id = $2
            `,
            [id, key_id]
          );
        } catch (err) {
          console.error("Error insertando id:", id, "→", err.message);
        }
      }
    }

    return res.status(200).json({ message: "Clave agregada exitosamente"});
  } catch (err) {
    
    return res.status(500).json({ error: err.message });
  }
};