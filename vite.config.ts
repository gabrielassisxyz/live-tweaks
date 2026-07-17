import { defineConfig } from "vite";

// Lib mode with a single IIFE output: the deliverable is one injectable file
// (script snippet or bookmarklet), never an ESM bundle with chunks.
export default defineConfig({
	build: {
		lib: {
			entry: "src/main.ts",
			name: "LiveTweaks",
			formats: ["iife"],
			fileName: () => "live-tweaks.js",
		},
	},
});
