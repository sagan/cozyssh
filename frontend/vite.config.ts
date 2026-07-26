import fs from "fs";
import path from "path";
import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { VitePWA } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";
import jsonStringify from "json-stable-stringify";
import { walk } from "estree-walker";
import MagicString from "magic-string";

import { CACHE_API_DATA, CACHE_MANIFEST } from "./src/constants";

const debug = false;

process.env.VITE_APP_LANG = process.env.VITE_APP_LANG || "en";
let translations: Record<string, string> | undefined;
const localePath = path.resolve(__dirname, `./i18n/${process.env.VITE_APP_LANG}.json`);
if (process.env.VITE_APP_LANG !== "en") {
  // Let the build fail if the locale file doesn't exist
  translations = JSON.parse(fs.readFileSync(localePath, "utf-8"));
}

function compileTimeI18n() {
  let fileMutated = false;

  return {
    name: "vite-plugin-compile-i18n",
    transform(code: string, id: string) {
      // Only process layout files (adjust extension filter as needed)
      if (!id.endsWith(".tsx") && !id.endsWith(".jsx") && !id.endsWith(".ts")) {
        return null;
      }
      if (id.includes("node_modules")) {
        return null;
      }

      // 1. Parse code into AST using Vite/Rollup's built-in parser
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ast = (this as any).parse(code);
      const magicString = new MagicString(code);
      let hasChanges = false;

      // 2. Walk the AST to find t("...") calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      walk(ast as any, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        enter(node: any) {
          if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "t") {
            const firstArg = node.arguments[0];
            if (!firstArg) return;

            let originalText: string | null = null;

            // 1. Handle standard strings: t("Note") or t('Note')
            if (firstArg.type === "Literal" && typeof firstArg.value === "string") {
              originalText = firstArg.value;
            }
            // 2. Handle template literals without variables: t(`OpenSSH...`)
            else if (firstArg.type === "TemplateLiteral" && firstArg.expressions.length === 0) {
              // 'quasis' holds the actual string segments
              originalText = firstArg.quasis[0].value.cooked;
            }

            // 3. Replace if we found a valid static string
            if (originalText) {
              if (!translations) {
                return originalText;
              }

              if (translations[originalText] === undefined) {
                translations[originalText] = `__MISSING_TRANSLATION__[${originalText}]`;
                fileMutated = true;
                console.warn(
                  `[i18n] Automatically injected missing key "${originalText}" into ${process.env.VITE_APP_LANG}.json`,
                );
              }

              const translatedText = translations[originalText] || originalText;
              magicString.overwrite(node.start, node.end, JSON.stringify(translatedText));
              hasChanges = true;
            }
          }
        },
      });

      if (!hasChanges) {
        return null;
      }

      // Synchronize changes back to disk immediately after file transforms completes
      if (fileMutated) {
        fs.writeFileSync(localePath, jsonStringify(translations, { space: 2 })!, "utf-8");
      }

      return {
        code: magicString.toString(),
        map: magicString.generateMap({ hires: true }), // Keeps your sourcemaps perfect
      };
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    emptyOutDir: true,
    sourcemap: true,
    minify: !debug,
  },
  resolve: debug
    ? {
        alias: {
          // Swaps the standard renderer for the profiling-enabled renderer
          "react-dom/client": "react-dom/profiling",
          // If your app or third-party libraries use the old scheduler directly:
          "scheduler/tracing": "scheduler/tracing-profiling",
        },
      }
    : undefined,
  plugins: [
    compileTimeI18n(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script",
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,md,json,ico,png,svg}"],
        navigateFallback: "index.html",
        // Only apply navigateFallback to page navigation requests, not API/debug endpoints
        navigateFallbackAllowlist: [/^\/(?!api\/|debug\/|manifest\.json)/],
        // Ignore all query parameters when matching precached entries.
        // Without this, /?noautoload=1 fails to match the cached "/" entry → ERR_FAILED.
        ignoreURLParametersMatching: [/.*/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
        runtimeCaching: [
          {
            urlPattern: /\/manifest\.json$/,
            handler: "NetworkFirst",
            options: {
              cacheName: CACHE_MANIFEST,
              expiration: {
                maxEntries: 1,
              },
            },
          },
          {
            urlPattern: /\/api\/(?:fulldata|hosts)$/,
            handler: "NetworkFirst",
            options: {
              cacheName: CACHE_API_DATA,
              expiration: {
                maxEntries: 100,
                // maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
      manifest: false,
    }),
    process.env.VITE_APP_LANG !== "en" &&
      viteStaticCopy({
        targets: [
          {
            // Path to the file you want to copy
            src: `i18n/${process.env.VITE_APP_LANG}.app.json`,
            // Target directory inside 'dist' (resolves to dist/)
            dest: "",
            rename: { stripBase: true, name: "i18n.app.json" },
          },
        ],
      }),
  ],
});
