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
 * 複数チャンネルから過去 hours 時間分のメッセージを取得する。
 * スレッドの返信も含む。Bot・システムメッセージは除外。
 */
export async function fetchMemberMessages(
  hours: number = 24,
): Promise<MemberMessage[]> {
  const channelIds = (process.env.SLACK_CHANNEL_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (channelIds.length === 0) {
    throw new Error("SLACK_CHANNEL_IDS が設定されていません");
  }

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
