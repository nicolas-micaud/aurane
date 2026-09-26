// Outgoing mail (decision 0010, lot C): the six-digit code. The contract with the local session is five variables,
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM; while they are missing the code goes to the logs, so a
// developer, a tester, or a beta without a sender still gets through.
import { createTransport } from 'nodemailer';

export interface MailMessage { to: string; subject: string; text: string }
export interface Mailer { readonly kind: 'smtp' | 'log'; send(m: MailMessage): Promise<void> }

export interface SmtpConfig { host: string; port: number; user: string; pass: string; from: string }

/** The SMTP settings when all five variables are set, null otherwise. */
export function smtpFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST, user = env.SMTP_USER, pass = env.SMTP_PASS, from = env.MAIL_FROM;
  if (!host || !user || !pass || !from) return null;
  const port = Number(env.SMTP_PORT || 587);
  return { host, port: Number.isFinite(port) ? port : 587, user, pass, from };
}

export class SmtpMailer implements Mailer {
  readonly kind = 'smtp' as const;
  private readonly transport;
  constructor(private readonly cfg: SmtpConfig) {
    // 465 is implicit TLS; 587 and 25 start in clear and upgrade with STARTTLS, which we require.
    this.transport = createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, requireTLS: cfg.port !== 465, auth: { user: cfg.user, pass: cfg.pass } });
  }
  async send(m: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.cfg.from, to: m.to, subject: m.subject, text: m.text });
  }
}

/** No sender configured: the message is logged in full, code included, and nothing leaves the machine. */
export class LogMailer implements Mailer {
  readonly kind = 'log' as const;
  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}
  async send(m: MailMessage): Promise<void> {
    this.log(`[mail] no SMTP configured; to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
  }
}

export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const cfg = smtpFromEnv(env);
  return cfg ? new SmtpMailer(cfg) : new LogMailer();
}

/** The two messages, FR/EN, plain text. */
export function codeMail(lang: 'fr' | 'en', purpose: 'add' | 'login', code: string, colony: string | null): { subject: string; text: string } {
  const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;
  if (lang === 'en') {
    return purpose === 'add'
      ? { subject: `Aurane: your code is ${pretty}`, text: `Your code to attach this address to your Colony${colony ? ` ${colony}` : ''}:\n\n    ${pretty}\n\nType it in the app within ten minutes. If you did not ask for it, ignore this message: nothing changes without the code.\n\nAurane, playaurane.com` }
      : { subject: `Aurane: your sign-in code is ${pretty}`, text: `Your code to open your Colony${colony ? ` ${colony}` : ''} on this device:\n\n    ${pretty}\n\nType it in the app within ten minutes. If you did not ask for it, ignore this message: nobody gets in without the code.\n\nAurane, playaurane.com` };
  }
  return purpose === 'add'
    ? { subject: `Aurane : ton code est ${pretty}`, text: `Ton code pour rattacher cette adresse à ta Colonie${colony ? ` ${colony}` : ''} :\n\n    ${pretty}\n\nSaisis-le dans l'application d'ici dix minutes. Si tu n'as rien demandé, ignore ce message : rien ne change sans le code.\n\nAurane, playaurane.com` }
    : { subject: `Aurane : ton code de connexion est ${pretty}`, text: `Ton code pour ouvrir ta Colonie${colony ? ` ${colony}` : ''} sur cet appareil :\n\n    ${pretty}\n\nSaisis-le dans l'application d'ici dix minutes. Si tu n'as rien demandé, ignore ce message : personne n'entre sans le code.\n\nAurane, playaurane.com` };
}
