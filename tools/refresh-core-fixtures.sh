#!/usr/bin/env bash
# Re-download e2e/fixtures/core/ (the files the pages load from core.anawj.com) for the file list already there. After a
# version change in app/index.html: delete the old version's folder, add the new files (a file missing from the copy
# answers 404 "not in e2e/fixtures/core: <path>" in the run; follow the relative imports from the ui, theme and settings
# index.js files), then run this. It first checks that every core.anawj.com version pinned in app/index.html has a folder.
set -euo pipefail
root="$(dirname "$0")/.."
cd "$root/e2e/fixtures/core"
grep -o 'core\.anawj\.com/[^"]*' ../../../app/index.html | sed 's|core\.anawj\.com/||; s|/[^/]*$||' | sed -E 's|^(ui\|sync)/([^/]+)/.*|\1/\2|' | sort -u | while read -r d; do
  [ -d "$d" ] || { echo "no fixture folder for pinned $d" >&2; exit 1; }
done
find . -type f | sed 's|^\./||' | while read -r p; do curl -sfS "https://core.anawj.com/$p" -o "$p"; done
