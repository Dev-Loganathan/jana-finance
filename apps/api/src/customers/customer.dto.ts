import type { BankAccount, Customer, CustomerFile, CustomerReference, KycDocument } from "@prisma/client";
import { maskId, type KycNumberedType } from "@jana/shared";

export type FullCustomer = Customer & {
  documents: (KycDocument & { files: CustomerFile[] })[];
  bank: BankAccount[];
  references: CustomerReference[];
};

const n = (v: bigint) => Number(v);
const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * API shape for a customer. Sensitive numbers are only ever masked here; plaintext comes solely from the
 * audited reveal endpoint. Documents and bank details are included only for users holding kyc:view.
 */
export function toCustomerDto(c: FullCustomer, opts: { canSeeKyc: boolean }) {
  return {
    id: c.id,
    code: c.code,
    status: c.status,
    firstName: c.firstName,
    lastName: c.lastName,
    name: `${c.firstName} ${c.lastName}`.trim(),
    gender: c.gender,
    dob: date(c.dob),
    phone: c.phone,
    altPhone: c.altPhone,
    email: c.email,
    maritalStatus: c.maritalStatus,
    address: {
      currentAddress: c.currentAddress,
      permanentAddress: c.permanentAddress,
      country: c.country,
      state: c.state,
      district: c.district,
      pincode: c.pincode,
      landmark: c.landmark,
      residenceType: c.residenceType,
    },
    employment: {
      occupationType: c.occupationType,
      companyName: c.companyName,
      designation: c.designation,
      workExperience: c.workExperience,
      monthlyIncomePaise: n(c.monthlyIncomePaise),
      additionalIncomePaise: n(c.additionalIncomePaise),
      businessName: c.businessName,
    },
    family: {
      fatherName: c.fatherName,
      motherName: c.motherName,
      spouseName: c.spouseName,
      nomineeName: c.nomineeName,
      nomineeRelation: c.nomineeRelation,
    },
    references: [...c.references]
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ name: r.name, mobile: r.mobile })),
    evaluation: {
      cibilScore: c.cibilScore,
      existingLoans: c.existingLoans,
      monthlyEmiPaise: n(c.monthlyEmiPaise),
      totalIncomePaise: n(c.monthlyIncomePaise) + n(c.additionalIncomePaise),
      dtiBp: c.dtiBp,
      riskLevel: c.riskLevel,
      category: c.category,
    },
    tags: c.tags,
    watch: { status: c.watchStatus, reason: c.watchReason, setAt: c.watchSetAt },
    kycStatus: c.kycStatus,
    completedSteps: c.completedSteps,
    lastStep: c.lastStep,
    consentAt: c.consentAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    ...(opts.canSeeKyc && {
      bank: c.bank[0]
        ? {
            bankName: c.bank[0].bankName,
            accountMasked: maskId("ACCOUNT", c.bank[0].accountLast4, c.bank[0].accountLength),
            ifsc: c.bank[0].ifsc,
          }
        : null,
      documents: c.documents.map((d) => ({
        id: d.id,
        type: d.type,
        numberMasked:
          d.numberLast4 && d.numberLength ? maskId(d.type as KycNumberedType, d.numberLast4, d.numberLength) : null,
        status: d.status,
        rejectionReason: d.rejectionReason,
        verifiedAt: d.verifiedAt,
        issueDate: date(d.issueDate),
        expiryDate: date(d.expiryDate),
        files: d.files.map((f) => ({
          id: f.id,
          label: f.label,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          originalName: f.originalName,
        })),
      })),
    }),
  };
}
