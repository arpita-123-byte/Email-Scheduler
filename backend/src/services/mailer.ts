import nodemailer, { Transporter } from 'nodemailer';
import type { Sender } from '../db/schema';
import { env } from '../config/env';

const transporters = new Map<string, Transporter>();

function getTransporter(sender: Sender): Transporter {
  const cached = transporters.get(sender.id);
  if (cached) return cached;

  const transporter =
    env.MAIL_TRANSPORT === 'json'
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
          host: sender.smtpHost,
          port: sender.smtpPort,
          secure: sender.smtpPort === 465,
          auth: { user: sender.smtpUser, pass: sender.smtpPass },
          pool: true,
          maxConnections: 3,
        });
  transporters.set(sender.id, transporter);
  return transporter;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export async function sendMail(params: {
  sender: Sender;
  emailId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  const { sender, emailId, to, subject, body } = params;
  const transporter = getTransporter(sender);
  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to,
    subject,
    text: body,
    html: body.replace(/\n/g, '<br/>'),
    // Deterministic Message-ID: the same Email row always produces the same id,
    // so any downstream system can de-duplicate on it.
    messageId: `<${emailId}@outbox-scheduler.local>`,
    headers: { 'X-Outbox-Email-Id': emailId },
  });

  const preview = env.MAIL_TRANSPORT === 'ethereal' ? nodemailer.getTestMessageUrl(info) : false;
  return { messageId: info.messageId, previewUrl: preview || null };
}
