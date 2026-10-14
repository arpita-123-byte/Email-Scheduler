import type {
  EmailItem,
  EmailListResponse,
  EmailStats,
  EmailTab,
  ScheduleRequest,
  ScheduleResponse,
  SendersResponse,
  SlackStatus,
  User,
} from './types';

// In production, use same-origin URLs so Vercel can route /api/* to the backend.
// For local development, default to the Express server on port 4000.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4000');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, `Can't reach the server${API_URL ? ` at ${API_URL}` : ''}. Is the backend running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = data?.details as Record<string, string[]> | undefined;
    const firstDetail = details ? Object.entries(details)[0] : undefined;
    const message = firstDetail ? `${firstDetail[0]}: ${firstDetail[1][0]}` : (data?.error ?? `Request failed (${res.status})`);
    throw new ApiError(res.status, message, details);
  }
  return data as T;
}

export const api = {
  googleLoginUrl: `${API_URL}/api/auth/google`,
  slackConnectUrl: `${API_URL}/api/slack/connect`,
  queueDashboardUrl: `${API_URL}/admin/queues`,

  me: () => request<{ user: User }>('/api/auth/me'),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  listEmails: (params: { tab: EmailTab; q?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams({ tab: params.tab, page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 20) });
    if (params.q) qs.set('q', params.q);
    return request<EmailListResponse>(`/api/emails?${qs}`);
  },
  getEmail: (id: string) => request<{ email: EmailItem }>(`/api/emails/${encodeURIComponent(id)}`),
  stats: () => request<EmailStats>('/api/emails/stats'),

  senders: () => request<SendersResponse>('/api/senders'),
  schedule: (body: ScheduleRequest) =>
    request<ScheduleResponse>('/api/campaigns', { method: 'POST', body: JSON.stringify(body) }),

  slackStatus: () => request<SlackStatus>('/api/slack/status'),
  disconnectSlack: () => request<{ ok: true }>('/api/slack', { method: 'DELETE' }),
};
