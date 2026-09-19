import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { KycDocType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { sniffMime, StorageService } from "../storage/storage.service";
import type { AuthUser, ReqCtx } from "../common/decorators";
import { CustomersService } from "./customers.service";
import { toCustomerDto } from "./customer.dto";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_DOC = 6;
const SINGLE_FILE_TYPES: KycDocType[] = ["PHOTO", "SIGNATURE"];

@Injectable()
export class KycService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private storage: StorageService,
    private customers: CustomersService,
  ) {}

  private async result(actor: AuthUser, id: string) {
    return toCustomerDto(await this.customers.load(id), { canSeeKyc: actor.permissions.includes("kyc:view") });
  }

  async uploadFile(
    actor: AuthUser,
    customerId: string,
    type: KycDocType,
    file: Express.Multer.File | undefined,
    label: string,
    ctx: ReqCtx,
  ) {
    await this.customers.load(customerId);
    if (!file) throw new BadRequestException({ code: "NO_FILE", message: "Attach a file" });
    if (file.size > MAX_FILE_BYTES)
      throw new PayloadTooLargeException({ code: "FILE_TOO_LARGE", message: "Files can be at most 5 MB" });

    // Trust the bytes, not the client-supplied type.
    const mime = sniffMime(file.buffer);
    if (!mime)
      throw new BadRequestException({
        code: "UNSUPPORTED_FILE",
        message: "Only JPG, PNG, WebP or PDF files are accepted",
      });
    if (SINGLE_FILE_TYPES.includes(type) && mime === "application/pdf")
      throw new BadRequestException({ code: "UNSUPPORTED_FILE", message: "Photos and signatures must be images" });
    const scan = await this.storage.scanner.scan(file.buffer, file.originalname);
    if (!scan.clean)
      throw new BadRequestException({ code: "INFECTED_FILE", message: "The file failed the security scan" });

    const key = `customers/${customerId}/${randomUUID()}`;
    await this.storage.driver.put(key, file.buffer);
    const replaced: string[] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        const doc = await tx.kycDocument.upsert({
          where: { customerId_type: { customerId, type } },
          create: { customerId, type },
          // New evidence invalidates an earlier verification or rejection.
          update: { status: "PENDING", verifiedAt: null, verifiedById: null, rejectionReason: null },
          include: { files: true },
        });
        if (SINGLE_FILE_TYPES.includes(type)) {
          for (const old of doc.files) replaced.push(old.storageKey);
          await tx.customerFile.deleteMany({ where: { documentId: doc.id } });
        } else if (doc.files.length >= MAX_FILES_PER_DOC) {
          throw new BadRequestException({
            code: "TOO_MANY_FILES",
            message: `At most ${MAX_FILES_PER_DOC} files per document`,
          });
        }
        await tx.customerFile.create({
          data: {
            customerId,
            documentId: doc.id,
            label: label.slice(0, 40),
            storageKey: key,
            mimeType: mime,
            sizeBytes: file.size,
            sha256: createHash("sha256").update(file.buffer).digest("hex"),
            originalName: file.originalname.slice(0, 120),
            uploadedById: actor.id,
          },
        });
        await this.customers.refresh(tx, customerId);
        await this.audit.record(
          ctx,
          {
            action: "kyc.file_uploaded",
            entity: "KycDocument",
            entityId: customerId,
            after: { type, label, mime, size: file.size },
          },
          tx,
        );
      });
    } catch (e) {
      await this.storage.driver.delete(key); // do not leave an orphan blob behind
      throw e;
    }
    await Promise.all(replaced.map((k) => this.storage.driver.delete(k)));
    return this.result(actor, customerId);
  }

  async deleteFile(actor: AuthUser, customerId: string, fileId: string, ctx: ReqCtx) {
    const f = await this.prisma.customerFile.findFirst({
      where: { id: fileId, customerId },
      include: { document: true },
    });
    if (!f) throw new NotFoundException({ code: "NOT_FOUND", message: "File not found" });
    if (f.document?.status === "VERIFIED")
      throw new BadRequestException({
        code: "VERIFIED_LOCKED",
        message: "Reject the verification before removing its file",
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.customerFile.delete({ where: { id: fileId } });
      await this.customers.refresh(tx, customerId);
      await this.audit.record(
        ctx,
        {
          action: "kyc.file_deleted",
          entity: "KycDocument",
          entityId: customerId,
          before: { type: f.document?.type, label: f.label },
        },
        tx,
      );
    });
    await this.storage.driver.delete(f.storageKey);
    return this.result(actor, customerId);
  }

  private async getDoc(customerId: string, type: KycDocType) {
    await this.customers.load(customerId);
    const d = await this.prisma.kycDocument.findUnique({
      where: { customerId_type: { customerId, type } },
      include: { files: true },
    });
    if (!d) throw new NotFoundException({ code: "NOT_FOUND", message: "Document not found" });
    return d;
  }

  async verify(actor: AuthUser, customerId: string, type: KycDocType, ctx: ReqCtx) {
    const d = await this.getDoc(customerId, type);
    if (!d.numberEnc && d.files.length === 0)
      throw new BadRequestException({
        code: "EMPTY_DOCUMENT",
        message: "Nothing to verify: add a number or a file first",
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.kycDocument.update({
        where: { id: d.id },
        data: { status: "VERIFIED", verifiedAt: new Date(), verifiedById: actor.id, rejectionReason: null },
      });
      await this.customers.refresh(tx, customerId);
      await this.audit.record(
        ctx,
        {
          action: "kyc.verify",
          entity: "KycDocument",
          entityId: customerId,
          before: { type, status: d.status },
          after: { type, status: "VERIFIED" },
        },
        tx,
      );
    });
    return this.result(actor, customerId);
  }

  async reject(actor: AuthUser, customerId: string, type: KycDocType, reason: string, ctx: ReqCtx) {
    const d = await this.getDoc(customerId, type);
    await this.prisma.$transaction(async (tx) => {
      await tx.kycDocument.update({
        where: { id: d.id },
        data: { status: "REJECTED", rejectionReason: reason, verifiedAt: null, verifiedById: null },
      });
      await this.customers.refresh(tx, customerId);
      await this.audit.record(
        ctx,
        {
          action: "kyc.reject",
          entity: "KycDocument",
          entityId: customerId,
          before: { type, status: d.status },
          after: { type, status: "REJECTED", reason },
        },
        tx,
      );
    });
    return this.result(actor, customerId);
  }

  /** Issues a 60-second signed link. Every issuance is audited so document access is traceable. */
  async fileUrl(fileId: string, ctx: ReqCtx) {
    const f = await this.prisma.customerFile.findUnique({
      where: { id: fileId },
      include: { customer: { select: { deletedAt: true } } },
    });
    if (!f || f.customer.deletedAt) throw new NotFoundException({ code: "NOT_FOUND", message: "File not found" });
    await this.audit.record(ctx, {
      action: "kyc.file_viewed",
      entity: "KycDocument",
      entityId: f.customerId,
      after: { fileId },
    });
    return this.storage.signedUrl(fileId);
  }

  async readFile(fileId: string) {
    const f = await this.prisma.customerFile.findUnique({
      where: { id: fileId },
      include: { customer: { select: { deletedAt: true } } },
    });
    if (!f || f.customer.deletedAt) throw new NotFoundException();
    return { meta: f, data: await this.storage.driver.get(f.storageKey) };
  }
}
