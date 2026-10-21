import { build, context } from "esbuild";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The Web server parses PDF, Word and Excel uploads in worker threads running this
// bundle (src/lib/ai/document-worker.server.ts looks for it here). `pnpm build:agent`
// builds it with the Agent worker; `pnpm dev` rebuilds it on change (--watch).
export const DOCUMENT_WORKER_FILE = ".agent/document-text-worker.mjs";

// unpdf ships pdf.js inside its own bundle, under pdf.js's license rather than unpdf's.
const EMBEDDED_LICENSES = { "pdf.js": "node_modules/pdfjs-dist/LICENSE" };

const options = (outfile) => ({
  entryPoints: ["src/lib/ai/document-text.worker.ts"],
  outfile,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  logLevel: "warning",
  metafile: true,
  // Bundled CommonJS dependencies require Node built-ins.
  banner: {
    js: 'import { createRequire as documentCreateRequire } from "node:module"; const require = documentCreateRequire(import.meta.url);',
  },
  plugins: [
    {
      name: "server-only-marker",
      setup(builder) {
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "marker",
        }));
        builder.onLoad({ filter: /.*/, namespace: "marker" }, () => ({
          contents: "export {};",
          loader: "js",
        }));
      },
    },
  ],
});

/** The installed package directories whose code esbuild bundled. */
function bundledPackages(metafile) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const match = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//u.exec(input);
    if (match) packages.set(match[2], match[1]);
  }
  return packages;
}

/** Ships each bundled package's license beside the bundle, as the Agent worker build does. */
async function copyLicenses(metafile, directory) {
  await mkdir(directory, { recursive: true });
  const licenses = new Map(Object.entries(EMBEDDED_LICENSES));
  for (const [name, root] of bundledPackages(metafile)) {
    const file = (await readdir(root)).find((entry) => /^licen[cs]e(?:\.(?:md|txt))?$/iu.test(entry));
    if (!file) throw new Error(`Document worker dependency ${name} ships no license file`);
    licenses.set(name, path.join(root, file));
  }
  for (const [name, source] of licenses) {
    await copyFile(source, path.join(directory, `${name.replace("/", "+")}.LICENSE`));
  }
}

export async function buildDocumentWorker(outfile = DOCUMENT_WORKER_FILE) {
  const result = await build(options(outfile));
  await copyLicenses(result.metafile, path.join(path.dirname(outfile), "licenses"));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--watch")) {
    const watcher = await context(options(DOCUMENT_WORKER_FILE));
    await watcher.watch();
    console.info(`Watching the document worker (${DOCUMENT_WORKER_FILE})`);
  } else {
    await buildDocumentWorker(process.argv[2]);
  }
}
