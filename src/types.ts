export interface MemberMessage {
  userId: string;
  userName: string;
  channelId: string;
  channelName: string;
  text: string;
  ts: string;
  permalink: string;
  threadReplyCount?: number;
  isThreadReply: boolean;
}

export type TaskCategoryName =
  | "顧客対応"
  | "社内連絡"
  | "報告・共有"
  | "情報収集"
  | "その他";

export interface TaskCategory {
  name: TaskCategoryName;
  messageCount: number;
  estimatedMinutes: number;
  examples: string[];
}

export interface MemberActivity {
  userId: string;
  userName: string;
  totalMessages: number;
  totalEstimatedMinutes: number;
  categories: TaskCategory[];
  insight: string[];
}

export interface AnalysisResult {
  date: string;
  analyzedChannels: string[];
  memberActivities: MemberActivity[];
}
