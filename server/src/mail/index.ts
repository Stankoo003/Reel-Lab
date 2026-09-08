/**
 * Sending one email. Mailpit over SMTP locally, Resend over HTTPS deployed; MAIL_PROVIDER
 * decides and nothing above this interface knows which it got.
 */
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { config } from "@/lib/config";

export interface Mailer {
  send(to: string, subject: string, text: string, html: string): Promise<void>;
  describe(): string;
}

class ResendMailer implements Mailer {
  private readonly client = new Resend(config.mail.resendApiKey);
  async send(to: string, subject: string, text: string, html: string) {
    const { error } = await this.client.emails.send({ from: config.mail.from, to: [to], subject, text, html });
    if (error) throw new Error(`Resend refused the message: ${error.name} ${error.message}`);
  }
  describe() { return "resend"; }
}

class SmtpMailer implements Mailer {
  private readonly transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: false,
    auth: config.mail.smtpAuth ? { user: config.mail.smtpUser, pass: config.mail.smtpPassword } : undefined,
  });
  async send(to: string, subject: string, text: string, html: string) {
    await this.transport.sendMail({ from: config.mail.from, to, subject, text, html });
  }
  describe() { return "smtp"; }
}

let instance: Mailer | undefined;

export function mailer(): Mailer {
  if (!instance) instance = config.mail.provider === "resend" ? new ResendMailer() : new SmtpMailer();
  return instance;
}
