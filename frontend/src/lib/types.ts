export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type EmailStatus = 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED';
export type EmailTab = 'scheduled' | 'sent';

export interface SenderRef {
  id: string;
  name: string;
  email: string;
}

export interface EmailItem {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  error: string | null;
  rescheduledCount: number;
  campaignId: string;
  updatedAt: string;
  sender: SenderRef;
}

export interface EmailListResponse {
  items: EmailItem[];
  total: number;
  page: number;
  pageSize: number;
  searchEngine: 'elasticsearch' | 'postgres' | null;
}

export interface EmailStats {
  scheduled: number;
  sent: number;
  failed: number;
}

export interface Usage {
  used: number;
  limit: number;
}

export interface Sender extends SenderRef {
  usage: Usage;
}

export interface SendersResponse {
  senders: Sender[];
  global: Usage;
  window: { start: string; end: string };
  config: {
    minDelayBetweenEmailsMs: number;
    maxEmailsPerHour: number;
    maxEmailsPerHourPerSender: number;
    workerConcurrency: number;
  };
}

export interface ScheduleRequest {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  delaySeconds: number;
  hourlyLimit: number;
}

export interface ScheduleResponse {
  scheduled: number;
  invalid: string[];
  pushedToLaterWindows: number;
  firstSendAt: string | null;
  lastSendAt: string | null;
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  connection: { teamName: string; channelName: string | null; createdAt: string } | null;
}
