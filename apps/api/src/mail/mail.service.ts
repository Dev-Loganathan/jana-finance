import { Global, Injectable, Logger, Module } from "@nestjs/common";

/** Mail provider seam. Dev implementation logs the message; SMTP/SES plug in here later. */
@Injectable()
export class MailService {
  private log = new Logger("Mail");
  async send(to: string, subject: string, body: string) {
    // Never log secrets in production; in dev the invite link is the point.
    this.log.log(`to=${to} subject="${subject}"\n${body}`);
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
