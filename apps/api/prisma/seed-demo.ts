import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { ALL_PERMISSIONS, addDays, addMonths, verhoeffAppend, type WizardStep } from "@jana/shared";
import { AppModule } from "../src/app.module";
import { CustomersService } from "../src/customers/customers.service";
import { KycService } from "../src/customers/kyc.service";
import { UsersService } from "../src/users/users.service";
import { ChitCollectionService } from "../src/chits/chit-collection.service";
import { ChitService } from "../src/chits/chit.service";
import { today } from "../src/chits/chit.util";
import { env } from "../src/config/env";
import { LoanPaymentsService } from "../src/loans/loan-payments.service";
import { LoansService } from "../src/loans/loans.service";
import type { AuthUser, ReqCtx } from "../src/common/decorators";

/**
 * Demo data: 2 extra staff, and 30 customers with a realistic mix of KYC states, risk grades and drafts.
 * Runs through the real services (validation, encryption, derived fields, audit), so the data is exactly what the app
 * would have produced. Idempotent: does nothing if demo customers already exist.
 *   pnpm --filter @jana/api seed:demo
 */
env(); // load .env before Prisma reads DATABASE_URL
const prisma = new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 120_000 } });
const DEMO_DOMAIN = "@demo.jana";
export const DEMO_STAFF_PASSWORD = "Demo!Passw0rd#1";

// 1x1 PNG: a valid image so previews work
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const file = (name: string) =>
  ({ buffer: PNG, size: PNG.length, originalname: name }) as unknown as Express.Multer.File;

const FIRST = [
  "Arun",
  "Meena",
  "Karthik",
  "Lakshmi",
  "Suresh",
  "Divya",
  "Ramesh",
  "Priya",
  "Vijay",
  "Anitha",
  "Murugan",
  "Kavitha",
  "Senthil",
  "Revathi",
  "Gopal",
  "Saranya",
  "Manoj",
  "Deepa",
  "Bala",
  "Nithya",
  "Ganesh",
  "Shanthi",
  "Prakash",
  "Uma",
  "Selvam",
  "Jothi",
  "Dinesh",
  "Malar",
  "Kumar",
  "Vasanthi",
];
const LAST = ["Raman", "Kumari", "Subramani", "Devi", "Pillai", "Rajan", "Nadar", "Iyer", "Mudaliar", "Chettiar"];
const DISTRICTS = ["Kanchipuram", "Chennai", "Chengalpattu", "Vellore", "Tiruvallur", "Ranipet"];
const OCCUPATIONS = ["SALARIED", "SELF_EMPLOYED", "BUSINESS", "FARMER", "SALARIED", "RETIRED"] as const;
const BANKS = [
  ["State Bank of India", "SBIN0001234"],
  ["Indian Bank", "IDIB000K123"],
  ["HDFC Bank", "HDFC0001234"],
  ["Canara Bank", "CNRB0001234"],
] as const;

const L = (i: number, n: number) =>
  String(i * 7919 + n)
    .padStart(10, "0")
    .slice(-10);
const aadhaar = (i: number) => verhoeffAppend(`${2 + (i % 8)}${L(i, 31337).slice(0, 10)}`);
const pan = (i: number) =>
  `${"ABCDEFGHJK"[i % 10]}${"LMNPQRSTUV"[(i * 3) % 10]}${"ABCDEFGHJK"[(i * 7) % 10]}${"PCHFATBLJG"[(i * 2) % 10]}${"KMNRSTUVWX"[i % 10]}${String(1000 + i * 37).slice(-4)}${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i % 24]}`;

/** KYC profile per customer: what documents exist and their review state. */
type Kyc = "verified" | "complete" | "photo_missing" | "rejected" | "expired";
const KYC_MIX: Kyc[] = [
  "verified",
  "verified",
  "verified",
  "complete",
  "photo_missing",
  "verified",
  "complete",
  "rejected",
  "verified",
  "photo_missing",
  "verified",
  "complete",
  "expired",
  "verified",
  "verified",
  "complete",
  "photo_missing",
  "verified",
  "verified",
  "complete",
  "verified",
  "rejected",
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const superAdmin = await prisma.user.findFirst({ where: { role: { locked: true } }, include: { role: true } });
    if (!superAdmin) throw new Error("Run the base seed first (pnpm db:seed).");

    const actor: AuthUser = {
      id: superAdmin.id,
      email: superAdmin.email,
      name: "Demo seeder",
      roleId: superAdmin.roleId,
      roleName: "Super Admin",
      roleLocked: true,
      permissions: [...ALL_PERMISSIONS],
      sessionId: "seed",
      setupPending: false,
    };
    const ctx: ReqCtx = { userId: superAdmin.id, userEmail: superAdmin.email, userAgent: "seed-demo" };
    const customers = app.get(CustomersService);
    const kyc = app.get(KycService);
    const users = app.get(UsersService);

    const haveCustomers = (await prisma.customer.count({ where: { email: { endsWith: DEMO_DOMAIN } } })) > 0;
    if (haveCustomers) console.log("Demo customers already present; skipping them.");

    // Extra staff so role-based access can be demonstrated.
    for (const [key, first, email] of [
      ["manager", "Meera", `meera${DEMO_DOMAIN}`],
      ["staff", "Sathish", `sathish${DEMO_DOMAIN}`],
    ] as const) {
      const role = await prisma.role.findUnique({ where: { key } });
      if (role && !(await prisma.user.findUnique({ where: { email } }))) {
        await users.create(
          actor,
          {
            firstName: first,
            lastName: "Demo",
            email,
            phone: "9840000000",
            roleId: role.id,
            mode: "password",
            password: DEMO_STAFF_PASSWORD,
          },
          ctx,
        );
      }
    }

    const steps = async (id: string, upTo: number, i: number) => {
      const bank = BANKS[i % BANKS.length]!;
      const income = [18000, 25000, 32000, 45000, 60000, 85000, 0, 120000][i % 8]! * 100;
      const cibil = [820, 760, 730, 705, 690, 655, 640, 590, 810, 745, 610, 700][i % 12]!;
      const emi = [0, 3000, 8000, 12000, 20000, 30000][i % 6]! * 100;
      const all: [WizardStep, object][] = [
        [
          "basic",
          {
            firstName: FIRST[i % 30]!,
            lastName: LAST[i % LAST.length]!,
            gender: i % 3 === 1 || i % 5 === 2 ? "FEMALE" : "MALE",
            dob: `${1965 + ((i * 7) % 35)}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + ((i * 3) % 28)).padStart(2, "0")}`,
            phone: `9840${String(100000 + i * 137).slice(-6)}`,
            email: `${FIRST[i % 30]!.toLowerCase()}${i}${DEMO_DOMAIN}`,
            maritalStatus: i % 4 === 0 ? "SINGLE" : "MARRIED",
          },
        ],
        [
          "address",
          {
            currentAddress: `${10 + i}, ${["Gandhi", "Nehru", "Anna", "Periyar"][i % 4]} Street`,
            permanentAddress: `${10 + i}, ${["Gandhi", "Nehru", "Anna", "Periyar"][i % 4]} Street`,
            state: "Tamil Nadu",
            district: DISTRICTS[i % DISTRICTS.length]!,
            pincode: String(631501 + (i % 6)),
            landmark: "Near bus stand",
            residenceType: i % 3 === 0 ? "RENTED" : "OWN",
          },
        ],
        ["kyc", { aadhaar: aadhaar(i), pan: pan(i) }],
        [
          "employment",
          {
            occupationType: OCCUPATIONS[i % OCCUPATIONS.length],
            companyName: i % 2 ? "Sri Lakshmi Traders" : "",
            monthlyIncomePaise: income,
            additionalIncomePaise: i % 5 === 0 ? 5000_00 : 0,
            bank: { bankName: bank[0], accountNumber: `${30000000000 + i * 104729}`, ifsc: bank[1] },
          },
        ],
        [
          "references",
          {
            fatherName: `${FIRST[(i + 3) % 30]}`,
            motherName: `${FIRST[(i + 5) % 30]}`,
            nomineeName: `${FIRST[(i + 7) % 30]}`,
            nomineeRelation: "Spouse",
            references: [{ name: `${FIRST[(i + 9) % 30]}`, mobile: `9841${String(100000 + i * 91).slice(-6)}` }],
          },
        ],
        ["evaluation", { cibilScore: cibil, existingLoans: i % 3, monthlyEmiPaise: emi, consentGiven: true }],
      ];
      for (const [step, body] of all.slice(0, upTo)) await customers.saveStep(actor, id, step, body, ctx);
    };

    const upload = (id: string, type: Parameters<KycService["uploadFile"]>[2], label: string) =>
      kyc.uploadFile(actor, id, type, file(`${type.toLowerCase()}-${label}.png`), label, ctx);

    if (!haveCustomers) {
      // 30 real customers (27 active, 3 inactive) and 6 partially saved drafts.
      for (let i = 0; i < 30; i++) {
        const created = await customers.create(actor, {}, ctx);
        await steps(created.id, 6, i);
        const profile = KYC_MIX[i % KYC_MIX.length]!;
        if (profile !== "photo_missing") await upload(created.id, "PHOTO", "selfie");
        await upload(created.id, "AADHAAR", "front");
        if (profile !== "photo_missing") await upload(created.id, "AADHAAR", "back");
        await upload(created.id, "PAN", "card");
        if (i % 2 === 0) await upload(created.id, "ADDRESS_PROOF", "proof");

        await customers.submit(actor, created.id, true, ctx);
        if (profile === "verified")
          for (const t of ["AADHAAR", "PAN", "PHOTO"] as const) await kyc.verify(actor, created.id, t, ctx);
        if (profile === "rejected") {
          await kyc.verify(actor, created.id, "AADHAAR", ctx);
          await kyc.reject(actor, created.id, "PAN", "PAN image is not readable, please upload again", ctx);
        }
        if (profile === "expired") {
          await kyc.verify(actor, created.id, "PAN", ctx);
          await prisma.kycDocument.update({
            where: { customerId_type: { customerId: created.id, type: "AADHAAR" } },
            data: { status: "EXPIRED" },
          });
          await prisma.$transaction((tx) => customers.refresh(tx, created.id));
        }
        if (i >= 27) await customers.setStatus(actor, created.id, "INACTIVE", ctx);
      }
      // Drafts at different stages of the wizard.
      for (let j = 0; j < 6; j++) {
        const i = 30 + j;
        const created = await customers.create(actor, {}, ctx);
        await steps(created.id, [1, 2, 3, 3, 4, 5][j]!, i);
        if (j % 3 === 0) await upload(created.id, "AADHAAR", "front");
      }

      const [total, drafts] = [
        await prisma.customer.count(),
        await prisma.customer.count({ where: { status: "DRAFT" } }),
      ];
      console.log(
        `Created demo data: ${total - drafts} customers + ${drafts} drafts, and 2 staff users (meera/sathish${DEMO_DOMAIN}, password ${DEMO_STAFF_PASSWORD}).`,
      );
    }

    await seedChits(actor, ctx, app.get(ChitService), app.get(ChitCollectionService));
    await seedLoans(actor, ctx, app.get(LoansService), app.get(LoanPaymentsService));
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

/**
 * Six loans in different states, dated relative to today so the demo always looks current: one up to date, one behind
 * on interest, one with a part repayment, one closed, one waiting for approval and one approved but not yet paid out.
 */
async function seedLoans(actor: AuthUser, ctx: ReqCtx, loans: LoansService, pays: LoanPaymentsService) {
  if ((await prisma.loanProduct.count()) > 0) {
    console.log("Loan products already present; skipping loans.");
    return;
  }
  const people = await prisma.customer.findMany({
    where: { status: "ACTIVE", watchStatus: "NONE", kycStatus: "VERIFIED", email: { endsWith: DEMO_DOMAIN } },
    orderBy: { code: "asc" },
    take: 8,
  });
  if (people.length < 6) {
    console.log("Not enough verified demo customers for loans; skipping.");
    return;
  }
  const t = today();
  const ago = (days: number) => addDays(t, -days);
  const personal = await loans.createProduct(
    {
      name: "Personal loan",
      monthlyRateBp: 200,
      minRateBp: 100,
      maxRateBp: 300,
      minAmountPaise: 10_000_00,
      maxAmountPaise: 5_00_000_00,
      processingFeeBp: 100,
      processingFeeFlatPaise: 0,
      active: true,
      notes: "Standard 2% a month, fee 1%",
    },
    ctx,
  );
  const gold = await loans.createProduct(
    {
      name: "Gold loan",
      monthlyRateBp: 150,
      minRateBp: 100,
      maxRateBp: 200,
      minAmountPaise: 5_000_00,
      maxAmountPaise: 10_00_000_00,
      processingFeeBp: 0,
      processingFeeFlatPaise: 0,
      active: true,
      notes: "Against gold, 1.5% a month",
    },
    ctx,
  );

  const modes = ["CASH", "UPI", "CASH", "BANK_TRANSFER"] as const;
  let n = 0;
  async function apply(i: number, productId: string, principalPaise: number, rateBp: number, purpose: string) {
    const l = await loans.create(
      { customerId: people[i]!.id, productId, principalPaise, monthlyRateBp: rateBp, purpose },
      actor,
      ctx,
    );
    return l;
  }
  async function lend(
    i: number,
    productId: string,
    principalPaise: number,
    rateBp: number,
    purpose: string,
    daysAgo: number,
  ) {
    const l = await apply(i, productId, principalPaise, rateBp, purpose);
    await loans.approve(l.id, l.warnings.length ? "Demo: known customer" : undefined, actor, ctx);
    await loans.disburse(l.id, { mode: "CASH", disbursedOn: ago(daysAgo) }, actor, ctx);
    return { id: l.id, start: ago(daysAgo) };
  }
  /** Pays the interest due on the given month's due date, and optionally some principal with it. */
  async function collect(loanId: string, on: string, principalPaise = 0) {
    const v = await loans.get(loanId, on);
    const interestPaise = v.position?.interestDuePaise ?? 0;
    if (interestPaise + principalPaise <= 0) return;
    await pays.receive(
      loanId,
      { interestPaise, principalPaise, mode: modes[n++ % modes.length]!, paidOn: on },
      `demo-loan-${loanId}-${on}`,
      actor,
      ctx,
    );
  }
  const dueDates = (start: string) => {
    const out: string[] = [];
    for (let k = 1; addMonths(start, k) <= t; k++) out.push(addMonths(start, k));
    return out;
  };

  // A: up to date
  const a = await lend(0, personal.id, 1_00_000_00, 200, "Shop stock", 100);
  for (const d of dueDates(a.start)) await collect(a.id, d);
  await loans.addCollateral(
    a.id,
    { kind: "GOLD", description: "Gold ring 8 g", estimatedValuePaise: 55_000_00 },
    actor,
    ctx,
  );

  // B: only the first month paid, so it is behind
  const b = await lend(1, personal.id, 50_000_00, 300, "Medical expense", 100);
  const bDue = dueDates(b.start);
  if (bDue[0]) await collect(b.id, bDue[0]);
  await loans.addCollateral(
    b.id,
    { kind: "VEHICLE", description: "Two-wheeler RC book", estimatedValuePaise: 40_000_00 },
    actor,
    ctx,
  );

  // C: gold loan, on time, with Rs 50,000 of principal repaid along with the third month's interest
  const c = await lend(2, gold.id, 2_00_000_00, 150, "Business", 130);
  for (const [i, d] of dueDates(c.start).entries()) await collect(c.id, d, i === 2 ? 50_000_00 : 0);
  await loans.addCollateral(
    c.id,
    { kind: "GOLD", description: "Gold chain 32 g, 22 carat", estimatedValuePaise: 2_40_000_00 },
    actor,
    ctx,
  );

  // D: closed
  const d = await lend(3, personal.id, 30_000_00, 200, "School fees", 120);
  for (const due of dueDates(d.start)) await collect(d.id, due);
  const closeOn = ago(15);
  const q = await pays.payoff(d.id, closeOn);
  await pays.receive(
    d.id,
    { interestPaise: q.interestPaise, principalPaise: q.principalPaise, mode: "CASH", paidOn: closeOn },
    `demo-loan-${d.id}-close`,
    actor,
    ctx,
  );

  // E waiting for approval, F approved but not paid out
  await apply(4, personal.id, 25_000_00, 200, "Festival expenses");
  const f = await apply(5, personal.id, 75_000_00, 200, "Home repair");
  await loans.approve(f.id, f.warnings.length ? "Demo: known customer" : undefined, actor, ctx);
  console.log("Created demo loans: 2 products and 6 loans in different states.");
}

/** Two running chit groups with several months of history: collections, a member in arrears, and payouts at each stage. */
async function seedChits(actor: AuthUser, ctx: ReqCtx, chit: ChitService, coll: ChitCollectionService) {
  if ((await prisma.chitGroup.count()) > 0) {
    console.log("Chit groups already present; skipping them.");
    return;
  }
  const people = await prisma.customer.findMany({
    where: {
      status: "ACTIVE",
      watchStatus: "NONE",
      kycStatus: { in: ["COMPLETE", "VERIFIED"] },
      email: { endsWith: DEMO_DOMAIN },
    },
    orderBy: { code: "asc" },
  });
  if (people.length < 5) {
    console.log("Not enough eligible demo customers for chit groups; skipping.");
    return;
  }
  const now = new Date();
  const startOf = (monthsAgo: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)).toISOString().slice(0, 10);
  const modes = ["CASH", "UPI", "CASH", "BANK_TRANSFER"] as const;
  let n = 0;

  async function build(opts: {
    name: string;
    type: "AUCTION" | "FIXED" | "LOTTERY";
    value: number;
    members: number;
    startMonthsAgo: number;
    day: number;
    heldMonths: number;
    offset: number;
  }) {
    const g = await chit.create(
      actor,
      {
        name: opts.name,
        type: opts.type,
        chitValuePaise: opts.value,
        members: opts.members,
        durationMonths: opts.members,
        monthlySubscriptionPaise: opts.value / opts.members,
        commissionBp: 500,
        minBidBp: 500,
        maxBidBp: 4000,
        startDate: startOf(opts.startMonthsAgo),
        auctionDay: opts.day,
        dueDaysAfterAuction: 5,
        penaltyRateBp: 200,
        penaltyGraceDays: 3,
        registrationFeePaise: 0,
      },
      ctx,
    );
    await chit.setStatus(g.id, "open", undefined, ctx);
    for (let i = 0; i < opts.members; i++)
      await chit.enrol(g.id, { customerId: people[(opts.offset + i) % people.length]!.id }, ctx);
    await chit.start(g.id, ctx);
    const tickets = await prisma.chitTicket.findMany({ where: { groupId: g.id }, orderBy: { number: "asc" } });
    const commission = (opts.value * 500) / 10_000;

    for (let month = 1; month <= opts.heldMonths; month++) {
      if (opts.type === "AUCTION") {
        const detail = await chit.cycleDetail(g.id, month);
        const bidders = detail.eligible.filter((e) => !e.inArrears).slice(0, 3);
        for (const [i, b] of bidders.entries())
          await chit.recordBid(
            g.id,
            month,
            { ticketId: b.ticketId, discountPaise: Math.round(commission * (2 + i * 0.5)) },
            actor,
            ctx,
          );
      }
      await chit.closeAuction(g.id, month, undefined, actor, ctx);

      const cycle = await prisma.chitCycle.findUniqueOrThrow({ where: { groupId_month: { groupId: g.id, month } } });
      const due = cycle.dueDate.toISOString().slice(0, 10);
      const paidOn = due < today() ? due : today();
      for (const t of tickets) {
        // Ticket 5 falls behind from month 2, and ticket 7 pays half in month 1: realistic arrears for the collector's list.
        if (t.number === 5 && month >= 2) continue;
        const d = await coll.dues(t.id, paidOn);
        if (d.outstandingPaise <= 0) continue;
        const half = t.number === 7 && month === 1;
        await coll.receive(
          t.id,
          {
            amountPaise: half ? Math.floor(d.outstandingPaise / 2) : d.totalPayablePaise,
            mode: modes[n++ % modes.length]!,
            paidOn,
          },
          `seed-${g.code}-${month}-${t.number}`,
          actor,
          ctx,
        );
      }
    }
    // Pay out every held month except the latest, which stays pending so approvals can be demonstrated.
    const payouts = await prisma.chitPayout.findMany({
      where: { groupId: g.id },
      include: { cycle: true },
      orderBy: { cycle: { month: "asc" } },
    });
    for (const p of payouts.slice(0, -1)) {
      await coll.approvePayout(p.id, { securityVerified: true, note: "Demo: guarantor documents checked" }, actor, ctx);
      await coll.payPayout(p.id, { mode: "CASH", reference: `Voucher ${p.cycle.month}` }, actor, ctx);
    }
    return g.code;
  }

  const a = await build({
    name: "Kanchi Gold 1 Lakh",
    type: "AUCTION",
    value: 100_000_00,
    members: 10,
    startMonthsAgo: 3,
    day: 5,
    heldMonths: 4,
    offset: 0,
  });
  const b = await build({
    name: "Temple Street 50K",
    type: "FIXED",
    value: 50_000_00,
    members: 10,
    startMonthsAgo: 2,
    day: 12,
    heldMonths: 3,
    offset: 10,
  });
  console.log(
    `Created chit groups ${a} (auction, 4 months held) and ${b} (fixed order, 3 months held), with collections, one member in arrears and payouts.`,
  );
}

void main();
