import type { TransactionStatus } from "../core/types";
import { contentRevision } from "../domain/markdown";
import {
  RevisionConflictError,
  TransactionPreflightError,
  type DetailedTransactionReceipt,
  type StoredTransaction,
  type TransactionJournalData,
  type TransactionPlan,
  type TransactionSnapshot
} from "../domain/transactions";
import { normalizeVaultPath, type VaultPort } from "./vault-port";

export interface TransactionExecutorOptions {
  now?: () => Date;
  idFactory?: () => string;
  onStatus?: (status: TransactionStatus, receipt: DetailedTransactionReceipt) => void;
}

export class TransactionJournal {
  private entries: StoredTransaction[] = [];

  constructor(private readonly limit = 50, private readonly byteLimit = 2_000_000) {}

  add(entry: StoredTransaction): void {
    this.entries.unshift(entry);
    this.trim();
  }

  list(): DetailedTransactionReceipt[] {
    return this.entries.map((entry) => structuredClone(entry.receipt));
  }

  get(id: string): StoredTransaction | undefined {
    const found = this.entries.find((entry) => entry.receipt.id === id);
    return found ? structuredClone(found) : undefined;
  }

  latestCommitted(): StoredTransaction | undefined {
    const found = this.entries.find(
      (entry) => entry.receipt.status === "committed" && entry.snapshots.length > 0
    );
    return found ? structuredClone(found) : undefined;
  }

  remove(id: string): void {
    this.entries = this.entries.filter((entry) => entry.receipt.id !== id);
  }

  serialize(): TransactionJournalData {
    return { version: 1, entries: structuredClone(this.entries) };
  }

  hydrate(data: TransactionJournalData): void {
    if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error("Unsupported transaction journal data.");
    this.entries = structuredClone(data.entries);
    this.trim();
  }

  private trim(): void {
    this.entries = this.entries.slice(0, Math.max(0, this.limit));
    let bytes = 0;
    this.entries = this.entries.map((entry) => {
      const receiptBytes = JSON.stringify(entry.receipt).length * 2;
      const snapshotBytes = JSON.stringify(entry.snapshots).length * 2;
      bytes += receiptBytes;
      if (bytes + snapshotBytes <= this.byteLimit) {
        bytes += snapshotBytes;
        return entry;
      }
      return { receipt: entry.receipt, snapshots: [] };
    });
  }
}

export class WriteTransactionExecutor {
  readonly journal: TransactionJournal;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly vault: VaultPort,
    journal = new TransactionJournal(),
    private readonly options: TransactionExecutorOptions = {}
  ) {
    this.journal = journal;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? makeTransactionId;
  }

  async execute(plan: TransactionPlan): Promise<DetailedTransactionReceipt> {
    const id = plan.id ?? this.idFactory();
    const receipt = makeReceipt(id, plan.label, plan.operations.map((operation) => operation.path), this.now());
    this.emit("planned", receipt);
    let snapshots: TransactionSnapshot[];
    try {
      snapshots = await this.preflight(plan);
      receipt.messages.push("Preflight passed.");
      this.emit("preflight", receipt);
    } catch (error) {
      receipt.messages.push(errorMessage(error));
      this.finish(receipt, "failed");
      this.journal.add({ receipt, snapshots: [] });
      return receipt;
    }

    this.emit("committing", receipt);
    const applied: TransactionSnapshot[] = [];
    try {
      for (const snapshot of snapshots) {
        if (snapshot.kind === "create") await this.vault.create(snapshot.path, snapshot.after);
        else await this.vault.write(snapshot.path, snapshot.after, contentRevision(snapshot.before ?? ""));
        applied.push(snapshot);
      }
      this.finish(receipt, "committed");
    } catch (error) {
      receipt.messages.push(`Commit failed: ${errorMessage(error)}`);
      if (applied.length === 0) {
        this.finish(receipt, "failed");
      } else {
        await this.compensate(applied, receipt);
        this.finish(receipt, receipt.unresolvedPaths.length > 0 ? "partial" : "rolled-back");
      }
    }
    this.journal.add({ receipt, snapshots });
    return structuredClone(receipt);
  }

  async undo(id?: string): Promise<DetailedTransactionReceipt> {
    const stored = id ? this.journal.get(id) : this.journal.latestCommitted();
    if (!stored) throw new Error(id ? `Transaction not found: ${id}` : "No committed transaction is available to undo.");
    if (stored.receipt.status !== "committed") throw new Error("Only committed transactions can be undone.");
    if (stored.snapshots.length === 0) throw new Error("Undo content is no longer retained for this transaction.");

    const receipt = makeReceipt(
      this.idFactory(),
      `Undo: ${stored.receipt.label}`,
      stored.snapshots.map((snapshot) => snapshot.path),
      this.now()
    );
    this.emit("preflight", receipt);
    for (const snapshot of stored.snapshots) {
      if (!(await this.vault.exists(snapshot.path))) {
        receipt.messages.push(`Cannot undo because ${snapshot.path} no longer exists.`);
        this.finish(receipt, "failed");
        this.journal.add({ receipt, snapshots: [] });
        return structuredClone(receipt);
      }
      const current = await this.vault.read(snapshot.path);
      if (contentRevision(current) !== contentRevision(snapshot.after)) {
        receipt.messages.push(`Cannot undo because ${snapshot.path} changed after the transaction.`);
        this.finish(receipt, "failed");
        this.journal.add({ receipt, snapshots: [] });
        return structuredClone(receipt);
      }
    }

    this.emit("committing", receipt);
    const restored: TransactionSnapshot[] = [];
    try {
      const writes = stored.snapshots.filter((snapshot) => snapshot.kind === "write").reverse();
      const creates = stored.snapshots.filter((snapshot) => snapshot.kind === "create").reverse();
      for (const snapshot of writes) {
        await this.vault.write(snapshot.path, snapshot.before ?? "", contentRevision(snapshot.after));
        restored.push(snapshot);
        receipt.restoredPaths.push(snapshot.path);
      }
      for (const snapshot of creates) {
        await this.vault.trash(snapshot.path);
        restored.push(snapshot);
        receipt.restoredPaths.push(snapshot.path);
      }
      this.finish(receipt, "committed");
      receipt.messages.push(`Undid transaction ${stored.receipt.id}.`);
      this.journal.remove(stored.receipt.id);
    } catch (error) {
      receipt.messages.push(`Undo failed: ${errorMessage(error)}`);
      const trashedCreate = restored.some((snapshot) => snapshot.kind === "create");
      if (trashedCreate) {
        receipt.unresolvedPaths.push(...restored.filter((snapshot) => snapshot.kind === "create").map((snapshot) => snapshot.path));
      }
      for (const snapshot of restored.filter((entry) => entry.kind === "write").reverse()) {
        try {
          const current = await this.vault.read(snapshot.path);
          if (contentRevision(current) !== contentRevision(snapshot.before ?? "")) {
            receipt.unresolvedPaths.push(snapshot.path);
            continue;
          }
          await this.vault.write(snapshot.path, snapshot.after, contentRevision(snapshot.before ?? ""));
        } catch {
          receipt.unresolvedPaths.push(snapshot.path);
        }
      }
      this.finish(receipt, receipt.unresolvedPaths.length > 0 ? "partial" : "rolled-back");
    }
    this.journal.add({ receipt, snapshots: [] });
    return structuredClone(receipt);
  }

  private async preflight(plan: TransactionPlan): Promise<TransactionSnapshot[]> {
    if (plan.operations.length === 0) throw new TransactionPreflightError("Transaction has no operations.");
    const seen = new Set<string>();
    const snapshots: TransactionSnapshot[] = [];
    for (const operation of plan.operations) {
      const path = normalizeVaultPath(operation.path);
      if (seen.has(path)) throw new TransactionPreflightError(`Transaction contains duplicate path: ${path}`, path);
      seen.add(path);
      const exists = await this.vault.exists(path);
      if (operation.kind === "create") {
        if (exists) throw new TransactionPreflightError(`Cannot create existing file: ${path}`, path);
        snapshots.push({ kind: "create", path, after: operation.content });
      } else {
        if (!exists) throw new TransactionPreflightError(`Cannot write missing file: ${path}`, path);
        const before = await this.vault.read(path);
        const actual = contentRevision(before);
        if (operation.expectedRevision && operation.expectedRevision !== actual) {
          throw new RevisionConflictError(path, operation.expectedRevision, actual);
        }
        snapshots.push({ kind: "write", path, before, after: operation.content });
      }
    }
    return snapshots;
  }

  private async compensate(applied: TransactionSnapshot[], receipt: DetailedTransactionReceipt): Promise<void> {
    for (const snapshot of [...applied].reverse()) {
      try {
        if (!(await this.vault.exists(snapshot.path))) throw new Error("file is missing");
        const current = await this.vault.read(snapshot.path);
        if (contentRevision(current) !== contentRevision(snapshot.after)) throw new Error("file changed after commit");
        if (snapshot.kind === "create") await this.vault.trash(snapshot.path);
        else await this.vault.write(snapshot.path, snapshot.before ?? "", contentRevision(snapshot.after));
        receipt.restoredPaths.push(snapshot.path);
      } catch (error) {
        receipt.unresolvedPaths.push(snapshot.path);
        receipt.messages.push(`Could not restore ${snapshot.path}: ${errorMessage(error)}`);
      }
    }
  }

  private emit(status: TransactionStatus, receipt: DetailedTransactionReceipt): void {
    receipt.status = status;
    this.options.onStatus?.(status, structuredClone(receipt));
  }

  private finish(receipt: DetailedTransactionReceipt, status: TransactionStatus): void {
    receipt.status = status;
    receipt.completedAt = this.now().toISOString();
    this.options.onStatus?.(status, structuredClone(receipt));
  }
}

export function makeTransactionId(): string {
  return `qwb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeReceipt(id: string, label: string, paths: string[], now: Date): DetailedTransactionReceipt {
  return {
    id,
    label,
    status: "planned",
    startedAt: now.toISOString(),
    affectedPaths: [...new Set(paths)],
    messages: [],
    operationCount: paths.length,
    restoredPaths: [],
    unresolvedPaths: []
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
