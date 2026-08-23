import type { TaskRecord, TaskScope } from "../core/types";
import type { DetailedTransactionReceipt } from "../domain/transactions";
import { RevisionConflictError } from "../domain/transactions";
import { appendToSection, contentRevision, parseMarkdown, stableHash } from "../domain/markdown";
import { locateTask, renderTaskLine } from "./task-service";
import { makeTransactionId, WriteTransactionExecutor } from "./transaction-service";
import type { VaultPort } from "./vault-port";

export interface MeetingMigrationInput {
  sourceTask: TaskRecord;
  targetPath: string;
  targetScope: Exclude<TaskScope, "meeting-draft">;
  targetHeading?: string;
}

export interface MeetingMigrationResult {
  outcome: "migrated" | "already-migrated" | "failed";
  targetBlockId?: string;
  transactionId?: string;
  receipt?: DetailedTransactionReceipt;
  existingTargetPath?: string;
}

export type MeetingMigrationBatchItemOutcome =
  | MeetingMigrationResult["outcome"]
  | "conflict"
  | "error"
  | "skipped";

export interface MeetingMigrationBatchInput {
  items: MeetingMigrationInput[];
  /** Stop after the first failure. Remaining items are returned as retryable skipped items. */
  stopOnFailure?: boolean;
  /** Stable caller-provided identifier that can be persisted with a workflow receipt. */
  batchId?: string;
}

export interface MeetingMigrationBatchItemResult {
  index: number;
  sourcePath: string;
  sourceTaskId: string;
  targetPath: string;
  outcome: MeetingMigrationBatchItemOutcome;
  retryable: boolean;
  message?: string;
  targetBlockId?: string;
  transactionId?: string;
  receipt?: DetailedTransactionReceipt;
  unresolvedPaths: string[];
}

export interface MeetingMigrationBatchResult {
  id: string;
  status: "completed" | "partial" | "failed";
  items: MeetingMigrationBatchItemResult[];
  migratedCount: number;
  alreadyMigratedCount: number;
  failedCount: number;
  skippedCount: number;
  /** Paths that compensation could not restore and may require manual inspection. */
  manualRepairPaths: string[];
  /** Self-contained inputs for retrying only failed or skipped work. */
  retryItems: MeetingMigrationInput[];
}

export interface MeetingMigrationRetryOptions {
  stopOnFailure?: boolean;
  batchId?: string;
}

const MIGRATION_PATTERN = /<!--\s*quiet-workbench:migrated\s+target="([^"]+)"\s+block="([^"]+)"\s+transaction="([^"]+)"\s*-->/u;

export class MeetingMigrationService {
  constructor(private readonly vault: VaultPort, private readonly transactions: WriteTransactionExecutor) {}

  async migrate(input: MeetingMigrationInput): Promise<MeetingMigrationResult> {
    const { sourceTask, targetPath } = input;
    if (sourceTask.scope !== "meeting-draft") throw new Error("Only meeting-draft tasks can be migrated.");
    if (sourceTask.path === targetPath) throw new Error("Meeting action target must be a different note.");

    const [sourceBefore, targetBefore] = await Promise.all([
      this.vault.read(sourceTask.path),
      this.vault.read(targetPath)
    ]);
    const sourceParsed = parseMarkdown(sourceBefore, {
      path: sourceTask.path,
      sourceName: sourceTask.sourceName,
      scope: "meeting-draft"
    });
    const current = locateTask(sourceParsed.tasks, sourceTask);
    if (!current) throw new Error(`Meeting action is no longer present in ${sourceTask.path}.`);
    const existing = current.raw.match(MIGRATION_PATTERN);
    if (existing) {
      return {
        outcome: "already-migrated",
        existingTargetPath: decodeURIComponent(existing[1] ?? ""),
        targetBlockId: existing[2],
        transactionId: existing[3]
      };
    }
    if (current.revision !== sourceTask.revision) {
      throw new RevisionConflictError(sourceTask.path, sourceTask.revision, current.revision);
    }

    const transactionId = makeTransactionId();
    const actionKey = sourceTask.blockId ?? `L${sourceTask.line}-${stableHash(sourceTask.revision)}`;
    const sourceKey = `${sourceTask.path}#${actionKey}`;
    const targetBlockId = `qwb-m-${stableHash(`${sourceKey}:${targetPath}`)}`;
    const targetSourceMarker = `<!-- quiet-workbench:source meeting="${encodeURIComponent(sourceTask.path)}" action="${encodeURIComponent(actionKey)}" -->`;
    const renderedTarget = renderTaskLine({
      text: sourceTask.text,
      due: sourceTask.due,
      scheduled: sourceTask.scheduled,
      priority: sourceTask.priority,
      blockId: targetBlockId
    });
    const targetLine = renderedTarget.replace(
      new RegExp(`\\s+\\^${targetBlockId}$`, "u"),
      ` ${targetSourceMarker} ^${targetBlockId}`
    );
    const targetAlreadyContainsAction = targetBefore.includes(targetSourceMarker);
    const targetAfter = targetAlreadyContainsAction
      ? targetBefore
      : appendToSection(targetBefore, input.targetHeading ?? "## 待办", targetLine);

    const marker = `<!-- quiet-workbench:migrated target="${encodeURIComponent(targetPath)}" block="${targetBlockId}" transaction="${transactionId}" -->`;
    const sourceLines = sourceParsed.lines;
    const existingBlock = current.raw.match(/\s+(\^[A-Za-z0-9-]+)\s*$/u)?.[1];
    const sourceWithoutBlock = existingBlock
      ? current.raw.replace(/\s+\^[A-Za-z0-9-]+\s*$/u, "")
      : current.raw;
    const completedRaw = sourceWithoutBlock
      .replace(/^(\s*[-*+]\s+)\[[ xX]\]/u, "$1[x]")
      .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/gu, "")
      .trimEnd();
    sourceLines[current.line - 1] = `${completedRaw} ${marker}${existingBlock ? ` ${existingBlock}` : ""}`;
    const sourceAfter = sourceLines.join("\n");

    const receipt = await this.transactions.execute({
      id: transactionId,
      label: `Migrate meeting action to ${targetPath}`,
      operations: [
        ...(targetAlreadyContainsAction
          ? []
          : [{ kind: "write" as const, path: targetPath, content: targetAfter, expectedRevision: contentRevision(targetBefore) }]),
        { kind: "write", path: sourceTask.path, content: sourceAfter, expectedRevision: contentRevision(sourceBefore) }
      ]
    });
    return {
      outcome: receipt.status === "committed" ? "migrated" : "failed",
      targetBlockId,
      transactionId,
      receipt
    };
  }

  /**
   * Runs independent two-file migrations in a deterministic order. A batch is not
   * presented as one ACID transaction: every item keeps its own transaction receipt.
   */
  async migrateBatch(input: MeetingMigrationBatchInput): Promise<MeetingMigrationBatchResult> {
    if (input.items.length === 0) throw new Error("Meeting migration batch cannot be empty.");
    const id = input.batchId ?? makeTransactionId();
    const results: MeetingMigrationBatchItemResult[] = [];
    const retryItems: MeetingMigrationInput[] = [];
    let stopped = false;

    for (const [index, item] of input.items.entries()) {
      if (stopped) {
        results.push(batchItemResult(index, item, "skipped", {
          retryable: true,
          message: "Skipped after an earlier batch item failed."
        }));
        retryItems.push(item);
        continue;
      }
      try {
        const result = await this.migrate(item);
        const failed = result.outcome === "failed";
        results.push(batchItemResult(index, item, result.outcome, {
          retryable: failed,
          targetBlockId: result.targetBlockId,
          transactionId: result.transactionId,
          receipt: result.receipt,
          message: failed ? migrationFailureMessage(result.receipt) : undefined
        }));
        if (failed) {
          retryItems.push(item);
          stopped = input.stopOnFailure === true;
        }
      } catch (error) {
        const outcome = error instanceof RevisionConflictError ? "conflict" : "error";
        results.push(batchItemResult(index, item, outcome, {
          retryable: true,
          message: errorMessage(error)
        }));
        retryItems.push(item);
        stopped = input.stopOnFailure === true;
      }
    }

    return summarizeBatch(id, results, retryItems);
  }

  /**
   * Re-resolves retryable actions from their Markdown source before retrying. Stable
   * block IDs are preferred; block-less tasks are accepted only if line and text still
   * match, so an unrelated external edit cannot silently redirect a migration.
   */
  async retryBatch(
    previous: MeetingMigrationBatchResult,
    options: MeetingMigrationRetryOptions = {}
  ): Promise<MeetingMigrationBatchResult> {
    if (previous.retryItems.length === 0) throw new Error("Meeting migration batch has no retryable items.");
    const refreshed: MeetingMigrationInput[] = [];
    const unresolved: Array<{ input: MeetingMigrationInput; message: string }> = [];
    for (const input of previous.retryItems) {
      try {
        refreshed.push({ ...input, sourceTask: await this.resolveRetryTask(input.sourceTask) });
      } catch (error) {
        unresolved.push({ input, message: errorMessage(error) });
      }
    }

    const retried = refreshed.length > 0
      ? await this.migrateBatch({
          items: refreshed,
          stopOnFailure: options.stopOnFailure,
          batchId: options.batchId ?? `${previous.id}-retry`
        })
      : emptyFailedBatch(options.batchId ?? `${previous.id}-retry`);
    if (unresolved.length === 0) return retried;

    const offset = retried.items.length;
    const unresolvedResults = unresolved.map(({ input, message }, index) =>
      batchItemResult(offset + index, input, "error", { retryable: true, message })
    );
    return summarizeBatch(
      retried.id,
      [...retried.items, ...unresolvedResults],
      [...retried.retryItems, ...unresolved.map(({ input }) => input)]
    );
  }

  private async resolveRetryTask(task: TaskRecord): Promise<TaskRecord> {
    const content = await this.vault.read(task.path);
    const parsed = parseMarkdown(content, {
      path: task.path,
      sourceName: task.sourceName,
      scope: "meeting-draft"
    });
    const current = locateTask(parsed.tasks, task);
    if (!current) throw new Error(`Meeting action is no longer present in ${task.path}.`);
    if (!task.blockId && current.text !== task.text) {
      throw new Error(`Block-less meeting action changed at ${task.path}:${task.line}; retry requires manual confirmation.`);
    }
    return current;
  }
}

function batchItemResult(
  index: number,
  input: MeetingMigrationInput,
  outcome: MeetingMigrationBatchItemOutcome,
  detail: Partial<Omit<MeetingMigrationBatchItemResult, "index" | "sourcePath" | "sourceTaskId" | "targetPath" | "outcome" | "unresolvedPaths">> = {}
): MeetingMigrationBatchItemResult {
  return {
    index,
    sourcePath: input.sourceTask.path,
    sourceTaskId: input.sourceTask.id,
    targetPath: input.targetPath,
    outcome,
    retryable: detail.retryable ?? false,
    message: detail.message,
    targetBlockId: detail.targetBlockId,
    transactionId: detail.transactionId,
    receipt: detail.receipt,
    unresolvedPaths: detail.receipt?.unresolvedPaths ?? []
  };
}

function summarizeBatch(
  id: string,
  items: MeetingMigrationBatchItemResult[],
  retryItems: MeetingMigrationInput[]
): MeetingMigrationBatchResult {
  const migratedCount = items.filter((item) => item.outcome === "migrated").length;
  const alreadyMigratedCount = items.filter((item) => item.outcome === "already-migrated").length;
  const failedCount = items.filter((item) => ["failed", "conflict", "error"].includes(item.outcome)).length;
  const skippedCount = items.filter((item) => item.outcome === "skipped").length;
  const successfulCount = migratedCount + alreadyMigratedCount;
  return {
    id,
    status: failedCount + skippedCount === 0 ? "completed" : successfulCount > 0 ? "partial" : "failed",
    items,
    migratedCount,
    alreadyMigratedCount,
    failedCount,
    skippedCount,
    manualRepairPaths: [...new Set(items.flatMap((item) => item.unresolvedPaths))],
    retryItems
  };
}

function emptyFailedBatch(id: string): MeetingMigrationBatchResult {
  return summarizeBatch(id, [], []);
}

function migrationFailureMessage(receipt?: DetailedTransactionReceipt): string {
  if (!receipt) return "Migration failed without a transaction receipt.";
  const unresolved = receipt.unresolvedPaths.length > 0
    ? ` Unresolved paths: ${receipt.unresolvedPaths.join(", ")}.`
    : "";
  return `${receipt.status}: ${receipt.messages.join(" ")}${unresolved}`.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
