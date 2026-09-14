#!/usr/bin/env bash
# preflight-build.sh (section 15)
# Validates the toolchain and host resources BEFORE a self-host build so the
# build fails fast with a clear message instead of OOM-ing halfway through.
# Proven path: corepack yarn@4.9.2 --immutable + NODE_OPTIONS heap + next build --webpack.
set -euo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[0;33m'; NC='\033[0m'
fail=0; warn=0
ok()   { echo -e "${GRN}[ OK ]${NC} $1"; }
bad()  { echo -e "${RED}[FAIL]${NC} $1"; fail=$((fail+1)); }
wrn()  { echo -e "${YLW}[WARN]${NC} $1"; warn=$((warn+1)); }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "== Preflight build check @ $ROOT =="

# 1. Package manager pinned to Yarn 4.x
if grep -q '"packageManager"[[:space:]]*:[[:space:]]*"yarn@4' package.json; then
  ok "packageManager pinned to yarn@4.x"
else
  bad "package.json packageManager is not yarn@4.x (self-host requires Yarn 4)"
fi

# 2. Corepack available
if command -v corepack >/dev/null 2>&1; then ok "corepack available"; else bad "corepack not found (needed to activate yarn@4.9.2)"; fi

# 3. Berry lockfile present and immutable-ready
if [ -f yarn.lock ] && grep -q '__metadata' yarn.lock; then
  ok "yarn.lock present (Berry format)"
else
  bad "yarn.lock missing or not Yarn Berry format"
fi

# 4. Node >= 20.9
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -ge 20 ]; then ok "Node $(node -v) (>= 20)"; else bad "Node >= 20 required (found $(node -v 2>/dev/null || echo none))"; fi

# 5. Self-host build script present
if grep -q '"build:selfhost"' package.json; then ok "build:selfhost script present"; else bad "build:selfhost script missing from package.json"; fi

# 6. Prisma client + schema aligned
if [ -f prisma/schema.prisma ]; then ok "prisma schema present"; else bad "prisma/schema.prisma missing"; fi

# 7. Heap headroom (need ~12 GB target; warn under 6 GB free)
if command -v free >/dev/null 2>&1; then
  FREE_MB=$(free -m | awk '/^Mem:/{print $7}')
  if [ "${FREE_MB:-0}" -ge 6000 ]; then ok "available RAM ${FREE_MB} MB"; else wrn "available RAM ${FREE_MB} MB (<6 GB; build may need swap)"; fi
else
  wrn "cannot determine free memory (free not available)"
fi

# 8. Disk headroom (>= 3 GB free)
FREE_KB=$(df -Pk . | awk 'NR==2{print $4}')
if [ "${FREE_KB:-0}" -ge 3145728 ]; then ok "disk free $((FREE_KB/1024)) MB"; else bad "disk free $((FREE_KB/1024)) MB (<3 GB)"; fi

echo "== Preflight complete: ${fail} failure(s), ${warn} warning(s) =="
if [ "$fail" -gt 0 ]; then
  echo -e "${RED}Preflight FAILED. Resolve the failures above before building.${NC}"
  exit 1
fi
echo -e "${GRN}Preflight passed. Recommended build:${NC}"
echo '  corepack enable && corepack prepare yarn@4.9.2 --activate'
echo '  yarn install --immutable'
echo '  NODE_OPTIONS="--max-old-space-size=12288" yarn build:selfhost'
exit 0
