import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_ID = /^[A-Za-z0-9_-]{8,160}$/;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export type KaminoExecutionAction = "deposit" | "withdraw";
export type KaminoExecutionResolution = "verified-terminal" | "never-submitted";

export type KaminoExecutionClaimInput = {
  walletAddress: string;
  actionId: string;
  action: KaminoExecutionAction;
  amountAtomic: string;
  providerUUID: string;
};

export type KaminoExecutionClaim = KaminoExecutionClaimInput & {
  signature: string | null;
  submissionState: "reserved" | "uncertain";
  resolution: KaminoExecutionResolution | null;
  releasedAt: number | null;
  createdAt: number;
};

export type KaminoExecutionClaimResult = {
  claim: KaminoExecutionClaim;
  replayed: boolean;
  leaseActive: boolean;
};

export type KaminoExecutionClaimConflictCode =
  | "INVALID_CLAIM"
  | "PROVIDER_UUID_REUSED"
  | "ACTION_ALREADY_CLAIMED"
  | "WALLET_IN_FLIGHT"
  | "SIGNATURE_REUSED"
  | "CLAIM_NOT_FOUND"
  | "CLAIM_ALREADY_RELEASED"
  | "LEASE_MISMATCH"
  | "LOCK_TIMEOUT"
  | "STORE_CORRUPT";

export class KaminoExecutionClaimError extends Error {
  constructor(
    readonly code: KaminoExecutionClaimConflictCode,
    message: string,
  ) {
    super(message);
    this.name = "KaminoExecutionClaimError";
  }
}

function fail(code: KaminoExecutionClaimConflictCode, message: string): never {
  throw new KaminoExecutionClaimError(code, message);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInput(input: KaminoExecutionClaimInput) {
  if (!UUID.test(input.actionId)
    || !UUID.test(input.providerUUID)
    || !WALLET.test(input.walletAddress)
    || (input.action !== "deposit" && input.action !== "withdraw")
    || !/^[1-9]\d*$/.test(input.amountAtomic)) {
    fail("INVALID_CLAIM", "Kamino execution claim identity is invalid.");
  }
}

function sameIdentity(left: KaminoExecutionClaimInput, right: KaminoExecutionClaimInput) {
  return left.walletAddress === right.walletAddress
    && left.actionId === right.actionId
    && left.action === right.action
    && left.amountAtomic === right.amountAtomic
    && left.providerUUID.toLowerCase() === right.providerUUID.toLowerCase();
}

function parseClaim(value: unknown, expectedProviderUUID?: string): KaminoExecutionClaim {
  if (!isObject(value)
    || value.version !== 1
    || typeof value.walletAddress !== "string"
    || typeof value.actionId !== "string"
    || typeof value.action !== "string"
    || typeof value.amountAtomic !== "string"
    || typeof value.providerUUID !== "string"
    || (value.signature !== null && typeof value.signature !== "string")
    || (value.submissionState !== "reserved" && value.submissionState !== "uncertain")
    || (value.resolution !== null && value.resolution !== "verified-terminal" && value.resolution !== "never-submitted")
    || (value.releasedAt !== null && typeof value.releasedAt !== "number")
    || typeof value.createdAt !== "number") {
    fail("STORE_CORRUPT", "Stored Kamino execution claim is invalid.");
  }
  const claim: KaminoExecutionClaim = {
    walletAddress: value.walletAddress,
    actionId: value.actionId,
    action: value.action as KaminoExecutionAction,
    amountAtomic: value.amountAtomic,
    providerUUID: value.providerUUID,
    signature: value.signature as string | null,
    submissionState: value.submissionState,
    resolution: value.resolution as KaminoExecutionResolution | null,
    releasedAt: value.releasedAt as number | null,
    createdAt: value.createdAt,
  };
  validateInput(claim);
  if (expectedProviderUUID && claim.providerUUID.toLowerCase() !== expectedProviderUUID.toLowerCase()) {
    fail("STORE_CORRUPT", "Stored claim does not match its provider key.");
  }
  return claim;
}

/**
 * Durable, cross-process claims for one signer wallet. Claims never expire:
 * an uncertain submission remains locked until an explicit, verified release.
 * The lock directory uses atomic mkdir and is intentionally never auto-stolen;
 * a process crash can require operator cleanup, which is fail-closed.
 */
export class KaminoExecutionClaimStore {
  private readonly root: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;

  constructor(filePath: string, options: { lockTimeoutMs?: number } = {}) {
    this.root = `${filePath}.execution-claims`;
    this.lockPath = path.join(this.root, ".lock");
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
  }

  private providerDir() { return path.join(this.root, "providers"); }
  private signatureDir() { return path.join(this.root, "signatures"); }
  private walletDir() { return path.join(this.root, "wallets"); }
  private providerPath(providerUUID: string) {
    return path.join(this.providerDir(), `${sha256(providerUUID.toLowerCase())}.json`);
  }
  private signaturePath(signature: string) {
    return path.join(this.signatureDir(), `${sha256(signature)}.json`);
  }
  private walletPath(walletAddress: string) {
    return path.join(this.walletDir(), `${sha256(walletAddress)}.json`);
  }

  private async ensureDirectories() {
    await Promise.all([this.providerDir(), this.signatureDir(), this.walletDir()].map((directory) =>
      mkdir(directory, { recursive: true, mode: 0o700 }),
    ));
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const startedAt = Date.now();
    while (true) {
      try {
        await mkdir(this.lockPath, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          fail("LOCK_TIMEOUT", "Kamino execution claim store is locked; retry after operator recovery.");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      await this.ensureDirectories();
      return await operation();
    } finally {
      await rmdir(this.lockPath).catch(() => undefined);
    }
  }

  private async readJson(filePath: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof SyntaxError) fail("STORE_CORRUPT", "Kamino execution claim store contains invalid JSON.");
      throw error;
    }
  }

  private async writeExclusive(filePath: string, value: unknown) {
    let handle;
    try {
      handle = await open(filePath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      await handle.writeFile(JSON.stringify(value), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  }

  private async writeAtomic(filePath: string, value: unknown) {
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, filePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async getProviderUnlocked(providerUUID: string) {
    const raw = await this.readJson(this.providerPath(providerUUID));
    return raw === null ? null : parseClaim(raw, providerUUID);
  }

  private async allProvidersUnlocked() {
    let names: string[];
    try {
      names = await readdir(this.providerDir());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const claims: KaminoExecutionClaim[] = [];
    for (const name of names.filter((item) => /^[a-f0-9]{64}\.json$/.test(item))) {
      const raw = await this.readJson(path.join(this.providerDir(), name));
      if (raw !== null) claims.push(parseClaim(raw));
    }
    return claims;
  }

  private async recoverSignatureUnlocked(claim: KaminoExecutionClaim) {
    if (claim.signature) return claim;
    let names: string[];
    try {
      names = await readdir(this.signatureDir());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return claim;
      throw error;
    }
    for (const name of names.filter((item) => /^[a-f0-9]{64}\.json$/.test(item))) {
      const raw = await this.readJson(path.join(this.signatureDir(), name));
      if (!isObject(raw) || raw.providerUUID !== claim.providerUUID) continue;
      if (raw.actionId !== claim.actionId || raw.walletAddress !== claim.walletAddress) {
        fail("STORE_CORRUPT", "Signature claim identity does not match its provider claim.");
      }
      const signature = raw.signature;
      if (typeof signature !== "string" || sha256(signature) !== name.slice(0, -5)) {
        fail("STORE_CORRUPT", "Stored signature claim hash is invalid.");
      }
      const updated = { ...claim, signature, submissionState: "uncertain" as const };
      await this.writeAtomic(this.providerPath(claim.providerUUID), { version: 1, ...updated });
      return updated;
    }
    return claim;
  }

  private async readWalletLeaseUnlocked(walletAddress: string) {
    const raw = await this.readJson(this.walletPath(walletAddress));
    if (raw === null) return null;
    if (!isObject(raw) || typeof raw.providerUUID !== "string" || typeof raw.actionId !== "string") {
      fail("STORE_CORRUPT", "Stored wallet lease is invalid.");
    }
    const claim = await this.getProviderUnlocked(raw.providerUUID);
    if (!claim || claim.actionId !== raw.actionId || claim.walletAddress !== walletAddress) {
      fail("STORE_CORRUPT", "Stored wallet lease has no matching provider claim.");
    }
    if (claim.releasedAt !== null) {
      await unlink(this.walletPath(walletAddress)).catch(() => undefined);
      return null;
    }
    return claim;
  }

  /** Reserve a provider transaction UUID and an indefinite wallet lease. */
  async claimExecution(input: KaminoExecutionClaimInput): Promise<KaminoExecutionClaimResult> {
    validateInput(input);
    return this.withLock(async () => {
      const normalizedInput = { ...input, providerUUID: input.providerUUID.toLowerCase() };
      const existing = await this.getProviderUnlocked(normalizedInput.providerUUID);
      const walletLease = await this.readWalletLeaseUnlocked(input.walletAddress);
      const providerClaims = await this.allProvidersUnlocked();

      if (existing) {
        if (!sameIdentity(existing, normalizedInput)) {
          fail("PROVIDER_UUID_REUSED", "Provider transaction UUID is already bound to another action.");
        }
        if (walletLease && walletLease.providerUUID !== existing.providerUUID) {
          fail("WALLET_IN_FLIGHT", "This wallet already has an unresolved Kamino transaction.");
        }
        if (existing.releasedAt === null && !walletLease) {
          const created = await this.writeExclusive(this.walletPath(existing.walletAddress), {
            version: 1,
            providerUUID: existing.providerUUID,
            actionId: existing.actionId,
          });
          if (!created) {
            const nowLocked = await this.readWalletLeaseUnlocked(existing.walletAddress);
            if (nowLocked?.providerUUID !== existing.providerUUID) {
              fail("WALLET_IN_FLIGHT", "This wallet already has an unresolved Kamino transaction.");
            }
          }
        }
        return { claim: await this.recoverSignatureUnlocked(existing), replayed: true, leaseActive: existing.releasedAt === null };
      }

      if (providerClaims.some((claim) => claim.actionId === input.actionId)) {
        fail("ACTION_ALREADY_CLAIMED", "This action ID is already bound to another provider execution.");
      }
      if (walletLease) {
        fail("WALLET_IN_FLIGHT", "This wallet already has an unresolved Kamino transaction.");
      }
      const recoveredWalletClaim = providerClaims.find((claim) =>
        claim.walletAddress === input.walletAddress && claim.releasedAt === null,
      );
      if (recoveredWalletClaim) {
        // The provider record is authoritative if the process stopped between
        // creating it and creating the wallet index. Restore the missing lease.
        await this.writeExclusive(this.walletPath(input.walletAddress), {
          version: 1,
          providerUUID: recoveredWalletClaim.providerUUID,
          actionId: recoveredWalletClaim.actionId,
        });
        fail("WALLET_IN_FLIGHT", "This wallet already has an unresolved Kamino transaction.");
      }

      const claim: KaminoExecutionClaim = {
        ...normalizedInput,
        signature: null,
        submissionState: "reserved",
        resolution: null,
        releasedAt: null,
        createdAt: Date.now(),
      };
      const providerCreated = await this.writeExclusive(this.providerPath(claim.providerUUID), { version: 1, ...claim });
      if (!providerCreated) {
        fail("PROVIDER_UUID_REUSED", "Provider transaction UUID was claimed concurrently.");
      }
      const walletCreated = await this.writeExclusive(this.walletPath(claim.walletAddress), {
        version: 1,
        providerUUID: claim.providerUUID,
        actionId: claim.actionId,
      });
      if (!walletCreated) {
        fail("WALLET_IN_FLIGHT", "This wallet already has an unresolved Kamino transaction.");
      }
      return { claim, replayed: false, leaseActive: true };
    });
  }

  /** Mark the provider call as potentially accepted before making the call. */
  async markSubmissionUncertain(providerUUID: string, actionId: string) {
    if (!UUID.test(providerUUID) || !ACTION_ID.test(actionId)) fail("INVALID_CLAIM", "Provider claim identity is invalid.");
    return this.withLock(async () => {
      const claim = await this.getProviderUnlocked(providerUUID.toLowerCase());
      if (!claim || claim.actionId !== actionId) fail("CLAIM_NOT_FOUND", "Provider execution claim was not found.");
      if (claim.resolution === "never-submitted") fail("CLAIM_ALREADY_RELEASED", "A released non-submission cannot be submitted.");
      if (claim.submissionState === "uncertain") return claim;
      const updated = { ...claim, submissionState: "uncertain" as const };
      await this.writeAtomic(this.providerPath(claim.providerUUID), { version: 1, ...updated });
      return updated;
    });
  }

  /** Bind a returned/recovered Solana signature; indexes are SHA-256 keyed and exclusive-created. */
  async claimSignature(providerUUID: string, actionId: string, signature: string) {
    if (!UUID.test(providerUUID) || !ACTION_ID.test(actionId) || !SIGNATURE.test(signature)) {
      fail("INVALID_CLAIM", "Provider UUID, action ID, or transaction signature is invalid.");
    }
    return this.withLock(async () => {
      let claim = await this.getProviderUnlocked(providerUUID.toLowerCase());
      if (!claim || claim.actionId !== actionId) fail("CLAIM_NOT_FOUND", "Provider execution claim was not found.");
      if (claim.resolution === "never-submitted") fail("CLAIM_ALREADY_RELEASED", "A released non-submission cannot receive a signature.");
      const signaturePath = this.signaturePath(signature);
      const existingSignatureClaim = await this.readJson(signaturePath);
      if (existingSignatureClaim !== null) {
        if (!isObject(existingSignatureClaim)
          || existingSignatureClaim.providerUUID !== claim.providerUUID
          || existingSignatureClaim.actionId !== claim.actionId
          || existingSignatureClaim.walletAddress !== claim.walletAddress
          || existingSignatureClaim.signature !== signature) {
          fail("SIGNATURE_REUSED", "Transaction signature is already claimed by another action.");
        }
        claim = await this.recoverSignatureUnlocked(claim);
        if (claim.signature !== signature) {
          claim = { ...claim, signature, submissionState: "uncertain" };
          await this.writeAtomic(this.providerPath(claim.providerUUID), { version: 1, ...claim });
        }
        return { claim, replayed: true };
      }

      const providerClaims = await this.allProvidersUnlocked();
      if (providerClaims.some((item) => item.signature === signature && item.providerUUID !== claim.providerUUID)) {
        fail("SIGNATURE_REUSED", "Transaction signature is already claimed by another action.");
      }
      const indexCreated = await this.writeExclusive(signaturePath, {
        version: 1,
        providerUUID: claim.providerUUID,
        actionId: claim.actionId,
        walletAddress: claim.walletAddress,
        signature,
      });
      if (!indexCreated) fail("SIGNATURE_REUSED", "Transaction signature was claimed concurrently.");
      const updated: KaminoExecutionClaim = { ...claim, signature, submissionState: "uncertain" };
      await this.writeAtomic(this.providerPath(claim.providerUUID), { version: 1, ...updated });
      return { claim: updated, replayed: false };
    });
  }

  /** Recover a claim (and signature, when bound) by the provider's durable UUID. */
  async getByProviderUUID(providerUUID: string): Promise<KaminoExecutionClaim | null> {
    if (!UUID.test(providerUUID)) fail("INVALID_CLAIM", "Provider transaction UUID is invalid.");
    return this.withLock(async () => {
      const claim = await this.getProviderUnlocked(providerUUID.toLowerCase());
      return claim ? this.recoverSignatureUnlocked(claim) : null;
    });
  }

  /** Release only after the caller has verified a terminal provider/chain state or non-submission. */
  async releaseWalletLease({
    walletAddress,
    providerUUID,
    actionId,
    resolution,
  }: {
    walletAddress: string;
    providerUUID: string;
    actionId: string;
    resolution: KaminoExecutionResolution;
  }) {
    if (!WALLET.test(walletAddress) || !UUID.test(providerUUID) || !ACTION_ID.test(actionId)
      || (resolution !== "verified-terminal" && resolution !== "never-submitted")) {
      fail("INVALID_CLAIM", "Wallet lease release identity or resolution is invalid.");
    }
    return this.withLock(async () => {
      const claim = await this.getProviderUnlocked(providerUUID.toLowerCase());
      if (!claim || claim.actionId !== actionId || claim.walletAddress !== walletAddress) {
        fail("LEASE_MISMATCH", "Wallet lease release does not match the provider claim.");
      }
      if (resolution === "never-submitted" && claim.signature !== null) {
        fail("LEASE_MISMATCH", "A signed transaction cannot be released as never submitted.");
      }
      if (claim.releasedAt !== null) {
        if (claim.resolution !== resolution) fail("LEASE_MISMATCH", "Wallet lease was already released for a different reason.");
        return { claim, released: false };
      }
      const leasePath = this.walletPath(walletAddress);
      const walletLease = await this.readWalletLeaseUnlocked(walletAddress);
      if (walletLease && walletLease.providerUUID !== claim.providerUUID) {
        fail("LEASE_MISMATCH", "Wallet lease belongs to another provider execution.");
      }
      const updated = { ...claim, resolution, releasedAt: Date.now() };
      await this.writeAtomic(this.providerPath(claim.providerUUID), { version: 1, ...updated });
      await unlink(leasePath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      return { claim: updated, released: true };
    });
  }
}
