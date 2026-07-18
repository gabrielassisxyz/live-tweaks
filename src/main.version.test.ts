import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { LIVE_TWEAKS_VERSION } from "./main";

// The panel reports LIVE_TWEAKS_VERSION at runtime while npm publishes package.json's
// `version`. They are two hand-editable copies of one fact, so `bin/sync-version` keeps
// them in step during `npm version` and this test fails bin/ci if anything bypasses it.
describe("LIVE_TWEAKS_VERSION", () => {
	it("matches the published package version", () => {
		expect(LIVE_TWEAKS_VERSION).toBe(manifest.version);
	});
});
