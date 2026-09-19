import { z } from "zod";
import { ALL_PERMISSIONS } from "./permissions";

/** Min 12 chars, 1 upper, 1 lower, 1 digit, 1 special (matches the existing app). */
export const passwordSchema = z
  .string()
  .min(12, "At least 12 characters")
  .regex(/[A-Z]/, "Needs an uppercase letter")
  .regex(/[a-z]/, "Needs a lowercase letter")
  .regex(/[0-9]/, "Needs a number")
  .regex(/[^A-Za-z0-9]/, "Needs a special character");

const email = z.string().trim().toLowerCase().email();
/** Indian mobile: optional +91/0, then 10 digits starting 6-9. Stored as 10 digits. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").replace(/^(\+91|0)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"));

export const loginSchema = z.object({
  email,
  password: z.string().min(1),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const acceptInviteSchema = z.object({ token: z.string().min(20), password: passwordSchema });

export const totpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const createUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).default(""),
    email,
    phone: phoneSchema,
    roleId: z.string().uuid(),
    employeeCode: z.string().trim().max(30).optional(),
    /** "invite" emails a set-password link; "password" sets an initial password (must be changed on first login). */
    mode: z.enum(["invite", "password"]).default("invite"),
    password: passwordSchema.optional(),
  })
  .refine((v) => v.mode !== "password" || !!v.password, { path: ["password"], message: "Password required" });

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80),
    phone: phoneSchema,
    roleId: z.string().uuid(),
    employeeCode: z.string().trim().max(30).nullable(),
  })
  .partial();

const permissionEnum = z.enum(ALL_PERMISSIONS as unknown as [string, ...string[]]);

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).default(""),
  dataScope: z.enum(["ALL", "BRANCH", "ASSIGNED"]).default("ALL"),
  permissions: z.array(permissionEnum).max(ALL_PERMISSIONS.length),
});
export const updateRoleSchema = createRoleSchema.partial();

/** Standard list query used by every list endpoint: pagination, sort, search. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z
    .string()
    .regex(/^[a-zA-Z]+:(asc|desc)$/)
    .optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
