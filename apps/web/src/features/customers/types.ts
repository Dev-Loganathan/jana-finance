import type { CreditCategory, KycDocType, RiskLevel, WizardStep } from "@jana/shared";

export type CustomerStatus = "DRAFT" | "ACTIVE" | "INACTIVE";
export type KycStatus = "NOT_STARTED" | "PARTIAL" | "COMPLETE" | "VERIFIED" | "EXPIRED";

export interface CustomerListItem {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  city: string | null;
  occupationType: string | null;
  cibilScore: number | null;
  riskLevel: RiskLevel | null;
  category: CreditCategory | null;
  status: CustomerStatus;
  kycStatus: KycStatus;
  watchStatus: "NONE" | "WATCHLIST" | "BLACKLIST";
  tags: string[];
  completedSteps: WizardStep[];
  updatedAt: string;
  photoUrl: string | null;
}

export interface CustomerFileInfo {
  id: string;
  label: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

export interface KycDocumentInfo {
  id: string;
  type: KycDocType;
  numberMasked: string | null;
  status: "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED";
  rejectionReason: string | null;
  verifiedAt: string | null;
  files: CustomerFileInfo[];
}

export interface CustomerDetail {
  id: string;
  code: string;
  status: CustomerStatus;
  firstName: string;
  lastName: string;
  name: string;
  gender: string | null;
  dob: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  maritalStatus: string | null;
  address: {
    currentAddress: string | null;
    permanentAddress: string | null;
    country: string;
    state: string | null;
    district: string | null;
    pincode: string | null;
    landmark: string | null;
    residenceType: string | null;
  };
  employment: {
    occupationType: string | null;
    companyName: string | null;
    designation: string | null;
    workExperience: string | null;
    monthlyIncomePaise: number;
    additionalIncomePaise: number;
    businessName: string | null;
  };
  family: {
    fatherName: string | null;
    motherName: string | null;
    spouseName: string | null;
    nomineeName: string | null;
    nomineeRelation: string | null;
  };
  references: { name: string; mobile: string }[];
  evaluation: {
    cibilScore: number | null;
    existingLoans: number;
    monthlyEmiPaise: number;
    totalIncomePaise: number;
    dtiBp: number | null;
    riskLevel: RiskLevel | null;
    category: CreditCategory | null;
  };
  tags: string[];
  watch: { status: "NONE" | "WATCHLIST" | "BLACKLIST"; reason: string | null; setAt: string | null };
  kycStatus: KycStatus;
  completedSteps: WizardStep[];
  lastStep: WizardStep;
  consentAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present only for users with kyc:view. */
  bank?: { bankName: string; accountMasked: string; ifsc: string } | null;
  documents?: KycDocumentInfo[];
}

export interface DuplicateMatch {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  status: CustomerStatus;
  reasons: string[];
}

export interface CustomerNote {
  id: string;
  kind: "NOTE" | "CALL" | "VISIT";
  body: string;
  outcome: string | null;
  followUpOn: string | null;
  completedAt: string | null;
  authorName: string;
  createdAt: string;
}

export interface FollowUp {
  id: string;
  kind: "NOTE" | "CALL" | "VISIT";
  body: string;
  outcome: string | null;
  followUpOn: string;
  customer: { id: string; code: string; name: string; phone: string | null };
}
