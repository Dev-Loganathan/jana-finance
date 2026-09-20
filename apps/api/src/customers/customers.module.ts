import { Module } from "@nestjs/common";
import { BulkImportController } from "../bulk-import/bulk-import.controller";
import { BulkImportService } from "../bulk-import/bulk-import.service";
import { ExcelService } from "../bulk-import/excel.service";
import { CustomersController, FilesController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { KycService } from "./kyc.service";

@Module({
  controllers: [BulkImportController, CustomersController, FilesController],
  providers: [CustomersService, KycService, BulkImportService, ExcelService],
})
export class CustomersModule {}
