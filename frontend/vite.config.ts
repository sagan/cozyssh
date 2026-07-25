import fs from "fs";
import path from "path";
import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { VitePWA } from "vite-plugin-pwa";
import jsonStringify from "json-stable-stringify";

import { CACHE_API_DATA, CACHE_MANIFEST } from "./src/constants";

const debug = false;
process.env.VITE_APP_LANG = process.env.VITE_APP_LANG || "en";

function compileTimeI18nPlugin() {
  const lang = process.env.VITE_APP_LANG;
  const localePath = path.resolve(__dirname, `./i18n/${lang}.json`);
  let translations: Record<string, string> | undefined;

  if (lang !== "en") {
    // Let the build fail if the locale file doesn't exist
    translations = JSON.parse(fs.readFileSync(localePath, "utf-8"));
  }

  return {
    name: "vite-plugin-compile-i18n",
    enforce: "pre" as const,

    transform(code: string, id: string) {
      if (!/\.(t|j)sx?$/.test(id) || id.includes("node_modules")) {
        return;
      }

      // Matches: \bt(...)
      // Group 1: The translation key
      // Group 2: The optional variables object block (including nested braces)
      const tRegex = /\bt\s*\(\s*['"`](.*?)['"`](?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/g;

      let fileMutated = false;

      const transformedCode = code.replace(tRegex, (match, key, varsObjectStr) => {
        if (!translations) {
          return JSON.stringify(key);
        }
        const translationTemplate = translations[key];

        if (translationTemplate === undefined) {
          // Detect placeholders in the runtime variable block to pre-populate them nicely
          let placeholderPattern = "";
          if (varsObjectStr) {
            // Find key properties in the passed object to guess placeholder names
            const propRegex = /([a-zA-Z0-9_]+)\s*:/g;
            let matchProp;
            const foundVars: string[] = [];
            while ((matchProp = propRegex.exec(varsObjectStr)) !== null) {
              foundVars.push(`{${matchProp[1]}}`);
            }
            placeholderPattern = foundVars.length ? ` ${foundVars.join(" ")}` : "";
          }

          // Save the missing key with a fallback string value
          translations[key] = `__MISSING_TRANSLATION__ [${key}]${placeholderPattern}`;
          fileMutated = true;
          console.warn(`[i18n] Automatically injected missing key "${key}" into ${lang}.json`);
        }

        // Case A: No variables provided. Return normal string literal.
        if (!varsObjectStr) {
          return JSON.stringify(translationTemplate);
        }

        // Case B: Variables provided. Convert "{variable}" into "${___}" template literal.
        // We evaluate variables by looking up fields on the matching JS object string passed in.

        // 1. Create a safe unique reference variable name for our runtime block
        const varMapName = `_i18nVars`;

        // 2. Turn "Welcome, {name}!" into a JS template string pattern
        const templateLiteralStr = translationTemplate.replace(/\{([^}]+)\}/g, (_, varName) => {
          return `\${${varMapName}.${varName.trim()}}`;
        });

        // 3. Output an Immediately Invoked Function Expression (IIFE) or block to execute it seamlessly in JSX
        // Transforms into: ((_i18nVars) => `Welcome back, ${_i18nVars.name}!`)({ name: "John" })
        return `((_${varMapName}) => \`${templateLiteralStr}\`)(${varsObjectStr})`;
      });

      // Synchronize changes back to disk immediately after file transforms completes
      if (fileMutated) {
        fs.writeFileSync(localePath, jsonStringify(translations, { space: 2 })!, "utf-8");
      }

      return { code: transformedCode, map: null };
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
    compileTimeI18nPlugin(),
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
  ],
});
