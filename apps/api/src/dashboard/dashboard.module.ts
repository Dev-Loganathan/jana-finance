import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { LoansModule } from "../loans/loans.module";
import { DashboardService } from "./dashboard.service";

@Module({ imports: [LoansModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
