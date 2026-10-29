#!/usr/bin/env bash
# One command that readies a fresh clone (a new laptop or a cloud container) for every check in the README's "Tests":
#   - .devkit/: app-devkit's playwright/, rules/, tools/ and worker/ at the version checks.yml pins (CI's setup blocks
#     put the same folders there); skipped when .devkit/VERSION already names that version
#   - npm ci (skip with SKIP_NPM=1)
#   - the environment the tests need on a machine with no Google metadata server and maybe no Playwright download:
#     METADATA_SERVER_DETECTION=none (firebase-tools stops probing for one) and PW_CHROMIUM (a Chromium already on the
#     machine, /opt/pw-browsers/chromium when it is there; playwright.config.mjs launches it)
#
#   . tools/dev-setup.sh       sourced: also sets those variables in this shell
#   bash tools/dev-setup.sh    run: does the same, then prints the export lines to paste
# DEVKIT_REF=<tag> picks another app-devkit version; DEVKIT_URL another clone address.
_dev_setup() {
  local root ref url tmp
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || return 1
  ref="${DEVKIT_REF:-$(grep -oE 'app-devkit/setup-[a-z]+@v[0-9][0-9.]*' "$root/.github/workflows/checks.yml" | head -1 | sed 's/.*@//')}"
  url="${DEVKIT_URL:-https://github.com/flamingbeing/app-devkit}"
  if [ -z "$ref" ]; then echo "dev-setup: no app-devkit version in .github/workflows/checks.yml; set DEVKIT_REF" >&2; return 1; fi

  if [ "$(cat "$root/.devkit/VERSION" 2>/dev/null)" = "$ref" ]; then
    echo "dev-setup: .devkit/ already at app-devkit $ref"
  else
    tmp="$(mktemp -d)" || return 1
    git clone -q --depth 1 --branch "$ref" "$url" "$tmp/devkit" 2>/dev/null \
      || { echo "dev-setup: could not clone app-devkit $ref from $url" >&2; rm -rf "$tmp"; return 1; }
    rm -rf "$root/.devkit" && mkdir -p "$root/.devkit"
    cp -R "$tmp/devkit/playwright" "$tmp/devkit/rules" "$tmp/devkit/tools" "$tmp/devkit/worker" "$root/.devkit/"
    echo "$ref" > "$root/.devkit/VERSION"
    rm -rf "$tmp"
    echo "dev-setup: .devkit/ <- app-devkit $ref"
  fi

  export METADATA_SERVER_DETECTION=none
  if [ -z "${PW_CHROMIUM:-}" ] && [ -x /opt/pw-browsers/chromium ]; then export PW_CHROMIUM=/opt/pw-browsers/chromium; fi

  if [ -z "${SKIP_NPM:-}" ]; then (cd "$root" && npm ci --no-audit --no-fund) || return 1; fi
  command -v java >/dev/null || echo "dev-setup: no java on PATH; npm run rules and npm run e2e need it (the Firestore emulator)" >&2

  echo "export METADATA_SERVER_DETECTION=none"
  [ -n "${PW_CHROMIUM:-}" ] && echo "export PW_CHROMIUM=$PW_CHROMIUM"
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  _dev_setup || exit 1
else
  _dev_setup
fi
