import { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/web-api";
import type { MemberMessage } from "./types.js";

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

const userNameCache = new Map<string, string>();
const channelNameCache = new Map<string, string>();

async function resolveUserName(userId: string): Promise<string> {
  if (userNameCache.has(userId)) return userNameCache.get(userId)!;
  try {
    const res = await client.users.info({ user: userId });
    const name =
      res.user?.profile?.display_name ||
      res.user?.real_name ||
      res.user?.name ||
      userId;
    userNameCache.set(userId, name);
    return name;
  } catch {
    userNameCache.set(userId, userId);
    return userId;
  }
}

async function getChannelName(channelId: string): Promise<string> {
  if (channelNameCache.has(channelId)) return channelNameCache.get(channelId)!;
  try {
    const res = await client.conversations.info({ channel: channelId });
    const name = res.channel?.name ?? channelId;
    channelNameCache.set(channelId, name);
    return name;
  } catch {
    channelNameCache.set(channelId, channelId);
    return channelId;
  }
}

/**
 * 指定メンバーが所属するパブリックチャンネル一覧を取得する。
 * 複数メンバーの場合は和集合を返す。
 */
async function getMemberChannelIds(memberIds: string[]): Promise<string[]> {
  const channelSet = new Set<string>();

  for (const userId of memberIds) {
    let cursor: string | undefined;
    do {
      const res = await client.users.conversations({
        user: userId,
        types: "public_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      });
      for (const ch of res.channels ?? []) {
        if (ch.id) channelSet.add(ch.id);
      }
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);
  }

  return [...channelSet];
}

/**
 * 指定メンバーのパブリックチャンネル全体から過去 hours 時間分のメッセージを取得する。
 * CS_MEMBER_IDS が必須。Bot・システムメッセージは除外。スレッド返信も含む。
 */
export async function fetchMemberMessages(
  hours: number = 24,
): Promise<MemberMessage[]> {
  const targetMemberIds = (process.env.CS_MEMBER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (targetMemberIds.length === 0) {
    throw new Error("CS_MEMBER_IDS が設定されていません");
  }

  console.log(`  対象メンバー: ${targetMemberIds.length}名 — チャンネル一覧を取得中...`);
  const channelIds = await getMemberChannelIds(targetMemberIds);
  console.log(`  取得チャンネル数: ${channelIds.length}`);

  const now = Math.floor(Date.now() / 1000);
  const oldest = now - hours * 60 * 60;
  const allMessages: MemberMessage[] = [];

  for (const channelId of channelIds) {
    const channelName = await getChannelName(channelId);
    let cursor: string | undefined;

    do {
      const response = await client.conversations.history({
        channel: channelId,
        oldest: String(oldest),
        latest: String(now),
        limit: 200,
        cursor,
      });

      const messages = response.messages ?? [];

      for (const msg of messages) {
        if (!msg.ts || !msg.user || msg.subtype) continue;
        if (msg.bot_id) continue;
        if (!targetMemberIds.includes(msg.user)) continue;

        const userName = await resolveUserName(msg.user);

        const memberMsg: MemberMessage = {
          userId: msg.user,
          userName,
          channelId,
          channelName,
          text: msg.text ?? "",
          ts: msg.ts,
          threadReplyCount: msg.reply_count ?? 0,
          isThreadReply: false,
        };
        allMessages.push(memberMsg);

        // スレッドの返信も取得（返信がある場合）
        if (msg.reply_count && msg.reply_count > 0 && msg.thread_ts) {
          const threadReplies = await fetchThreadReplies(
            channelId,
            channelName,
            msg.thread_ts,
            oldest,
            targetMemberIds,
          );
          allMessages.push(...threadReplies);
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);
  }

  return allMessages;
}

async function fetchThreadReplies(
  channelId: string,
  channelName: string,
  threadTs: string,
  oldest: number,
  targetMemberIds: string[],
): Promise<MemberMessage[]> {
  const replies: MemberMessage[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      oldest: String(oldest),
      limit: 200,
      cursor,
    });

    const messages = response.messages ?? [];
    // 最初のメッセージ（親）はスキップ
    for (const msg of messages.slice(1)) {
      if (!msg.ts || !msg.user || msg.subtype) continue;
      if (msg.bot_id) continue;
      if (!targetMemberIds.includes(msg.user)) continue;

      const userName = await resolveUserName(msg.user);
      replies.push({
        userId: msg.user,
        userName,
        channelId,
        channelName,
        text: msg.text ?? "",
        ts: msg.ts,
        isThreadReply: true,
      });
    }

    cursor = response.response_metadata?.next_cursor;
  } while (cursor);

  return replies;
}

/**
 * 指定ユーザーへ Block Kit 形式の DM を送信する。
 */
export async function sendDm(
  userId: string,
  blocks: KnownBlock[],
  fallbackText: string,
): Promise<void> {
  const openRes = await client.conversations.open({ users: userId });
  const dmChannelId = openRes.channel?.id;
  if (!dmChannelId) throw new Error("DM チャンネルを開けませんでした");

  await client.chat.postMessage({
    channel: dmChannelId,
    blocks,
    text: fallbackText,
  });
}
