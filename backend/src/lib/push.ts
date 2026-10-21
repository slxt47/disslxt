import webpush from 'web-push';
import type { PushConfig } from '../config.js';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushResult {
  /** HTTP status of the push service; 404/410 mean the subscription is gone for good. */
  statusCode: number;
}

export interface PushSender {
  send(target: PushTarget, payload: string): Promise<PushResult>;
}

/** Sends through the browsers' push services, signed with the VAPID key (RFC 8292). */
export class WebPushSender implements PushSender {
  constructor(private readonly config: PushConfig) {}

  async send(target: PushTarget, payload: string): Promise<PushResult> {
    try {
      const res = await webpush.sendNotification(target, payload, {
        vapidDetails: {
          subject: this.config.subject,
          publicKey: this.config.publicKey,
          privateKey: this.config.privateKey,
        },
        // Chat messages are stale after a few hours; "high" wakes iOS/Android devices.
        TTL: 4 * 60 * 60,
        urgency: 'high',
        timeout: 10_000,
      });
      return { statusCode: res.statusCode };
    } catch (err) {
      if (err instanceof webpush.WebPushError) return { statusCode: err.statusCode };
      throw err;
    }
  }
}

/** Records pushes instead of sending them (tests). `failWith` simulates push-service answers. */
export class MemoryPushSender implements PushSender {
  readonly sent: { endpoint: string; payload: unknown }[] = [];
  readonly failWith = new Map<string, number>();

  send(target: PushTarget, payload: string): Promise<PushResult> {
    const status = this.failWith.get(target.endpoint);
    if (status) return Promise.resolve({ statusCode: status });
    this.sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as unknown });
    return Promise.resolve({ statusCode: 201 });
  }
}
