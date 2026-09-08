import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";

const production = process.argv[2] === "production";
const scriptContext = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: "main.js",
  plugins: [sveltePlugin({ compilerOptions: { css: "injected", runes: false } })]
});

const styleContext = await esbuild.context({
  entryPoints: ["src/styles/index.css"],
  bundle: true,
  target: "es2022",
  logLevel: "info",
  minify: production,
  outfile: "styles.css"
});

if (production) {
  await Promise.all([scriptContext.rebuild(), styleContext.rebuild()]);
  await Promise.all([scriptContext.dispose(), styleContext.dispose()]);
} else {
  await Promise.all([scriptContext.watch(), styleContext.watch()]);
}
