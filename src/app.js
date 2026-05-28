import "dotenv/config";
import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import authRoutes from "./routes/auth.routes.js";
import protectedRoutes from "./routes/protected.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import monitoringRoutes from "./routes/monitoring.routes.js";
import { authMiddleware } from "./middleware/auth.middleware.js";

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));
app.use(express.json());

// Rutas
app.use("/auth", authRoutes);
app.use("/protected", protectedRoutes);
app.use("/admin", authMiddleware, adminRoutes);
app.use("/monitoring", authMiddleware, monitoringRoutes);
app.get("/health", async (req, res) => {
    try{
        await pool.query("SELECT 1");
        res.json({ 
            ok: true,
            db: "up"
        })
    }
    catch(error){
        res.status(500).json({      
            ok: false,
            db: "down",
            error: error.message,})
    }
});

// app.post("/refresh", authMiddleware, async (req, res) => {
    
//     //Validamos datos
//     const schema = z.object({
//         nodo: z.string(),
//         frecuency: z.string().optional(),
//         username: z.string()
//         });
    
//     const result = schema.safeParse(req.body);

//     if (!result.success) {
//         return res.status(400).json({
//             ok: false,
//             message: "Invalid request data",
//             errors: result.error
//         });
//     }   
    
//     const { nodo, frecuency, username } = result.data;

    
//     try{
//         function isNumber(num) {
//             return /^[0-9]+$/.test(num);
//           }
//         //tunel
//         const getBaseUrl = () => {
//             const code = "classified-syndrome-talking-parade";
//             return `https://${code}.trycloudflare.com`;
//         };
        
//         const getSpectreUrl = async (identity) => {
//             let url = "";
//             if(isNumber(identity)) {   
//                 url = link + identity;
//                 return url;
//             } else{
//                 const identityBd = await pool.query("SELECT id, tipo FROM nodos WHERE nodo = $1", [nodo.toUpperCase()]);
//                 if (identityBd.rows.length === 0) {
//                     const error = new Error("Nodo no encontrado");
//                     error.status = 404;
//                     throw error;
//                 }
//                 const link = identityBd.rows[0].tipo === "legacy" 
//                 ? `https://192.168.230.131/pathtrak/live/index.html#/app/spectrum?hcu=`
//                 :  `https://192.168.230.131/pathtrak/live/index.html#/app/heatmap?cmts_us_port=`;
//                 url = link + identityBd.rows[0].id;
//                 return [url, identityBd.rows[0].tipo];
//             }
//         }
        
//         //Refrescar imagen
//         await fetch(`${getBaseUrl()}/refrescar`, {
//             method: "POST",
//             headers: {
//               "Content-Type": "application/json"
//             },
//             body: JSON.stringify({
//               URL: (await getSpectreUrl(nodo))[0],
//               nodoType: ((await getSpectreUrl(nodo))[1]).toUpperCase(),
//               frecuencia: frecuency || "0",
//               username
//             })
//         });
//         console.log("hola")
//         //Devolvemos imagen
//         const resolve = await fetch(`${getBaseUrl()}/grafica/${username}`);
        
//         if (!resolve.ok) {
//             const error = new Error("Servicio de gráficos no disponible");
//             error.status = 500;
//             throw error;
//         }

//         console.log("Fetch status:", resolve.url);
//         return res.json({url: resolve.url});
//     } catch(error) {
//         res.status(error.status || 500).json({
//             ok: false,
//             message: "connection failed",
//             error: error.message
//         });
//     }
// });

export default app;