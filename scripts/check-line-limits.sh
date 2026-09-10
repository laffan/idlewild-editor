#!/usr/bin/env bash
# No source file may exceed 700 lines. Carried over from phaser-bench and hush;
# it is the rule that keeps this codebase splittable.
set -uo pipefail

LIMIT=700
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

fail=0
while IFS= read -r file; do
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$LIMIT" ]; then
    printf '%s: %s lines (limit %s)\n' "$file" "$lines" "$LIMIT"
    fail=1
  fi
done < <(
  find src src-tauri/src scripts -type f \
    \( -name '*.ts' -o -name '*.js' -o -name '*.rs' -o -name '*.css' -o -name '*.html' \) \
    -not -path '*/node_modules/*' 2>/dev/null
)

if [ "$fail" -ne 0 ]; then
  echo "Split the files above into focused modules."
  exit 1
fi
echo "Line limits OK (<= $LIMIT)."
