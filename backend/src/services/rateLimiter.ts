import { env } from '../config/env';
import { redis } from '../lib/redis';

/**
 * Send-slot reservation: hourly rate limits + minimum delay in one atomic Redis step.
 *
 * Every email is given a concrete send time ("slot") that satisfies ALL of:
 *
 *   - per-sender minimum gap: no other slot of the same sender within
 *     MIN_DELAY_BETWEEN_EMAILS_MS (reserved slots live in a sorted set
 *     rl:slots:sender:{senderId}, scored by time)
 *   - global hourly cap:       rl:global:{window}                < MAX_EMAILS_PER_HOUR
 *   - per-sender hourly cap:   rl:sender:{senderId}:{window}     < MAX_EMAILS_PER_HOUR_PER_SENDER
 *   - per-campaign hourly cap: rl:campaign:{campaignId}:{window} < the "Hourly limit" set in Compose
 *
 * {window} = floor(time / RATE_LIMIT_WINDOW_MS): fixed clock-hour buckets.
 * If the window a slot would land in is full, the search jumps to the start of
 * the next window: emails are delayed, never dropped.
 *
 * Slots are reserved when a campaign is scheduled, in recipient order, in one
 * batch, so order is preserved exactly and the dashboard shows real send
 * times. The worker only re-reserves for retries and for jobs re-created by
 * the startup reconciler.
 *
 * The script runs atomically inside Redis, so any number of API servers and
 * workers can reserve concurrently without double-booking, and nothing is
 * counted in process memory.
 *
 * Note: counter keys are built inside the script, which is fine for a single
 * Redis / Sentinel deployment; Redis Cluster would need a shared hash tag.
 */
const RESERVE_LUA = `
local key = KEYS[1]
local minDelay = tonumber(ARGV[1])
local size = tonumber(ARGV[2])
local gLimit = tonumber(ARGV[3])
local sLimit = tonumber(ARGV[4])
local cLimit = tonumber(ARGV[5])
local senderId = ARGV[6]
local campaignId = ARGV[7]
local maxIter = tonumber(ARGV[8])
local now = tonumber(ARGV[9])

-- Drop reservations that are long in the past.
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 2 * size)

local out = {}
local n = (#ARGV - 9) / 2
for j = 1, n do
  local id = ARGV[9 + 2 * j - 1]
  local t = tonumber(ARGV[9 + 2 * j])
  if t < now then t = now end

  -- Re-reservation (retry, or a job that fired late after downtime): give back
  -- the email's previous slot first so it is not counted twice.
  local old = redis.call('ZSCORE', key, id)
  if old then
    local ow = math.floor(tonumber(old) / size)
    for _, k in ipairs({'rl:global:' .. ow, 'rl:sender:' .. senderId .. ':' .. ow, 'rl:campaign:' .. campaignId .. ':' .. ow}) do
      if tonumber(redis.call('GET', k) or '0') > 0 then redis.call('DECR', k) end
    end
    redis.call('ZREM', key, id)
  end
  local blocked = 0
  local blockedWindow = -1
  local placed = false

  for iter = 1, maxIter do
    local w = math.floor(t / size)
    local gk = 'rl:global:' .. w
    local sk = 'rl:sender:' .. senderId .. ':' .. w
    local ck = 'rl:campaign:' .. campaignId .. ':' .. w
    local g = tonumber(redis.call('GET', gk) or '0')
    local s = tonumber(redis.call('GET', sk) or '0')
    local c = tonumber(redis.call('GET', ck) or '0')

    if g >= gLimit or s >= sLimit or c >= cLimit then
      -- Window full: remember why (first time only) and try the next window.
      if blocked == 0 then
        if g >= gLimit then blocked = 1 elseif s >= sLimit then blocked = 2 else blocked = 3 end
        blockedWindow = w
      end
      t = (w + 1) * size
    else
      local conflict = {}
      if minDelay > 0 then
        conflict = redis.call('ZRANGEBYSCORE', key, '(' .. (t - minDelay), '(' .. (t + minDelay), 'WITHSCORES', 'LIMIT', 0, 1)
      end
      if #conflict > 0 then
        -- Too close to an existing slot: move past it, then walk over any
        -- dense run of later slots until a gap of at least minDelay opens up.
        local prev = tonumber(conflict[2])
        t = prev + minDelay
        local run = redis.call('ZRANGEBYSCORE', key, '(' .. prev, '+inf', 'WITHSCORES', 'LIMIT', 0, 512)
        for k = 2, #run, 2 do
          local sc = tonumber(run[k])
          if sc - t >= minDelay then break end
          if sc + minDelay > t then t = sc + minDelay end
        end
        -- loop again: the new t must be re-checked against the window caps
      else
        local expireAt = (w + 2) * size
        for _, k in ipairs({gk, sk, ck}) do
          redis.call('INCR', k)
          redis.call('PEXPIREAT', k, expireAt)
        end
        redis.call('ZADD', key, t, id)
        out[j] = {t, blocked, blockedWindow}
        placed = true
        break
      end
    end
  end
  if not placed then out[j] = {-1, blocked, blockedWindow} end
end
return out
`;

export type LimitScope = 'global' | 'sender' | 'campaign';
const SCOPES: Record<number, LimitScope> = { 1: 'global', 2: 'sender', 3: 'campaign' };

export interface WindowInfo {
  window: number;
  windowStart: number;
  windowEnd: number;
}

export function windowInfo(window: number): WindowInfo {
  const size = env.RATE_LIMIT_WINDOW_MS;
  return { window, windowStart: window * size, windowEnd: (window + 1) * size };
}

export function currentWindow(now = Date.now()): WindowInfo {
  return windowInfo(Math.floor(now / env.RATE_LIMIT_WINDOW_MS));
}

export interface Reservation {
  emailId: string;
  /** Epoch ms at which this email may be sent. */
  slot: number;
  /** Set when a full window had to be skipped: which limit was full, and which window. */
  blockedBy?: { scope: LimitScope; limit: number; window: WindowInfo };
}

/**
 * Reserve send slots for emails of ONE campaign, in the given order.
 * `desired` is the earliest time each email may go out (campaign start + delay).
 */
export async function reserveSendSlots(params: {
  senderId: string;
  campaignId: string;
  campaignHourlyLimit: number;
  items: { emailId: string; desired: number }[];
}): Promise<Reservation[]> {
  const limits: Record<LimitScope, number> = {
    global: env.MAX_EMAILS_PER_HOUR,
    sender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    campaign: params.campaignHourlyLimit,
  };
  const results: Reservation[] = [];
  const BATCH = 500; // keeps each script call short so Redis is never blocked for long

  for (let i = 0; i < params.items.length; i += BATCH) {
    const batch = params.items.slice(i, i + BATCH);
    const raw = (await redis.eval(
      RESERVE_LUA,
      1,
      `rl:slots:sender:${params.senderId}`,
      env.MIN_DELAY_BETWEEN_EMAILS_MS,
      env.RATE_LIMIT_WINDOW_MS,
      limits.global,
      limits.sender,
      limits.campaign,
      params.senderId,
      params.campaignId,
      100_000,
      Date.now(),
      ...batch.flatMap((it) => [it.emailId, it.desired]),
    )) as [number, number, number][];

    raw.forEach(([slot, blocked, blockedWindow], k) => {
      if (slot < 0) throw new Error(`No send slot found for email ${batch[k].emailId}`);
      const r: Reservation = { emailId: batch[k].emailId, slot };
      if (blocked) {
        const scope = SCOPES[blocked];
        r.blockedBy = { scope, limit: limits[scope], window: windowInfo(blockedWindow) };
      }
      results.push(r);
    });
  }
  return results;
}

export async function getUsage(senderIds: string[]): Promise<{
  window: WindowInfo;
  global: { used: number; limit: number };
  senders: Record<string, { used: number; limit: number }>;
}> {
  const window = currentWindow();
  const keys = [`rl:global:${window.window}`, ...senderIds.map((id) => `rl:sender:${id}:${window.window}`)];
  const values = await redis.mget(...keys);
  const senders: Record<string, { used: number; limit: number }> = {};
  senderIds.forEach((id, i) => {
    senders[id] = { used: Number(values[i + 1] ?? 0), limit: env.MAX_EMAILS_PER_HOUR_PER_SENDER };
  });
  return {
    window,
    global: { used: Number(values[0] ?? 0), limit: env.MAX_EMAILS_PER_HOUR },
    senders,
  };
}
