import devServer from "@hono/vite-dev-server"
import path from "path"
import { execSync } from "node:child_process"
import fs from "node:fs"
import crypto from "node:crypto"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

function hashWorkingTreeChanges() {
  const h = crypto.createHash('sha256');
  // Changes relative to HEAD (staged + unstaged). Use a large buffer because
  // binary assets can produce multi-megabyte diffs.
  try {
    h.update(execSync('git diff --binary HEAD', { maxBuffer: 100 * 1024 * 1024 }).toString());
  } catch {}
  // Untracked files (ignored files excluded).
  try {
    const untracked = execSync('git ls-files --others --exclude-standard').toString().trim();
    for (const f of untracked.split('\n').filter(Boolean)) {
      try {
        h.update(fs.readFileSync(f));
      } catch {}
    }
  } catch {}
  return h.digest('hex').slice(0, 8);
}

function resolveVersion() {
  if (process.env.BUILD_VERSION) return process.env.BUILD_VERSION;
  try {
    const base = execSync('git rev-parse --short HEAD').toString().trim();
    const dirty = execSync('git status --porcelain').toString().trim();
    if (!dirty) return base;
    return `${base}-dirty-${hashWorkingTreeChanges()}`;
  } catch {
    return 'dev';
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(),
    react(),
    {
      name: "write-version-json",
      writeBundle() {
        const outDir = path.resolve(__dirname, "dist/public");
        fs.writeFileSync(
          path.join(outDir, "version.json"),
          JSON.stringify({ version: resolveVersion(), builtAt: new Date().toISOString() }, null, 2)
        );
      },
    },
    {
      name: "inject-build-version-html",
      transformIndexHtml(html) {
        return html.replace(
          /<head>/i,
          `<head>\n    <meta name="build-version" content="${resolveVersion().replace(/"/g, '&quot;')}">`
        );
      },
    },
  ],
  define: {
    __BUILD_VERSION__: JSON.stringify(resolveVersion()),
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    // Manual chunking keeps the heavy game engine vendors cacheable separately
    // from app code. three.js alone is ~600KB; without this everything lands in
    // a single 1.7MB chunk that busts on every code change.
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor splits — keeps heavy libs in their own long-lived chunks so
          // app code changes don't re-download three.js / react / radix.
          if (id.includes('node_modules')) {
            if (id.includes('/three/') || id.includes('three-stdlib') || id.includes('/meshoptimizer/')) return 'three';
            if (id.includes('/gsap/') || id.includes('/framer-motion/') || id.includes('/lenis/')) return 'animation';
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/') || id.includes('/react-router/')) return 'react';
            if (id.includes('/@radix-ui/')) return 'radix';
            if (id.includes('/lucide-react/')) return 'icons';
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
