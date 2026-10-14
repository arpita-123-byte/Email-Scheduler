import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createId } from './id';

const id = () => text('id').primaryKey().$defaultFn(createId);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: id(),
  googleId: text('google_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});

/** An SMTP identity emails are sent from. Each row is an Ethereal test account. */
export const senders = pgTable('senders', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  smtpHost: text('smtp_host').notNull(),
  smtpPort: integer('smtp_port').notNull(),
  smtpUser: text('smtp_user').notNull(),
  smtpPass: text('smtp_pass').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** One "Compose New Email" submission: a subject/body sent to N recipients. */
export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => senders.id),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    startAt: ts('start_at').notNull(),
    delayMs: integer('delay_ms').notNull(),
    hourlyLimit: integer('hourly_limit').notNull(),
    total: integer('total').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('campaigns_user_created_idx').on(t.userId, t.createdAt)],
);

export const emailStatus = pgEnum('email_status', ['SCHEDULED', 'SENDING', 'SENT', 'FAILED']);
export type EmailStatus = (typeof emailStatus.enumValues)[number];

/**
 * One recipient of one campaign. The row id is also the BullMQ job id, so a
 * given email can only ever exist once in the queue.
 */
export const emails = pgTable(
  'emails',
  {
    id: id(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => senders.id),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    /** Position of this recipient inside its campaign (keeps ordering stable). */
    sequence: integer('sequence').notNull(),
    scheduledAt: ts('scheduled_at').notNull(),
    status: emailStatus('status').notNull().default('SCHEDULED'),
    attempts: integer('attempts').notNull().default(0),
    rescheduledCount: integer('rescheduled_count').notNull().default(0),
    lockedAt: ts('locked_at'),
    sentAt: ts('sent_at'),
    messageId: text('message_id'),
    previewUrl: text('preview_url'),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('emails_campaign_recipient_uq').on(t.campaignId, t.toEmail),
    index('emails_user_status_scheduled_idx').on(t.userId, t.status, t.scheduledAt),
    index('emails_user_status_updated_idx').on(t.userId, t.status, t.updatedAt),
    index('emails_status_scheduled_idx').on(t.status, t.scheduledAt),
  ],
);

export const slackConnections = pgTable('slack_connections', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull(),
  teamName: text('team_name').notNull(),
  channelId: text('channel_id'),
  channelName: text('channel_name'),
  webhookUrl: text('webhook_url').notNull(),
  accessToken: text('access_token').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});

export const emailsRelations = relations(emails, ({ one }) => ({
  sender: one(senders, { fields: [emails.senderId], references: [senders.id] }),
  campaign: one(campaigns, { fields: [emails.campaignId], references: [campaigns.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  sender: one(senders, { fields: [campaigns.senderId], references: [senders.id] }),
  emails: many(emails),
}));

export type User = typeof users.$inferSelect;
export type Sender = typeof senders.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type SlackConnection = typeof slackConnections.$inferSelect;
