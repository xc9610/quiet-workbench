import { FileManager, TFile, Vault, normalizePath } from "obsidian";
import { contentRevision } from "../domain/markdown";
import { RevisionConflictError } from "../domain/transactions";
import { isPathInsideFolder, normalizeVaultPath, type VaultFileInfo, type VaultPort } from "./vault-port";

/** Production adapter; domain services never import Obsidian directly. */
export class ObsidianVaultAdapter implements VaultPort {
  constructor(private readonly vault: Vault, private readonly fileManager: FileManager) {}

  async listMarkdownFiles(folder: string): Promise<VaultFileInfo[]> {
    return this.vault
      .getMarkdownFiles()
      .filter((file) => isPathInsideFolder(file.path, folder))
      .map((file) => ({ path: file.path, mtime: file.stat.mtime, size: file.stat.size }));
  }

  async read(path: string): Promise<string> {
    return this.vault.read(this.requireFile(path));
  }

  async write(path: string, content: string, expectedRevision?: string): Promise<void> {
    const file = this.requireFile(path);
    await this.vault.process(file, (current) => {
      if (expectedRevision && contentRevision(current) !== expectedRevision) {
        throw new RevisionConflictError(file.path, expectedRevision, contentRevision(current));
      }
      return content;
    });
  }

  async create(path: string, content: string): Promise<void> {
    const normalized = normalizePath(normalizeVaultPath(path));
    await this.ensureParentFolder(normalized);
    await this.vault.create(normalized, content);
  }

  async trash(path: string): Promise<void> {
    const file = this.requireFile(path);
    await this.fileManager.trashFile(file);
  }

  async exists(path: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(normalizePath(normalizeVaultPath(path))) !== null;
  }

  async stat(path: string): Promise<VaultFileInfo | undefined> {
    const normalized = normalizePath(normalizeVaultPath(path));
    const file = this.vault.getAbstractFileByPath(normalized);
    return file instanceof TFile
      ? { path: file.path, mtime: file.stat.mtime, size: file.stat.size }
      : undefined;
  }

  private requireFile(path: string): TFile {
    const normalized = normalizePath(normalizeVaultPath(path));
    const file = this.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) throw new Error(`Markdown file not found: ${normalized}`);
    return file;
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const segments = path.split("/").slice(0, -1);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.vault.adapter.exists(current))) await this.vault.createFolder(current);
    }
  }
}
