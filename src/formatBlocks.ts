import type { KnownBlock } from "@slack/web-api";
import type { AnalysisResult, MemberActivity, TaskCategory } from "./types.js";

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `約${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `約${h}時間${m}分` : `約${h}時間`;
}

function categoryBar(minutes: number, total: number): string {
  if (total === 0) return "";
  const pct = Math.round((minutes / total) * 100);
  return `${pct}%`;
}

function formatMemberSection(member: MemberActivity): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  const totalLabel = formatMinutes(member.totalEstimatedMinutes);
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${member.userName}*　メッセージ数: ${member.totalMessages}件　推定工数: *${totalLabel}*`,
    },
  });

  if (member.categories.length > 0) {
    const categoryLines = member.categories
      .filter((c) => c.messageCount > 0)
      .sort((a, b) => b.estimatedMinutes - a.estimatedMinutes)
      .map((c: TaskCategory) => {
        const bar = categoryBar(c.estimatedMinutes, member.totalEstimatedMinutes);
        const exampleText =
          c.examples.length > 0
            ? `\n　　　_例: ${c.examples[0].substring(0, 50)}_`
            : "";
        return `　• ${c.name}: ${c.messageCount}件 / ${formatMinutes(c.estimatedMinutes)} (${bar})${exampleText}`;
      })
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: categoryLines,
      },
    });
  }

  return blocks;
}

/**
 * 分析結果を Block Kit 形式の DM メッセージにフォーマットする。
 */
export function formatDmBlocks(
  result: AnalysisResult,
  myUserId: string,
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // ヘッダー
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `📊 CSチーム 業務分析サマリー (${result.date})`,
      emoji: true,
    },
  });

  // メンション付き冒頭
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `<@${myUserId}> 本日のカスタマーサポートチームの業務分析レポートをお届けします。`,
    },
  });

  blocks.push({ type: "divider" });

  // 全体所見
  if (result.overallInsight) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📝 全体所見*\n${result.overallInsight}`,
      },
    });
    blocks.push({ type: "divider" });
  }

  // メンバーごとのセクション
  if (result.memberActivities.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "本日は対象チャンネルにメッセージがありませんでした。",
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*👥 メンバー別アクティビティ*（${result.memberActivities.length}名）`,
      },
    });

    for (const member of result.memberActivities) {
      blocks.push(...formatMemberSection(member));
      blocks.push({ type: "divider" });
    }
  }

  // フッター（分析対象チャンネル）
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `分析対象チャンネル: ${result.analyzedChannels.join(", ")}　|　過去24時間のアクティビティ`,
      },
    ],
  });

  return blocks;
}
