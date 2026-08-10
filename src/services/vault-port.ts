export interface VaultFileInfo {
  path: string;
  mtime: number;
  size: number;
}

/** A deliberately small boundary implemented by Obsidian's Vault adapter in the plugin layer. */
export interface VaultPort {
  listMarkdownFiles(folder: string): Promise<VaultFileInfo[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string, expectedRevision?: string): Promise<void>;
  create(path: string, content: string): Promise<void>;
  trash(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<VaultFileInfo | undefined>;
}

export function normalizeVaultPath(path: string): string {
  const value = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
  if (!value || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    throw new Error(`Vault path must be relative: ${path}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new Error(`Unsafe Vault path: ${path}`);
  }
  return value;
}

export function isPathInsideFolder(path: string, folder: string): boolean {
  const normalizedPath = normalizeVaultPath(path);
  const normalizedFolder = normalizeVaultPath(folder).replace(/\/$/, "");
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}
