#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build an OS1 Fiber Track Pro release package for the System Update Center.
#
# Produces, in the output directory (default: dist/):
#   os1-fiber-track-pro-v<VERSION>.tar.gz   - the application source at this commit
#   manifest.json                            - version/checksum/(signature) metadata
#   SHA256SUMS                               - checksums of the release artifacts
#   release-notes.md                         - human-readable notes
#
# The tarball is a clean `git archive` of the tracked source (no node_modules,
# no .env, no build output) so it is reproducible and secret-free. The host
# installer (scripts/install-update.sh) rebuilds the image from this source.
#
# Usage:
#   scripts/build-release.sh [--channel STABLE|RC|BETA] [--min <version>] \
#       [--notes-file <path>] [--private-key <pem>] [--algo RSA-SHA256|ed25519] \
#       [--out <dir>]
#
# Signing is optional but STRONGLY recommended: set --private-key to sign the
# manifest so the updater can verify authenticity (with the matching public key
# configured in the Update Center) in addition to the SHA-256 checksum.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL="STABLE"
MIN=""
NOTES_FILE=""
PRIVATE_KEY=""
ALGO="RSA-SHA256"
OUT="dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="$2"; shift 2;;
    --min) MIN="$2"; shift 2;;
    --notes-file) NOTES_FILE="$2"; shift 2;;
    --private-key) PRIVATE_KEY="$2"; shift 2;;
    --algo) ALGO="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    *) echo "Unknown option: $1" >&2; exit 1;;
  esac
done

VERSION="$(node -p "require('./package.json').version")"
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
SLUG="os1-fiber-track-pro"
TARBALL="${SLUG}-v${VERSION}.tar.gz"

mkdir -p "$OUT"
echo "==> Building release ${VERSION} (${CHANNEL}) commit ${COMMIT:0:12}"

# 1) Clean source archive of tracked files at HEAD.
git archive --format=tar.gz --prefix="${SLUG}-${VERSION}/" -o "${OUT}/${TARBALL}" HEAD
echo "==> Wrote ${OUT}/${TARBALL}"

# 2) Release notes.
if [[ -n "$NOTES_FILE" && -f "$NOTES_FILE" ]]; then
  cp "$NOTES_FILE" "${OUT}/release-notes.md"
else
  {
    echo "# OS1 Fiber Track Pro ${VERSION}"
    echo
    echo "- Channel: ${CHANNEL}"
    echo "- Commit: ${COMMIT}"
    echo "- Build date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo "See CHANGELOG.md for the full list of changes."
  } > "${OUT}/release-notes.md"
fi
echo "==> Wrote ${OUT}/release-notes.md"

# 3) Manifest (+ optional signature). Uses the shared canonicalization helper so
#    the in-app verifier accepts the signature.
MANIFEST_ARGS=(--package "${OUT}/${TARBALL}" --version "${VERSION}" --commit "${COMMIT}" \
  --channel "${CHANNEL}" --notes-file "${OUT}/release-notes.md" --out "${OUT}/manifest.json")
[[ -n "$MIN" ]] && MANIFEST_ARGS+=(--min "$MIN")
if [[ -n "$PRIVATE_KEY" ]]; then MANIFEST_ARGS+=(--private-key "$PRIVATE_KEY" --algo "$ALGO"); fi
node scripts/release/make-manifest.mjs "${MANIFEST_ARGS[@]}"

# 4) SHA256SUMS over the release artifacts.
( cd "$OUT" && sha256sum "${TARBALL}" manifest.json release-notes.md > SHA256SUMS )
echo "==> Wrote ${OUT}/SHA256SUMS"

echo
echo "Release artifacts ready in ${OUT}/:"
ls -1 "$OUT"
echo
if [[ -z "$PRIVATE_KEY" ]]; then
  echo "NOTE: package is UNSIGNED. Configure a public key + Require Signature in the"
  echo "      Update Center to enforce authenticity, and re-run with --private-key."
fi
echo "Upload these as assets on the GitHub release tagged v${VERSION}."
