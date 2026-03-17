import { fetchMemberMessages, sendDm } from "./slackClient.js";
import { analyzeActivities } from "./analyzer.js";
import { formatDmBlocks } from "./formatBlocks.js";

function getTodayJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/**
 * デイリー分析: 過去24時間のアクティビティを取得→分析→DMで送信
 */
export async function runDailyAnalysis(): Promise<{
  success: boolean;
  messageCount: number;
  memberCount: number;
  error?: string;
}> {
  const date = getTodayJST();
  const myUserId = process.env.MY_SLACK_USER_ID;

  if (!myUserId) {
    throw new Error("MY_SLACK_USER_ID が設定されていません");
  }

  console.log(`[${date}] CSチーム業務分析を開始...`);

  try {
    const messages = await fetchMemberMessages(24);
    console.log(`  取得メッセージ数: ${messages.length}`);

    const result = await analyzeActivities(messages, date);
    console.log(`  分析完了 (メンバー数: ${result.memberActivities.length})`);

    const blocks = formatDmBlocks(result, myUserId);
    const fallbackText = `${date} CSチーム業務分析サマリー (${result.memberActivities.length}名)`;

    await sendDm(myUserId, blocks, fallbackText);
    console.log(`  DM送信完了 (宛先: ${myUserId})`);

    return {
      success: true,
      messageCount: messages.length,
      memberCount: result.memberActivities.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  エラー: ${errorMessage}`);
    return { success: false, messageCount: 0, memberCount: 0, error: errorMessage };
  }
}
