import { Router } from "express";
import { getSpectrumGraph, getSystemStatus } from "../controllers/monitoring.controller.js";

const router = Router();

router.post("/spectrum", getSpectrumGraph);
// router.post("/system", getSystemStatus);

export default router;