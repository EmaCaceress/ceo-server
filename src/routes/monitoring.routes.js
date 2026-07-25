import { Router } from "express";
import { getSpectrumGraph, getStats, getSuscribers } from "../controllers/monitoring.controller.js";

const router = Router();

router.post("/spectrum", getSpectrumGraph);
router.post("/stats", getStats);
router.post("/suscribers", getSuscribers);

// router.post("/system", getSystemStatus);

export default router;