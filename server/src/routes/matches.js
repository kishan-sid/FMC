import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    message: "Matches endpoint is ready. Scraping logic to be added.",
    data: [],
  });
});

export default router;
