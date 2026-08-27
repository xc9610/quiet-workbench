import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const readJson = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
const packageJson = readJson("package.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const errors = [];
const requiredFiles = ["README.md", "LICENSE", "manifest.json", "main.js", "styles.css"];

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  errors.push(`manifest.version must be a plain semantic version: ${manifest.version}`);
}
if (packageJson.version !== manifest.version) {
  errors.push(`package.json version ${packageJson.version} does not match manifest ${manifest.version}`);
}
if (manifest.id !== packageJson.name) {
  errors.push(`manifest.id ${manifest.id} does not match package name ${packageJson.name}`);
}
if (manifest.isDesktopOnly !== false) {
  errors.push("manifest.isDesktopOnly must remain false for mobile support");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  errors.push(`versions.json must map ${manifest.version} to ${manifest.minAppVersion}`);
}
for (const file of requiredFiles) {
  const path = resolve(root, file);
  if (!existsSync(path) || statSync(path).size === 0) errors.push(`Missing or empty release file: ${file}`);
}

const expectedTag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
if (expectedTag && expectedTag !== manifest.version) {
  errors.push(`Release tag must equal manifest.version exactly (expected ${manifest.version}, got ${expectedTag})`);
}

if (errors.length > 0) {
  console.error(`${manifest.name} release check failed:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`${manifest.name} ${manifest.version} release files are ready.`);
  console.log(`Tag: ${manifest.version} (without a leading v)`);
  console.log(`Minimum Obsidian version: ${manifest.minAppVersion}`);
}
