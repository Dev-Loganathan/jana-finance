import { Global, Injectable, Module } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "../config/env";

/**
 * AES-256-GCM field encryption. Ciphertext format: v1.<iv>.<tag>.<data> (base64url).
 * Key is derived from FIELD_ENCRYPTION_KEY; swap for a KMS-backed key later without changing callers.
 */
@Injectable()
export class CryptoService {
  private key = createHash("sha256").update(env().FIELD_ENCRYPTION_KEY).digest();

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv, tag, data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
  }

  /**
   * Deterministic keyed hash ("blind index") so the same Aadhaar/PAN/account number can be found again
   * (duplicate detection) without storing or decrypting it. Callers must normalise the value first.
   */
  blindIndex(normalized: string): string {
    return createHmac("sha256", env().BLIND_INDEX_KEY).update(normalized).digest("hex");
  }

  decrypt(payload: string): string {
    const [v, iv, tag, data] = payload.split(".");
    if (v !== "v1" || !iv || !tag || !data) throw new Error("Unsupported ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }
}

@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
