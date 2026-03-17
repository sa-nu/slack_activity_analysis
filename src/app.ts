import "dotenv/config";
import { runDailyAnalysis } from "./cronJob.js";

const result = await runDailyAnalysis();
if (result.success) {
  console.log(
    `完了: メッセージ ${result.messageCount}件, メンバー ${result.memberCount}名を分析してDMを送信しました`,
  );
} else {
  console.error(`失敗: ${result.error}`);
  process.exit(1);
}
