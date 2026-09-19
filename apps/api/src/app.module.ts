import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { env } from "./config/env";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { ChitsModule } from "./chits/chits.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { CustomersModule } from "./customers/customers.module";
import { CryptoModule } from "./common/crypto.service";
import { HealthController } from "./health/health.controller";
import { MailModule } from "./mail/mail.service";
import { LedgerController } from "./ledger/ledger.controller";
import { LedgerModule } from "./ledger/ledger.service";
import { PrismaModule } from "./prisma/prisma.service";
import { StorageModule } from "./storage/storage.service";
import { RolesModule } from "./roles/roles.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => env().NODE_ENV === "test" }),
    PrismaModule,
    CryptoModule,
    MailModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    StorageModule,
    CustomersModule,
    LedgerModule,
    ChitsModule,
    DashboardModule,
  ],
  controllers: [HealthController, LedgerController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
