#!/usr/bin/env bash
# T7 spike runner — throwaway evidence harness (NOT part of the build).
#
# Playwright is deliberately kept OUT of package.json (a browser dependency has
# no place in a lib that never ships one). To run the spike you must provide a
# Playwright install whose bundled Chromium revision is already downloaded, then
# make it resolvable from this project's node_modules.
#
# Usage:
#   PLAYWRIGHT_PKG_DIR=/path/to/node_modules bin/../spike/run.sh [out_dir]
#
# PLAYWRIGHT_PKG_DIR must contain both `playwright` and `playwright-core`
# (e.g. an `npx playwright` cache dir under ~/.npm/_npx/*/node_modules, or a
# global install). ESM ignores NODE_PATH, so we symlink the two packages into
# node_modules for the duration of the run.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-spike-out}"
: "${PLAYWRIGHT_PKG_DIR:?set PLAYWRIGHT_PKG_DIR to a node_modules holding playwright + playwright-core}"

for pkg in playwright playwright-core; do
	if [ ! -d "$PLAYWRIGHT_PKG_DIR/$pkg" ]; then
		echo "missing $pkg in $PLAYWRIGHT_PKG_DIR" >&2
		exit 1
	fi
	ln -sfn "$PLAYWRIGHT_PKG_DIR/$pkg" "node_modules/$pkg"
done

node spike/drive-spike.mjs "$OUT"
