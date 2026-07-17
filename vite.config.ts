import { defineConfig } from "vite";

// Lib mode, two outputs (PLAN D14 — UMD is forbidden):
//   - iife  -> dist/live-tweaks.js   the injectable script/bookmarklet artifact.
//   - es    -> dist/live-tweaks.es.js a real ESM entry with genuine `export`
//     statements (main.ts's named exports), so `import("live-tweaks")` in a
//     bundler app resolves to actual ESM, not an IIFE that merely happens to
//     parse as one (D14's documented accident to avoid).
export default defineConfig({
	build: {
		lib: {
			entry: "src/main.ts",
			// NOT "LiveTweaks": the iife format's global-name binding runs *after*
			// the module body (`var <name> = (iife)(...)`), so naming it
			// "LiveTweaks" would silently overwrite `window.LiveTweaks` — set by
			// main.ts's own `init()` side effect, mid-module — with the raw
			// module-exports object once the IIFE returns, clobbering `.dump`/
			// `.rescan` with the wrong shape. `init()` is the only thing that may
			// own `window.LiveTweaks`; this internal binding is never referenced.
			name: "__liveTweaksModule",
			formats: ["iife", "es"],
			fileName: (format) =>
				format === "es" ? "live-tweaks.es.js" : "live-tweaks.js",
		},
	},
});
