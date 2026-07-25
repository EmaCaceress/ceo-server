import { pool } from "../db.js";
import { z } from "zod";

export const getSpectrumGraph = async (req, res) => {
//Validamos datos
    const schema = z.object({
        nodo: z.string(),
        frecuency: z.string().optional(),
        username: z.string()
        });
    
    const result = schema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            ok: false,
            message: "Invalid request data",
            errors: result.error
        });
    }
    
    const { nodo, frecuency, username } = result.data;

    const token = req.headers.authorization?.split(" ")[1];
    try{
        
        // Busca usuario admin_id a partir del token
        const user = (await pool.query(
            "SELECT s.user_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE token = $1",
            [token])).rows[0] || null;
    
        if (user.user_id === 0) {
            return res.status(404).json({ error: "No se encontraron usuarios" });
        }
        function isNumber(num) {
            return /^[0-9]+$/.test(num);
        }
        
        //tunel
        const getBaseUrl = async () => {
            let result;
            
            if (user.role == "admin") {
                result = await pool.query(`
                    SELECT secret_key
                    FROM keys
                    WHERE admin_id = $1
                  `, [user.user_id]);
            } else {
                result = await pool.query(`
                    SELECT k.secret_key
                    FROM access a
                    JOIN keys k
                      ON a.key_id = k.id
                    WHERE a.technician_id = $1
                  `, [user.user_id]);
            }
              
              const code = result.rows[0]?.secret_key
            return `https://${code}.trycloudflare.com`;
        };
        
        const getSpectreUrl = async (identity) => {
            let url, link;
            if(isNumber(identity)) {   
                link = `https://192.168.230.131/pathtrak/live/index.html#/app/heatmap?cmts_us_port=`;
                url = link + identity;
                
                return [url, "rphy"];
            } else{
                const identityBd = await pool.query("SELECT id, tipo FROM nodos WHERE nodo = $1", [nodo.toUpperCase()]);
                if (identityBd.rows.length === 0) {
                    const error = new Error("Nodo no encontrado");
                    error.status = 404;
                    throw error;
                }
                link = identityBd.rows[0].tipo === "legacy"
                ? `https://192.168.230.131/pathtrak/live/index.html#/app/spectrum?hcu=`
                :  `https://192.168.230.131/pathtrak/live/index.html#/app/heatmap?cmts_us_port=`;
                url = link + identityBd.rows[0].id;
                return [url, identityBd.rows[0].tipo];
            }
            
        }
        
        //Refrescar imagen
        await fetch(`${(await getBaseUrl())}/refrescar`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              URL: (await getSpectreUrl(nodo))[0],
              nodoType: ((await getSpectreUrl(nodo))[1]).toUpperCase(),
              frecuencia: frecuency || "0",
              username
            })
        });
        
        
        //Devolvemos imagen
        const resolve = await fetch(`${(await getBaseUrl())}/grafica/${username}`);

        if (!resolve.ok) {
            const error = new Error("Servicio de gráficos no disponible");
            error.status = 500;
            throw error;
        }
        console.log("URL de la gráfica:", resolve.url);
        return res.json({url: resolve.url});
    } catch(error) {
        res.status(error.status || 500).json({
            ok: false,
            message: "connection failed",
            error: error.message
        });
    }
};

export const getStats = async (req, res) => {
    const { nodo } = req.body;
    const token = req.headers.authorization?.split(" ")[1];
    try{
        
        // Busca usuario admin_id a partir del token
        const user = (await pool.query(
            "SELECT s.user_id, u.username, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE token = $1",
            [token])).rows[0] || null;
    
        if (user.user_id === 0) {
            return res.status(404).json({ error: "No se encontraron usuarios" });
        }
        
        const username = user.username || 'usuario desconocido';

        //tunel
        const getBaseUrl = async () => {
            let result;
            
            if (user.role == "admin") {
                result = await pool.query(`
                    SELECT secret_key
                    FROM keys
                    WHERE admin_id = $1
                  `, [user.user_id]);
            } else {
                result = await pool.query(`
                    SELECT k.secret_key
                    FROM access a
                    JOIN keys k
                      ON a.key_id = k.id
                    WHERE a.technician_id = $1
                  `, [user.user_id]);
            }
              
              const code = result.rows[0]?.secret_key
            return `https://${code}.trycloudflare.com`;
        };
        console.log("Nodo recibido:", nodo);
        //Refrescar estadísticas
        const response = await fetch(`${(await getBaseUrl())}/estadisticas`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                nodo,
                username,
            })
        });
        
        const data = await response.json();

        console.log("Estadísticas obtenidas:", data);
        res.json(data);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Failed to get system status",
            error: error.message
        });
    }
}

export const getSuscribers = async (req, res) => {
    const { nodo } = req.body;
    const token = req.headers.authorization?.split(" ")[1];
    try{
        
        // Busca usuario admin_id a partir del token
        const user = (await pool.query(
            "SELECT s.user_id, u.username, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE token = $1",
            [token])).rows[0] || null;
    
        if (user.user_id === 0) {
            return res.status(404).json({ error: "No se encontraron usuarios" });
        }
        
        const username = user.username || 'usuario desconocido';
        
        //tunel
        const getBaseUrl = async () => {
            let result;
            
            if (user.role == "admin") {
                result = await pool.query(`
                    SELECT secret_key
                    FROM keys
                    WHERE admin_id = $1
                  `, [user.user_id]);
            } else {
                result = await pool.query(`
                    SELECT k.secret_key
                    FROM access a
                    JOIN keys k
                      ON a.key_id = k.id
                    WHERE a.technician_id = $1
                  `, [user.user_id]);
            }
              
              const code = result.rows[0]?.secret_key
            return `https://${code}.trycloudflare.com`;
        };

        const response = await fetch(`${(await getBaseUrl())}/abonados/nodo`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                nodo,
                username
            })
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Failed to get system status",
            error: error.message
        });
    }
}