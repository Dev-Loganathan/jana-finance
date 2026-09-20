import { Module } from "@nestjs/common";
import { LoanPaymentsService } from "./loan-payments.service";
import { LoansController, LoanProductsController } from "./loans.controller";
import { LoansService } from "./loans.service";

@Module({
  controllers: [LoanProductsController, LoansController],
  providers: [LoansService, LoanPaymentsService],
  exports: [LoansService],
})
export class LoansModule {}
