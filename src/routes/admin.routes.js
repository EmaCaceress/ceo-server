import { Router } from "express";
import { getUsers, enabledUsers } from "../controllers/admin.controller.js";

const router = Router();

router.get("/users", getUsers);
router.post("/enabledUsers", enabledUsers);

export default router;