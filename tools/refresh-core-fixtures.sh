#!/usr/bin/env bash
# Re-download e2e/fixtures/core/ (the sync and update files the pages load from core.anawj.com; the UI kit loads live,
# e2e/fixtures.mjs) for the file list already there. After a version change in app/index.html: delete the old version's
# folder, add the new files (a file missing from the copy answers 404 "not in e2e/fixtures/core: <path>" in the run),
# then run this. It first checks that every sync and update version pinned in app/index.html has a folder.
set -euo pipefail
root="$(dirname "$0")/.."
cd "$root/e2e/fixtures/core"
grep -o 'core\.anawj\.com/[^"]*' ../../../app/index.html | sed 's|core\.anawj\.com/||; s|/[^/]*$||' | sed -E 's|^(sync)/([^/]+)/.*|\1/\2|' | grep -v '^ui/' | sort -u | while read -r d; do
  [ -d "$d" ] || { echo "no fixture folder for pinned $d" >&2; exit 1; }
done
find . -type f | sed 's|^\./||' | while read -r p; do curl -sfS "https://core.anawj.com/$p" -o "$p"; done
