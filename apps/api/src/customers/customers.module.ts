import { Module } from "@nestjs/common";
import { CustomersController, FilesController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { ImportService } from "./import.service";
import { KycService } from "./kyc.service";

@Module({
  controllers: [CustomersController, FilesController],
  providers: [CustomersService, KycService, ImportService],
})
export class CustomersModule {}
