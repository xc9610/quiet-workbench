declare const __ASTERISM_VERSION__: string | undefined;

/** Injected from manifest.json at build time, so the UI can never show a stale version again. */
export const ASTERISM_VERSION: string = typeof __ASTERISM_VERSION__ === "string" ? __ASTERISM_VERSION__ : "dev";
