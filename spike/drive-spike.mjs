// T7 spike driver — throwaway evidence harness (NOT product code).
//
// Drives a real Chromium via Playwright against demo/spike-tweakpane.html to
// answer the D1 gate: does Tweakpane 4.0.5 work inside an open Shadow DOM —
// (1) mount, (2) style-clone workaround makes it render styled, (3) color
// picker popup opens, (4) click-drag inside the popup keeps it open and
// changes the value, (5) keyboard focus/typing works.
//
// Playwright is intentionally NOT a project dependency (it would bloat the
// lockfile of a lib that never ships a browser). Provide it out-of-tree before
// running — see spike/run.sh. Screenshots + a JSON verdict are written to the
// output dir passed as argv[2] (default: ./spike-out).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = process.argv[2] || join(ROOT, "spike-out");

const MIME = {
	".html": "text/html",
	".css": "text/css",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".json": "application/json",
};

function startServer() {
	const server = createServer(async (req, res) => {
		try {
			const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
			const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
			const filePath = join(ROOT, safe);
			const body = await readFile(filePath);
			res.writeHead(200, {
				"content-type": MIME[extname(filePath)] || "application/octet-stream",
			});
			res.end(body);
		} catch {
			res.writeHead(404);
			res.end("not found");
		}
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

const results = {};
function record(name, pass, detail) {
	results[name] = { pass, detail };
	console.log(
		`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
	);
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const server = await startServer();
	const { port } = server.address();
	const base = `http://127.0.0.1:${port}`;
	const url = `${base}/demo/spike-tweakpane.html`;

	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
	const consoleErrors = [];
	page.on("console", (m) => {
		if (m.type() === "error") consoleErrors.push(m.text());
	});
	page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

	await page.goto(url, { waitUntil: "networkidle" });
	await page.waitForFunction(() => window.__spike?.pane, null, {
		timeout: 5000,
	});

	// (1) Mount: the pane's root element exists inside the shadow root.
	const mounted = await page.locator(".tp-rotv").count();
	record("mount", mounted > 0, `tp root elements in shadow DOM: ${mounted}`);

	// (2) Style-clone workaround: the tp stylesheet is present in the shadow root
	// AND actually applies (a tp element gets a non-transparent background from it,
	// which it would NOT without the clone since shadow DOM blocks document styles).
	// In 4.0.5 the default sheet's attribute is data-tp-style="plugin-default".
	const cloned = await page.evaluate(() => window.__spike.clonedDefaultStyle);
	const styledBg = await page.evaluate(() => {
		const el = window.__spike.shadow.querySelector(".tp-rotv");
		return el ? getComputedStyle(el).backgroundColor : null;
	});
	const isStyled =
		styledBg && styledBg !== "rgba(0, 0, 0, 0)" && styledBg !== "transparent";
	record(
		"style-clone",
		cloned && isStyled,
		`clonedDefaultStyle=${cloned}, tp-rotv bg=${styledBg}`,
	);

	await page.screenshot({ path: join(OUT, "01-mounted-styled.png") });

	// (3) Color popup opens on click. The swatch BUTTON is .tp-colswv_b (note:
	// .tp-colv_t is the adjacent hex text field, not the swatch — clicking that
	// does NOT open the picker).
	const swatch = page.locator(".tp-colswv_b").first();
	await swatch.click();
	await page.waitForTimeout(150);
	const popupOpenAfterClick = await page.locator(".tp-popv-v").count();
	record(
		"popup-opens",
		popupOpenAfterClick > 0,
		`visible popups (.tp-popv-v): ${popupOpenAfterClick}`,
	);
	await page.screenshot({ path: join(OUT, "02-popup-open.png") });

	// (4) Click-drag inside the SV plane (.tp-svpv): popup must STAY open (the
	// event-retargeting / composedPath failure mode from D1 would close it), and
	// the bound value must change.
	const before = await page.evaluate(() => window.__spike.getPrimary());
	const sv = page.locator(".tp-svpv").first();
	const box = await sv.boundingBox();
	if (!box) {
		record("popup-clickdrag", false, "SV plane not found / not visible");
	} else {
		const startX = box.x + box.width * 0.3;
		const startY = box.y + box.height * 0.3;
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, {
			steps: 8,
		});
		await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, {
			steps: 5,
		});
		await page.mouse.up();
		await page.waitForTimeout(150);
		const stillOpen = (await page.locator(".tp-popv-v").count()) > 0;
		const after = await page.evaluate(() => window.__spike.getPrimary());
		const applied = await page.evaluate(() =>
			window.__spike.getAppliedPrimary(),
		);
		record(
			"popup-clickdrag",
			stillOpen && after !== before,
			`stayOpen=${stillOpen}, value ${before} -> ${after}, page --color-primary applied=${applied}`,
		);
	}
	await page.screenshot({ path: join(OUT, "03-after-drag.png") });

	// (5) Keyboard focus: focus the font text input, select-all, type a new stack,
	// commit with Enter, and confirm the bound value changed via keyboard alone.
	// Close the color popup first by clicking elsewhere.
	await page.mouse.click(20, 400);
	await page.waitForTimeout(100);
	const fontBefore = await page.evaluate(() => window.__spike.getFontBody());
	const textInput = page.locator(".tp-txtv_i").last();
	await textInput.focus();
	const focusedIsInput = await page.evaluate(() => {
		const a = window.__spike.shadow.activeElement;
		return a ? a.className : "(none)";
	});
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.type("Georgia, serif");
	await page.keyboard.press("Enter");
	await page.waitForTimeout(100);
	const fontAfter = await page.evaluate(() => window.__spike.getFontBody());
	record(
		"keyboard-focus",
		focusedIsInput.includes("tp-txtv_i") &&
			fontAfter === "Georgia, serif" &&
			fontAfter !== fontBefore,
		`shadow.activeElement=${focusedIsInput}, font ${fontBefore} -> ${fontAfter}`,
	);
	await page.screenshot({ path: join(OUT, "04-keyboard.png") });

	record(
		"no-console-errors",
		consoleErrors.length === 0,
		consoleErrors.join(" | ") || "none",
	);

	await browser.close();
	server.close();

	const verdict = Object.values(results).every((r) => r.pass) ? "PASS" : "FAIL";
	const summary = { verdict, tweakpane: "4.0.5", results };
	await writeFile(join(OUT, "verdict.json"), JSON.stringify(summary, null, 2));
	console.log(`\nGATE VERDICT: ${verdict}`);
	console.log(`screenshots + verdict.json in: ${OUT}`);
	process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
