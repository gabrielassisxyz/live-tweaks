import { expect, it } from "vitest";
import { LIVE_TWEAKS_VERSION } from "./main";

it("exposes a semver version", () => {
	expect(LIVE_TWEAKS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
