import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { MailConfig } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Closes pooled connections (no-op for transports without any). */
  close(): void;
}

/** Sends through a real SMTP server (e.g. iCloud+: smtp.mail.me.com:587 with STARTTLS). */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly config: MailConfig) {
    const { host, port, secure, user, pass } = config.smtp;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      // Never fall back to plain text when the server does not offer STARTTLS.
      requireTLS: !secure,
      auth: { user, pass },
      pool: true,
      maxConnections: 2,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.config.from, ...message });
  }

  /** Checks connection and credentials (used once at start-up). */
  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  close(): void {
    this.transporter.close();
  }
}

/**
 * Keeps sent mails in memory and logs that they were sent. For tests and local development only;
 * the configuration refuses this transport in production.
 */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  constructor(
    private readonly log?: FastifyBaseLogger,
    private readonly limit = 200,
  ) {}

  send(message: MailMessage): Promise<void> {
    // Synchronous push: the mail is visible as soon as the request that triggered it returns.
    this.sent.push(message);
    if (this.sent.length > this.limit) this.sent.shift();
    this.log?.info(
      { to: message.to, subject: message.subject },
      'mail captured (MAIL_TRANSPORT=log)',
    );
    return Promise.resolve();
  }

  close(): void {}
}

export function createMailer(config: MailConfig, log?: FastifyBaseLogger): Mailer {
  return config.transport === 'smtp' ? new SmtpMailer(config) : new MemoryMailer(log);
}
