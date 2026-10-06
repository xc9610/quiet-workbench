import type { TransactionReceipt } from "../core/types";

export type TransactionOperation =
  | { kind: "write"; path: string; content: string; expectedRevision?: string }
  | { kind: "create"; path: string; content: string };

export interface TransactionPlan {
  id?: string;
  label: string;
  operations: TransactionOperation[];
}

export interface TransactionSnapshot {
  path: string;
  kind: TransactionOperation["kind"];
  before?: string;
  after: string;
}

export interface DetailedTransactionReceipt extends TransactionReceipt {
  operationCount: number;
  restoredPaths: string[];
  unresolvedPaths: string[];
}

/**
 * Persisted undo information. The post-transaction content is not stored: undo reads it from the
 * file and proves it is unchanged by length and hash. The pre-transaction content is stored as a
 * patch against it, so appending a memo line costs a few bytes instead of two copies of the note.
 */
export interface StoredSnapshot {
  path: string;
  kind: TransactionOperation["kind"];
  afterLength: number;
  afterHash: string;
  /** For writes: replacing `after.slice(start, end)` with `text` yields the previous content. */
  patch?: { start: number; end: number; text: string };
}

export interface StoredTransaction {
  receipt: DetailedTransactionReceipt;
  snapshots: StoredSnapshot[];
}

/** Version 1 journals stored full before/after copies; they are converted on load. */
export interface LegacyTransactionJournalData {
  version: 1;
  entries: Array<{ receipt: DetailedTransactionReceipt; snapshots: TransactionSnapshot[] }>;
}

export interface TransactionJournalData {
  version: 2;
  entries: StoredTransaction[];
}

export class RevisionConflictError extends Error {
  constructor(
    public readonly path: string,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`Revision conflict for ${path}: expected ${expected}, found ${actual}.`);
    this.name = "RevisionConflictError";
  }
}

export class TransactionPreflightError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = "TransactionPreflightError";
  }
}
