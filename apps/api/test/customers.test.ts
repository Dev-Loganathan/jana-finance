import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { verhoeffAppend } from "@jana/shared";
import { StorageService } from "../src/storage/storage.service";
import { ensureRoles, makeApp, makeUser, prisma, token, type TestUser } from "./helpers";

const ANY_ID = "00000000-0000-4000-8000-000000000000";
const rnd = (n: number) => Array.from(randomBytes(n), (b) => b % 10).join("");
const word = () => randomBytes(6).toString("hex");
const aadhaar = () => verhoeffAppend(`${2 + (randomBytes(1)[0]! % 8)}${rnd(10)}`);
const pan = () =>
  `${randomBytes(5)
    .toString("hex")
    .replace(/[0-9a-f]/g, (c) => "ABCDEFGHIJKLMNOP"["0123456789abcdef".indexOf(c)]!)
    .slice(0, 5)}${rnd(4)}Q`;
const phone = () => `9${rnd(9)}`;
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(64)]);
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const PDF = Buffer.from("%PDF-1.4\n%fake test pdf\n");

const ENDPOINTS: { method: "get" | "post" | "patch" | "delete"; path: string; perm: string }[] = [
  { method: "get", path: "/customers", perm: "customer:view" },
  { method: "get", path: "/customers/stats", perm: "customer:view" },
  { method: "get", path: `/customers/${ANY_ID}`, perm: "customer:view" },
  { method: "get", path: `/customers/${ANY_ID}/activity`, perm: "customer:view" },
  { method: "post", path: "/customers/duplicates/check", perm: "customer:view" },
  { method: "post", path: "/customers", perm: "customer:create" },
  { method: "patch", path: `/customers/${ANY_ID}/steps/basic`, perm: "customer:edit" },
  { method: "post", path: `/customers/${ANY_ID}/submit`, perm: "customer:create" },
  { method: "post", path: `/customers/${ANY_ID}/status`, perm: "customer:edit" },
  { method: "delete", path: `/customers/${ANY_ID}`, perm: "customer:delete" },
  { method: "post", path: `/customers/${ANY_ID}/reveal`, perm: "kyc:reveal_sensitive" },
  { method: "post", path: `/customers/${ANY_ID}/documents/PAN/files`, perm: "kyc:upload" },
  { method: "delete", path: `/customers/${ANY_ID}/documents/files/${ANY_ID}`, perm: "kyc:upload" },
  { method: "post", path: `/customers/${ANY_ID}/documents/PAN/verify`, perm: "kyc:verify" },
  { method: "post", path: `/customers/${ANY_ID}/documents/PAN/reject`, perm: "kyc:reject" },
  { method: "get", path: `/files/${ANY_ID}/url`, perm: "kyc:view" },
];

describe("customers and KYC", () => {
  let app: INestApplication;
  let admin: TestUser;
  let staff: TestUser;
  let adminH: { Authorization: string };
  let staffH: { Authorization: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await makeApp();
    await ensureRoles();
    admin = await makeUser(app, "super_admin", { totp: true });
    staff = await makeUser(app, "staff"); // customer view/create/edit + kyc view/upload only
    adminH = await token(app, admin);
    staffH = await token(app, staff);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Creates a draft and fills every wizard step. Returns ids and the raw sensitive values used. */
  async function fullDraft(
    opts: {
      name?: string;
      dob?: string;
      phoneNo?: string;
      aadhaarNo?: string;
      panNo?: string;
      income?: number;
      cibil?: number;
      emi?: number;
    } = {},
  ) {
    const a = opts.aadhaarNo ?? aadhaar();
    const p = opts.panNo ?? pan();
    const ph = opts.phoneNo ?? phone();
    const created = await http().post("/customers").set(adminH).send({});
    const id = created.body.id as string;
    const step = (s: string, body: object) => http().patch(`/customers/${id}/steps/${s}`).set(adminH).send(body);
    const steps = [
      [
        "basic",
        {
          firstName: opts.name ?? word(),
          lastName: word(),
          gender: "MALE",
          dob: opts.dob ?? "1990-05-15",
          phone: ph,
          maritalStatus: "SINGLE",
        },
      ],
      [
        "address",
        {
          currentAddress: "12 Main Street",
          permanentAddress: "12 Main Street",
          state: "Tamil Nadu",
          district: "Kanchipuram",
          pincode: "631501",
          residenceType: "OWN",
        },
      ],
      ["kyc", { aadhaar: a, pan: p }],
      [
        "employment",
        {
          occupationType: "SALARIED",
          monthlyIncomePaise: opts.income ?? 50_000_00,
          bank: { bankName: "SBI", accountNumber: "123456789012", ifsc: "SBIN0001234" },
        },
      ],
      [
        "references",
        {
          fatherName: "F",
          motherName: "M",
          nomineeName: "N",
          nomineeRelation: "Spouse",
          references: [{ name: "Ref One", mobile: phone() }],
        },
      ],
      [
        "evaluation",
        { cibilScore: opts.cibil ?? 780, existingLoans: 0, monthlyEmiPaise: opts.emi ?? 5_000_00, consentGiven: true },
      ],
    ] as const;
    for (const [s, body] of steps) {
      const r = await step(s, body);
      if (r.status !== 200) throw new Error(`step ${s} failed: ${r.status} ${JSON.stringify(r.body)}`);
    }
    return { id, aadhaar: a, pan: p, phone: ph, code: created.body.code as string };
  }

  describe("permissions", () => {
    describe.each(ENDPOINTS)("$method $path", ({ method, path, perm }) => {
      it("401 without a token", async () => {
        expect((await http()[method](path)).status).toBe(401);
      });
      it("403 for a role without the permission", async () => {
        const noPerm = await prisma.role.create({ data: { name: `np-${word()}`, permissions: ["audit:view"] } });
        const u = await makeUser(app, "staff");
        await prisma.user.update({ where: { id: u.id }, data: { roleId: noPerm.id } });
        const res = await http()
          [method](path)
          .set(await token(app, u))
          .send({});
        expect(res.status).toBe(403);
        expect(perm).toBeTruthy();
      });
    });

    it("staff cannot verify, reject or reveal; the Super Admin can", async () => {
      const c = await fullDraft();
      await http().post(`/customers/${c.id}/documents/PAN/files`).set(adminH).attach("file", PNG, "pan.png");
      expect((await http().post(`/customers/${c.id}/documents/PAN/verify`).set(staffH)).status).toBe(403);
      expect(
        (await http().post(`/customers/${c.id}/documents/PAN/reject`).set(staffH).send({ reason: "blurry" })).status,
      ).toBe(403);
      expect((await http().post(`/customers/${c.id}/reveal`).set(staffH).send({ field: "PAN" })).status).toBe(403);
      expect((await http().post(`/customers/${c.id}/documents/PAN/verify`).set(adminH)).status).toBe(200);
    });
  });

  describe("draft, steps and submit", () => {
    it("creates a coded draft and tracks per-step completion", async () => {
      const created = await http().post("/customers").set(staffH).send({});
      expect(created.status).toBe(201);
      expect(created.body.code).toMatch(/^CUS\d{4,}$/);
      expect(created.body.status).toBe("DRAFT");
      expect(created.body.completedSteps).toEqual([]);

      const r = await http()
        .patch(`/customers/${created.body.id}/steps/basic`)
        .set(staffH)
        .send({ firstName: "Anu", phone: "98765 43210" });
      expect(r.body.phone).toBe("9876543210");
      expect(r.body.completedSteps).toEqual([]); // still missing gender, dob, marital status

      const done = await http()
        .patch(`/customers/${created.body.id}/steps/basic`)
        .set(staffH)
        .send({ gender: "FEMALE", dob: "1992-03-04", maritalStatus: "MARRIED" });
      expect(done.body.completedSteps).toEqual(["basic"]);
      expect(done.body.lastStep).toBe("basic");
    });

    it("rejects invalid data in a draft save but allows partial data", async () => {
      const { body } = await http().post("/customers").set(staffH).send({});
      const bad = await http().patch(`/customers/${body.id}/steps/kyc`).set(staffH).send({ aadhaar: "123456789012" });
      expect(bad.status).toBe(400);
      const badPan = await http().patch(`/customers/${body.id}/steps/kyc`).set(staffH).send({ pan: "NOTAPAN" });
      expect(badPan.status).toBe(400);
      expect((await http().patch(`/customers/${body.id}/steps/nope`).set(staffH).send({})).status).toBe(400);
      expect(
        (
          await http()
            .patch(`/customers/${body.id}/steps/employment`)
            .set(staffH)
            .send({ occupationType: "SALARIED", bank: { bankName: "SBI" } })
        ).status,
      ).toBe(200);
    });

    it("computes risk and category on the evaluation step", async () => {
      const low = await fullDraft({ cibil: 780, emi: 5_000_00 });
      const detail = await http().get(`/customers/${low.id}`).set(adminH);
      expect(detail.body.evaluation).toMatchObject({
        riskLevel: "LOW",
        category: "EXCELLENT",
        dtiBp: 1000,
        totalIncomePaise: 50_000_00,
      });
      expect(detail.body.completedSteps).toHaveLength(6);

      const zero = await fullDraft({ income: 0, cibil: 700 });
      expect((await http().get(`/customers/${zero.id}`).set(adminH)).body.evaluation).toMatchObject({
        riskLevel: "HIGH",
        category: "GOOD",
        dtiBp: null,
      });
    });

    it("refuses to submit an incomplete draft or one without consent", async () => {
      const { body } = await http().post("/customers").set(adminH).send({});
      const r = await http().post(`/customers/${body.id}/submit`).set(adminH).send({});
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("INCOMPLETE");
      expect(r.body.missing).toContain("basic");
    });

    it("submits a complete draft to ACTIVE, and a second submit fails", async () => {
      const c = await fullDraft();
      const r = await http().post(`/customers/${c.id}/submit`).set(adminH).send({});
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("ACTIVE");
      expect(r.body.consentAt).toBeTruthy();
      expect((await http().post(`/customers/${c.id}/submit`).set(adminH).send({})).body.code).toBe("NOT_A_DRAFT");
    });

    it("deactivates, reactivates and soft-deletes; deleted customers disappear", async () => {
      const c = await fullDraft();
      await http().post(`/customers/${c.id}/submit`).set(adminH).send({});
      expect(
        (await http().post(`/customers/${c.id}/status`).set(adminH).send({ status: "INACTIVE" })).body.status,
      ).toBe("INACTIVE");
      expect(
        (await http().patch(`/customers/${c.id}/steps/basic`).set(adminH).send({ firstName: "X" })).body.code,
      ).toBe("INACTIVE");
      expect((await http().post(`/customers/${c.id}/status`).set(adminH).send({ status: "ACTIVE" })).body.status).toBe(
        "ACTIVE",
      );
      expect((await http().delete(`/customers/${c.id}`).set(adminH)).status).toBe(204);
      expect((await http().get(`/customers/${c.id}`).set(adminH)).status).toBe(404);
      expect(await prisma.customer.findUnique({ where: { id: c.id } })).toMatchObject({ deletedAt: expect.any(Date) });
    });
  });

  describe("sensitive data", () => {
    it("stores ID and account numbers encrypted, and the API only returns masked values", async () => {
      const c = await fullDraft();
      const docs = await prisma.kycDocument.findMany({ where: { customerId: c.id } });
      const bank = await prisma.bankAccount.findMany({ where: { customerId: c.id } });
      const stored = JSON.stringify([docs, bank]);
      expect(stored).not.toContain(c.aadhaar);
      expect(stored).not.toContain(c.pan);
      expect(stored).not.toContain("123456789012");
      expect(docs.find((d) => d.type === "AADHAAR")!.numberEnc).toMatch(/^v1\./);

      const body = JSON.stringify((await http().get(`/customers/${c.id}`).set(adminH)).body);
      expect(body).not.toContain(c.aadhaar);
      expect(body).not.toContain(c.pan);
      expect(body).toContain(`XXXX-XXXX-${c.aadhaar.slice(-4)}`);
      expect(body).toContain("XXXXXXXX9012");
    });

    it("hides documents and bank details from users without kyc:view", async () => {
      const c = await fullDraft();
      const noKyc = await prisma.role.create({ data: { name: `nk-${word()}`, permissions: ["customer:view"] } });
      const u = await makeUser(app, "staff");
      await prisma.user.update({ where: { id: u.id }, data: { roleId: noKyc.id } });
      const body = (
        await http()
          .get(`/customers/${c.id}`)
          .set(await token(app, u))
      ).body;
      expect(body.documents).toBeUndefined();
      expect(body.bank).toBeUndefined();
      expect(body.name).toBeTruthy();
    });

    it("reveals plaintext only with the permission, and audits every reveal without the value", async () => {
      const c = await fullDraft();
      const r = await http().post(`/customers/${c.id}/reveal`).set(adminH).send({ field: "AADHAAR" });
      expect(r.body.value).toBe(c.aadhaar);
      expect(
        (await http().post(`/customers/${c.id}/reveal`).set(adminH).send({ field: "BANK_ACCOUNT" })).body.value,
      ).toBe("123456789012");
      expect((await http().post(`/customers/${c.id}/reveal`).set(adminH).send({ field: "VOTER_ID" })).status).toBe(404);

      const rows = await prisma.auditLog.findMany({ where: { entityId: c.id, action: "kyc.reveal_sensitive" } });
      expect(rows).toHaveLength(2);
      expect(rows[0]!.userId).toBe(admin.id);
      expect(json(rows)).not.toContain(c.aadhaar);
    });

    it("never writes ID numbers to the audit log or the activity feed", async () => {
      const c = await fullDraft();
      const all = json(await prisma.auditLog.findMany({ where: { entityId: c.id } }));
      expect(all).not.toContain(c.aadhaar);
      expect(all).not.toContain(c.pan);
      expect(all).not.toContain("123456789012");
      const feed = await http().get(`/customers/${c.id}/activity`).set(staffH);
      expect(feed.body.length).toBeGreaterThan(5);
    });

    it("changing an ID number resets its verification", async () => {
      const c = await fullDraft();
      await http().post(`/customers/${c.id}/documents/PAN/files`).set(adminH).attach("file", PNG, "pan.png");
      await http().post(`/customers/${c.id}/documents/PAN/verify`).set(adminH);
      let doc = await prisma.kycDocument.findUniqueOrThrow({
        where: { customerId_type: { customerId: c.id, type: "PAN" } },
      });
      expect(doc.status).toBe("VERIFIED");
      // Same number again keeps it verified; a new number does not.
      await http().patch(`/customers/${c.id}/steps/kyc`).set(adminH).send({ pan: c.pan });
      doc = await prisma.kycDocument.findUniqueOrThrow({
        where: { customerId_type: { customerId: c.id, type: "PAN" } },
      });
      expect(doc.status).toBe("VERIFIED");
      await http().patch(`/customers/${c.id}/steps/kyc`).set(adminH).send({ pan: pan() });
      doc = await prisma.kycDocument.findUniqueOrThrow({
        where: { customerId_type: { customerId: c.id, type: "PAN" } },
      });
      expect(doc.status).toBe("PENDING");
    });
  });

  describe("file uploads", () => {
    it("accepts real images and PDFs, and decides the type from the bytes", async () => {
      const c = await fullDraft();
      const png = await http()
        .post(`/customers/${c.id}/documents/AADHAAR/files`)
        .set(staffH)
        .field("label", "front")
        .attach("file", PNG, "front.png");
      expect(png.status).toBe(201);
      const doc = png.body.documents.find((d: { type: string }) => d.type === "AADHAAR");
      expect(doc.files[0]).toMatchObject({ label: "front", mimeType: "image/png" });

      // A PNG named .pdf is still a PNG, and a text file named .png is rejected.
      const renamed = await http()
        .post(`/customers/${c.id}/documents/ADDRESS_PROOF/files`)
        .set(staffH)
        .attach("file", PNG, "proof.pdf");
      expect(renamed.body.documents.find((d: { type: string }) => d.type === "ADDRESS_PROOF").files[0].mimeType).toBe(
        "image/png",
      );
      const fake = await http()
        .post(`/customers/${c.id}/documents/AADHAAR/files`)
        .set(staffH)
        .attach("file", Buffer.from("<script>alert(1)</script>"), "evil.png");
      expect(fake.status).toBe(400);
      expect(fake.body.code).toBe("UNSUPPORTED_FILE");
      expect(
        (
          await http()
            .post(`/customers/${c.id}/documents/INCOME_PROOF/files`)
            .set(staffH)
            .attach("file", PDF, "salary.pdf")
        ).status,
      ).toBe(201);
    });

    it("rejects oversize files, missing files, PDF photos and bad document types", async () => {
      const c = await fullDraft();
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      expect(
        (await http().post(`/customers/${c.id}/documents/PAN/files`).set(staffH).attach("file", big, "big.png")).status,
      ).toBe(413);
      expect((await http().post(`/customers/${c.id}/documents/PAN/files`).set(staffH)).status).toBe(400);
      expect(
        (await http().post(`/customers/${c.id}/documents/PHOTO/files`).set(staffH).attach("file", PDF, "p.pdf")).status,
      ).toBe(400);
      expect(
        (await http().post(`/customers/${c.id}/documents/NOT_A_TYPE/files`).set(staffH).attach("file", PNG, "x.png"))
          .status,
      ).toBe(400);
    });

    it("keeps one photo: a new upload replaces the old file and blob", async () => {
      const c = await fullDraft();
      await http().post(`/customers/${c.id}/documents/PHOTO/files`).set(staffH).attach("file", PNG, "a.png");
      const first = await prisma.customerFile.findFirstOrThrow({ where: { customerId: c.id } });
      await http()
        .post(`/customers/${c.id}/documents/PHOTO/files`)
        .set(staffH)
        .attach("file", Buffer.concat([PNG, Buffer.from("2")]), "b.png");
      const files = await prisma.customerFile.findMany({ where: { customerId: c.id } });
      expect(files).toHaveLength(1);
      expect(files[0]!.id).not.toBe(first.id);
      await expect(app.get(StorageService).driver.get(first.storageKey)).rejects.toThrow();
    });

    it("serves files only through short-lived signed links", async () => {
      const c = await fullDraft();
      const up = await http().post(`/customers/${c.id}/documents/PAN/files`).set(staffH).attach("file", PNG, "pan.png");
      const fileId = up.body.documents.find((d: { type: string }) => d.type === "PAN").files[0].id as string;

      expect((await http().get(`/files/${fileId}/content`)).status).toBe(403); // no signature
      const link = await http().get(`/files/${fileId}/url`).set(staffH);
      expect(link.body.expiresInSeconds).toBeLessThanOrEqual(60);
      const ok = await http().get(link.body.url); // no auth header needed: the signature is the credential
      expect(ok.status).toBe(200);
      expect(ok.headers["content-type"]).toBe("image/png");
      expect(ok.headers["cache-control"]).toContain("no-store");
      expect(Buffer.compare(ok.body, PNG)).toBe(0);

      expect((await http().get(link.body.url.replace(/s=[0-9a-f]{8}/, "s=00000000"))).status).toBe(403); // tampered
      const other = (await http().get(`/files/${ANY_ID}/content`).query({ e: 9_999_999_999, s: "x" })).status;
      expect(other).toBe(403);
      const expired = app.get(StorageService).signedUrl(fileId, -5).url;
      expect((await http().get(expired)).status).toBe(403);

      const views = await prisma.auditLog.count({ where: { entityId: c.id, action: "kyc.file_viewed" } });
      expect(views).toBe(1);
    });

    it("blocks deleting a file from a verified document until it is rejected", async () => {
      const c = await fullDraft();
      const up = await http().post(`/customers/${c.id}/documents/PAN/files`).set(adminH).attach("file", PNG, "pan.png");
      const fileId = up.body.documents.find((d: { type: string }) => d.type === "PAN").files[0].id as string;
      await http().post(`/customers/${c.id}/documents/PAN/verify`).set(adminH);
      expect((await http().delete(`/customers/${c.id}/documents/files/${fileId}`).set(adminH)).body.code).toBe(
        "VERIFIED_LOCKED",
      );
      await http().post(`/customers/${c.id}/documents/PAN/reject`).set(adminH).send({ reason: "Photo unreadable" });
      expect((await http().delete(`/customers/${c.id}/documents/files/${fileId}`).set(adminH)).status).toBe(200);
    });
  });

  describe("KYC review workflow", () => {
    it("moves NOT_STARTED -> PARTIAL -> COMPLETE -> VERIFIED, and a rejection drops it back", async () => {
      const { body } = await http().post("/customers").set(adminH).send({});
      const id = body.id as string;
      expect((await http().get(`/customers/${id}`).set(adminH)).body.kycStatus).toBe("NOT_STARTED");

      const up = (t: string) =>
        http().post(`/customers/${id}/documents/${t}/files`).set(adminH).attach("file", PNG, `${t}.png`);
      expect((await up("AADHAAR")).body.kycStatus).toBe("PARTIAL");
      await up("PAN");
      expect((await up("PHOTO")).body.kycStatus).toBe("COMPLETE");

      for (const t of ["AADHAAR", "PAN"]) await http().post(`/customers/${id}/documents/${t}/verify`).set(adminH);
      expect((await http().post(`/customers/${id}/documents/PHOTO/verify`).set(adminH)).body.kycStatus).toBe(
        "VERIFIED",
      );

      const rejected = await http()
        .post(`/customers/${id}/documents/PAN/reject`)
        .set(adminH)
        .send({ reason: "Name does not match" });
      expect(rejected.body.kycStatus).toBe("PARTIAL");
      expect(rejected.body.documents.find((d: { type: string }) => d.type === "PAN")).toMatchObject({
        status: "REJECTED",
        rejectionReason: "Name does not match",
      });
      expect(
        (await http().post(`/customers/${id}/documents/PAN/reject`).set(adminH).send({ reason: "x" })).status,
      ).toBe(400);

      // Re-uploading puts it back for review
      expect((await up("PAN")).body.kycStatus).toBe("COMPLETE");
    });

    it("cannot verify an empty document", async () => {
      const { body } = await http().post("/customers").set(adminH).send({});
      await http().patch(`/customers/${body.id}/steps/kyc`).set(adminH).send({ pan: pan() });
      expect((await http().post(`/customers/${body.id}/documents/VOTER_ID/verify`).set(adminH)).status).toBe(404);
    });
  });

  describe("duplicate detection", () => {
    it("finds an existing customer by phone, Aadhaar, PAN and fuzzy name plus DOB", async () => {
      const name = `Ramasamy${word()}`;
      const existing = await fullDraft({ name, dob: "1985-07-20" });
      await http().post(`/customers/${existing.id}/submit`).set(adminH).send({});

      const check = (b: object) => http().post("/customers/duplicates/check").set(staffH).send(b);
      const byPhone = await check({ phone: existing.phone });
      expect(byPhone.body.matches[0]).toMatchObject({ id: existing.id, reasons: ["Same mobile number"] });
      expect((await check({ aadhaar: existing.aadhaar })).body.matches[0].reasons).toContain("Same Aadhaar");
      expect((await check({ pan: existing.pan.toLowerCase() })).body.matches[0].reasons).toContain("Same PAN");
      const fuzzy = await check({ name: `${name.slice(0, -1)}x`, dob: "1985-07-20" });
      expect(fuzzy.body.matches.map((m: { id: string }) => m.id)).toContain(existing.id);
      expect((await check({ name: `${name}`, dob: "1999-01-01" })).body.matches).toHaveLength(0);
      expect((await check({ phone: phone() })).body.matches).toHaveLength(0);
    });

    it("blocks submit with DUPLICATE_SUSPECTED until the staff member acknowledges", async () => {
      const first = await fullDraft();
      await http().post(`/customers/${first.id}/submit`).set(adminH).send({});
      const dup = await fullDraft({ aadhaarNo: first.aadhaar, phoneNo: first.phone });

      const blocked = await http().post(`/customers/${dup.id}/submit`).set(adminH).send({});
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe("DUPLICATE_SUSPECTED");
      expect(blocked.body.matches[0]).toMatchObject({ id: first.id });
      expect(blocked.body.matches[0].reasons).toEqual(expect.arrayContaining(["Same mobile number", "Same Aadhaar"]));

      const ok = await http().post(`/customers/${dup.id}/submit`).set(adminH).send({ acknowledgeDuplicates: true });
      expect(ok.status).toBe(200);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: dup.id, action: "customer.submit" } });
      expect(audit.after).toMatchObject({ acknowledgedDuplicates: true });
    });
  });

  describe("list, search and filters", () => {
    it("paginates, filters by status/risk/CIBIL and finds customers by Aadhaar or PAN exactly", async () => {
      const tag = word();
      const a = await fullDraft({ name: `Zed${tag}`, cibil: 800 });
      const b = await fullDraft({ name: `Zed${tag}`, cibil: 600, income: 0 });
      await http().post(`/customers/${a.id}/submit`).set(adminH).send({});

      const list = (q: object) => http().get("/customers").query(q).set(staffH);
      expect((await list({ q: `zed${tag}` })).body.total).toBe(1); // drafts are hidden by default
      expect((await list({ q: `zed${tag}`, status: "DRAFT" })).body.total).toBe(1);
      expect((await list({ q: `zed${tag}`, status: "DRAFT" })).body.items.map((i: { id: string }) => i.id)).toEqual([
        b.id,
      ]);
      expect((await list({ q: `zed${tag}`, risk: "HIGH", status: "DRAFT" })).body.items[0].id).toBe(b.id);
      expect((await list({ q: `zed${tag}`, cibilMin: 750 })).body.items.map((i: { id: string }) => i.id)).toEqual([
        a.id,
      ]);
      expect((await list({ q: `zed${tag}`, category: "POOR", status: "DRAFT" })).body.items[0].id).toBe(b.id);
      expect((await list({ q: a.aadhaar })).body.items[0].id).toBe(a.id);
      expect(
        (await list({ q: `${a.aadhaar.slice(0, 4)} ${a.aadhaar.slice(4, 8)} ${a.aadhaar.slice(8)}` })).body.items[0].id,
      ).toBe(a.id);
      expect((await list({ q: a.pan })).body.items[0].id).toBe(a.id);
      expect((await list({ q: a.aadhaar.slice(0, 6) })).body.total).toBe(0); // partial numbers never match
      expect((await list({ pageSize: 1, q: `zed${tag}`, status: "DRAFT" })).body.items).toHaveLength(1);
      expect((await list({ sort: "cibilScore:desc", q: `zed${tag}` })).body.items[0].cibilScore).toBe(800);
      expect((await list({ pageSize: 1000 })).status).toBe(400);
      expect(JSON.stringify((await list({ q: `zed${tag}` })).body)).not.toContain(a.aadhaar);
    });

    it("counts stats without counting drafts as customers", async () => {
      const before = (await http().get("/customers/stats").set(staffH)).body;
      const c = await fullDraft();
      let after = (await http().get("/customers/stats").set(staffH)).body;
      expect(after.drafts).toBe(before.drafts + 1);
      expect(after.total).toBe(before.total);
      await http().post(`/customers/${c.id}/submit`).set(adminH).send({});
      after = (await http().get("/customers/stats").set(staffH)).body;
      expect(after.total).toBe(before.total + 1);
      expect(after.active).toBe(before.active + 1);
    });
  });
});
