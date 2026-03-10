#!/bin/bash
# test-send-email.sh — Determinism tests for send-email.mjs
# Run: bash scripts/test-send-email.sh
# All tests must pass before any heartbeat/cron uses the script.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="node $SCRIPT_DIR/send-email.mjs"
PASS=0
FAIL=0

assert_exit() {
  local desc="$1" expected="$2"
  shift 2
  "$@" > /dev/null 2>&1
  local actual=$?
  if [ "$actual" = "$expected" ]; then
    echo "✅ $desc"
    ((PASS++))
  else
    echo "❌ $desc (expected exit $expected, got $actual)"
    ((FAIL++))
  fi
}

assert_output_contains() {
  local desc="$1" pattern="$2"
  shift 2
  local out
  out=$("$@" 2>&1)
  if echo "$out" | grep -q "$pattern"; then
    echo "✅ $desc"
    ((PASS++))
  else
    echo "❌ $desc (expected output to contain: $pattern)"
    echo "   got: $out"
    ((FAIL++))
  fi
}

echo "=== send-email.mjs Test Suite ==="
echo ""

# ── Schema rejection tests ─────────────────────────────────────────────────────

assert_exit \
  "Reject: missing --subject" 1 \
  $SCRIPT --to x@x.com --greeting "Hi" --sections '[{"title":"T","items":["x"]}]'

assert_exit \
  "Reject: missing --greeting" 1 \
  $SCRIPT --to x@x.com --subject "S" --sections '[{"title":"T","items":["x"]}]'

assert_exit \
  "Reject: empty sections array" 1 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" --sections '[]'

assert_exit \
  "Reject: wrong format {type,content}" 1 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"type":"text","content":"bad format"}]' --dry-run

assert_output_contains \
  "Wrong format shows helpful error" '"title"' \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"type":"text","content":"bad"}]' --dry-run

assert_exit \
  "Reject: section with no items" 1 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"T"}]' --dry-run

assert_exit \
  "Reject: section with empty items array" 1 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"T","items":[]}]' --dry-run

assert_exit \
  "Reject: section items not strings" 1 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"T","items":[42]}]' --dry-run

assert_exit \
  "Reject: callout with bad style" 1 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"T","items":["x"],"callout":{"text":"note","style":"bad"}}]' --dry-run

# ── Schema acceptance tests ────────────────────────────────────────────────────

assert_exit \
  "Accept: minimal valid section" 0 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"MIT","items":["Do the thing"]}]' --dry-run

assert_exit \
  "Accept: multiple sections" 0 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"MIT","items":["Task 1"]},{"title":"Calendar","items":["9am standup","5:30pm HIIT"]}]' --dry-run

assert_exit \
  "Accept: section with warm callout" 0 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"MIT","items":["Do the thing"],"callout":{"text":"This matters","style":"warm"}}]' --dry-run

assert_exit \
  "Accept: section with neutral callout" 0 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"MIT","items":["Do the thing"],"callout":{"text":"FYI","style":"neutral"}}]' --dry-run

assert_exit \
  "Accept: markdown in items (bold + link)" 0 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"MIT","items":["**Bold item** with [link](https://example.com)"]}]' --dry-run

assert_exit \
  "Accept: markdown in items (inline code via unicode)" 0 \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"MIT","items":["Use \u0060npm install\u0060 to get started"]}]' --dry-run

assert_output_contains \
  "Dry run shows section titles" "MIT" \
  $SCRIPT --to x@x.com --subject "S" --greeting "Hi" \
  --sections '[{"title":"MIT","items":["Do the thing"]}]' --dry-run

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  echo "❌ Test suite FAILED — do not use send-email.mjs in cron/heartbeat until fixed"
  exit 1
else
  echo "✅ All tests passed — send-email.mjs is deterministic"
  exit 0
fi
