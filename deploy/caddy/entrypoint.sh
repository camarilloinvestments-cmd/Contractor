#!/bin/sh
# ---------------------------------------------------------------------------
# OS1 Fiber Track Pro - proxy (Caddy) entrypoint.
#
# Renders an EFFECTIVE Caddyfile at runtime and starts Caddy against it. This
# exists so we can:
#   * enable the internal admin API (bound inside the container network only,
#     never published to the host) so the app can perform explicit, fail-closed
#     config reloads via the admin endpoint instead of relying on a
#     filesystem config-watcher flag;
#   * emit the global `email` directive ONLY when ACME_EMAIL is set — Caddy's
#     caddyfile adapter rejects a bare `email` with no argument, which would
#     otherwise break startup on a fresh install that has not set an ACME email;
#   * import the app-generated per-domain site blocks from the shared volume.
#
# No operator-supplied Caddy directives are ever rendered here. Only the fixed
# admin bind, the optional validated email, and the import glob.
# ---------------------------------------------------------------------------
set -eu

EFFECTIVE="/config/effective.Caddyfile"
ADMIN_BIND="${CADDY_ADMIN_BIND:-0.0.0.0:2019}"
IMPORT_GLOB="/caddy-generated/*.caddy"

mkdir -p /config

# Build the global options block. Always declare the admin endpoint. Only add
# the email line when a non-empty ACME_EMAIL is provided.
{
  printf '# Effective Caddyfile rendered by the OS1 proxy entrypoint - DO NOT EDIT BY HAND.\n'
  printf '{\n'
  printf '\tadmin %s\n' "$ADMIN_BIND"
  if [ -n "${ACME_EMAIL:-}" ]; then
    printf '\temail %s\n' "$ACME_EMAIL"
  fi
  printf '}\n\n'
  printf 'import %s\n' "$IMPORT_GLOB"
} > "$EFFECTIVE"

echo "[proxy-entrypoint] Rendered effective Caddyfile (admin=${ADMIN_BIND}, acme_email=$( [ -n "${ACME_EMAIL:-}" ] && echo set || echo unset ))."

exec caddy run --config "$EFFECTIVE" --adapter caddyfile
