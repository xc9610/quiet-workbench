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
}
