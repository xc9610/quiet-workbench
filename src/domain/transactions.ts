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

export interface StoredTransaction {
  receipt: DetailedTransactionReceipt;
  snapshots: TransactionSnapshot[];
}

export interface TransactionJournalData {
  version: 1;
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
