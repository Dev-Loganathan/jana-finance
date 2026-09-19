import { Module } from "@nestjs/common";
import { ChitCollectionService } from "./chit-collection.service";
import { ChitService } from "./chit.service";
import { ChitsController } from "./chits.controller";

@Module({ controllers: [ChitsController], providers: [ChitService, ChitCollectionService] })
export class ChitsModule {}
