import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = Router();

// si llegaste acá, el token era válido
router.get("/", authMiddleware, (req, res) => {
  res.json({
    ok: true,
    message: "Entraste a una ruta protegida",
    user: req.user,
    session: req.session,
  });
});

export default router;
