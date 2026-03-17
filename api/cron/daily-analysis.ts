import "dotenv/config";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runDailyAnalysis } from "../../src/cronJob.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await runDailyAnalysis();

    if (result.success) {
      res.status(200).json({
        ok: true,
        messageCount: result.messageCount,
        memberCount: result.memberCount,
      });
    } else {
      res.status(500).json({
        ok: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Daily analysis cron handler error:", error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
