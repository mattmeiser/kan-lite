import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string) {
  if (!config.smtp.host) {
    console.warn(`[mailer] MAIL_SMTP_HOST not set -- skipping email to ${to}: ${subject}`);
    return;
  }
  await getTransporter().sendMail({ from: config.smtp.from, to, subject, text });
}
