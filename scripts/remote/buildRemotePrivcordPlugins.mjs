#!/usr/bin/env node
// Build remote runtime bundles for plugins under src/kernixcordplugins
// Output: remote-plugins/<PluginName>.js and updates remote-plugins/manifest.json

import { build } from "esbuild";
import { mkdir, readdir, readFile, rm, writeFile, stat } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..",
);
const srcPriv = join(repoRoot, "src/kernixcordplugins");
const outDir = join(repoRoot, "remote-plugins");

const PluginDefinitionNameMatcher = /definePlugin\(\{\s*(\"|')?name\1:\s*(\"|'|`)(.+?)\2/;

async function resolvePluginName(entryFile) {
  const content = await readFile(entryFile, "utf-8");
  const m = PluginDefinitionNameMatcher.exec(content);
  return m?.[3] ?? null;
}

async function getEntryFor(direntName) {
  const base = join(srcPriv, direntName);
  const cand = ["index.tsx", "index.ts", "index.js", "index.jsx"].map(f => join(base, f));
  for (const f of cand) {
    try { await stat(f); return f; } catch { }
  }
  return null;
}

function pathAliasPlugin() {
  return {
    name: "alias",
    setup(build) {
      const map = new Map([
        ["@api/", join(repoRoot, "src/api/")],
        ["@components/", join(repoRoot, "src/components/")],
        ["@utils/", join(repoRoot, "src/utils/")],
        ["@shared/", join(repoRoot, "src/shared/")],
        ["@webpack/", join(repoRoot, "src/webpack/")],
        ["@plugins/", join(repoRoot, "src/plugins/")],
        ["@equicordplugins/", join(repoRoot, "src/equicordplugins/")],
        ["@kernixcordplugins/", join(repoRoot, "src/kernixcordplugins/")],
      ]);
      build.onResolve({ filter: /^(?:@api|@components|@utils|@shared|@webpack|@plugins|@equicordplugins|@kernixcordplugins)\// }, args => {
        for (const [prefix, tgt] of map) {
          if (args.path.startsWith(prefix)) {
            return { path: join(tgt, args.path.slice(prefix.length)) };
          }
        }
      });
    }
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const entries = await readdir(srcPriv, { withFileTypes: true });
  const plugins = [];

  for (const d of entries) {
    const name = d.name;
    if (name.startsWith("_") || name.startsWith(".")) continue;
    if (!d.isDirectory()) continue;

    const entry = await getEntryFor(name);
    if (!entry) continue;

    const pluginName = await resolvePluginName(entry) || name;

    const virtualEntry = join(repoRoot, `.tmp-remote-${pluginName}.ts`);
    const wrapper = `import plugin from ${JSON.stringify(entry)};\nwindow.KernixcordRemote?.register(plugin as any);`;
    await writeFile(virtualEntry, wrapper);

    const outfile = join(outDir, `${pluginName}.js`);

    try {
      await build({
        entryPoints: [virtualEntry],
        bundle: true,
        minify: true,
        format: "iife",
        platform: "browser",
        target: ["esnext"],
        outfile,
        plugins: [pathAliasPlugin()],
        define: {
          "process.env.NODE_ENV": '"production"'
        },
        external: [
          "electron",
          "original-fs"
        ]
      });
      plugins.push({ name: pluginName, file: `${pluginName}.js` });
    } catch (e) {
      console.error("Failed to build", pluginName, e?.message || e);
    } finally {
      await rm(virtualEntry, { force: true });
    }
  }

  // Write manifest
  const remote = process.env.GITHUB_REPOSITORY || "kanvekin/Kernixcord";
  const body = {
    plugins: plugins.map(p => ({
      name: p.name,
      url: `https://raw.githubusercontent.com/${remote}/main/remote-plugins/${p.file}`
    }))
  };
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(body, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
