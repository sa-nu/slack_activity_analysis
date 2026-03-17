import Anthropic from "@anthropic-ai/sdk";
import type {
  MemberMessage,
  MemberActivity,
  TaskCategory,
  TaskCategoryName,
  AnalysisResult,
} from "./types.js";

const anthropic = new Anthropic();

const CATEGORY_NAMES: TaskCategoryName[] = [
  "顧客対応",
  "社内連絡",
  "報告・共有",
  "情報収集",
  "その他",
];

interface ClaudeCategory {
  name: TaskCategoryName;
  messageCount: number;
  estimatedMinutes: number;
  examples: string[];
}

interface ClaudeMemberResult {
  categories: ClaudeCategory[];
}

interface ClaudeAnalysisResult {
  members: { [userId: string]: ClaudeMemberResult };
  overallInsight: string;
}

/**
 * メンバーごとにメッセージをグループ化する。
 */
function groupByMember(messages: MemberMessage[]): Map<string, MemberMessage[]> {
  const map = new Map<string, MemberMessage[]>();
  for (const msg of messages) {
    if (!map.has(msg.userId)) map.set(msg.userId, []);
    map.get(msg.userId)!.push(msg);
  }
  return map;
}

/**
 * メッセージをテキスト形式にフォーマットする（Claude へ渡す用）。
 */
function formatMessagesForPrompt(messages: MemberMessage[]): string {
  return messages
    .map((m) => {
      const isReply = m.isThreadReply ? "[スレッド返信]" : "[メッセージ]";
      const ch = `#${m.channelName}`;
      const text = m.text.substring(0, 300);
      return `${isReply} ${ch}: ${text}`;
    })
    .join("\n");
}

/**
 * 全メンバーのアクティビティをまとめてClaudeで分析する。
 */
async function analyzeWithClaude(
  memberGroups: Map<string, MemberMessage[]>,
  date: string,
): Promise<ClaudeAnalysisResult> {
  const membersData: string[] = [];

  for (const [userId, messages] of memberGroups) {
    const userName = messages[0].userName;
    const formattedMessages = formatMessagesForPrompt(messages);
    membersData.push(
      `=== メンバーID: ${userId} / 名前: ${userName} (${messages.length}件) ===\n${formattedMessages}`,
    );
  }

  const memberIds = [...memberGroups.keys()];
  const prompt = `あなたはカスタマーサポートチームのマネージャーです。
以下は本日（${date}）のCSチームメンバーのSlackメッセージ一覧です。

${membersData.join("\n\n")}

上記のメッセージを分析し、以下のJSON形式で出力してください。

{
  "members": {
    "メンバーID": {
      "categories": [
        {
          "name": "カテゴリ名",
          "messageCount": メッセージ数,
          "estimatedMinutes": 推定工数（分）,
          "examples": ["代表的なメッセージ例（最大2件、それぞれ50文字以内）"]
        }
      ]
    }
  },
  "overallInsight": "チーム全体の業務傾向についての所見（3〜5文）"
}

カテゴリは以下の5つのみ使用してください：
- 顧客対応: 顧客や外部からの問い合わせへの対応、クレーム処理など
- 社内連絡: 社内メンバーへの連絡・調整・依頼
- 報告・共有: 情報の報告や進捗共有、ナレッジ共有
- 情報収集: 質問・調査・情報を集めようとするメッセージ
- その他: 上記に分類できないもの

推定工数（estimatedMinutes）はメッセージの複雑さや文量から推定してください。
（例: 短い返信1件 ≒ 2〜5分、複雑な問い合わせ対応 ≒ 15〜30分）

対象メンバーID一覧: ${memberIds.join(", ")}
各メンバーIDをキーとして、全員のデータを含めてください。
JSONのみを出力してください。`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const textContent = response.content.find((b) => b.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("Claude API からテキスト応答を取得できませんでした");
  }

  const cleanText = textContent.text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "");
  const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude API の応答から JSON を抽出できませんでした");
  }

  return JSON.parse(jsonMatch[0]) as ClaudeAnalysisResult;
}

/**
 * Slack メッセージを Claude で分析してアクティビティ結果を返す。
 */
export async function analyzeActivities(
  messages: MemberMessage[],
  date: string,
): Promise<AnalysisResult> {
  const channelNames = [
    ...new Set(messages.map((m) => `#${m.channelName}`)),
  ];

  if (messages.length === 0) {
    return {
      date,
      analyzedChannels: channelNames,
      memberActivities: [],
      overallInsight: "本日は対象チャンネルにメッセージがありませんでした。",
    };
  }

  const memberGroups = groupByMember(messages);
  const claudeResult = await analyzeWithClaude(memberGroups, date);

  const memberActivities: MemberActivity[] = [];

  for (const [userId, messages] of memberGroups) {
    const userName = messages[0].userName;
    const claudeMember = claudeResult.members[userId];

    let categories: TaskCategory[] = [];

    if (claudeMember?.categories) {
      categories = claudeMember.categories
        .filter((c) => CATEGORY_NAMES.includes(c.name))
        .map((c) => ({
          name: c.name,
          messageCount: c.messageCount ?? 0,
          estimatedMinutes: c.estimatedMinutes ?? 0,
          examples: (c.examples ?? []).slice(0, 2),
        }));
    }

    const totalEstimatedMinutes = categories.reduce(
      (sum, c) => sum + c.estimatedMinutes,
      0,
    );

    memberActivities.push({
      userId,
      userName,
      totalMessages: messages.length,
      totalEstimatedMinutes,
      categories,
    });
  }

  // 総推定工数の多い順にソート
  memberActivities.sort(
    (a, b) => b.totalEstimatedMinutes - a.totalEstimatedMinutes,
  );

  return {
    date,
    analyzedChannels: channelNames,
    memberActivities,
    overallInsight: claudeResult.overallInsight ?? "",
  };
}
