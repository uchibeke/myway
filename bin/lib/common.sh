#!/usr/bin/env bash
# Shared utilities for Myway CLI

# ─── Colors ─────────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  CYAN='\033[0;36m'
  RESET='\033[0m'
else
  BOLD='' DIM='' GREEN='' YELLOW='' RED='' CYAN='' RESET=''
fi

# ─── Logging ────────────────────────────────────────────────────────────────

log_info()  { echo -e "${GREEN}✓${RESET} $*"; }
log_warn()  { echo -e "${YELLOW}⚠${RESET} $*"; }
log_error() { echo -e "${RED}✗${RESET} $*" >&2; }
log_step()  { echo -e "\n${BOLD}$*${RESET}"; }
log_dim()   { echo -e "${DIM}  $*${RESET}"; }

# ─── Prompting ──────────────────────────────────────────────────────────────

# prompt_value "Label" "default" → writes to REPLY
prompt_value() {
  local label="$1" default="$2"
  if [[ -n "$default" ]]; then
    echo -en "  ${label} ${DIM}[${default}]${RESET}: "
    read -r REPLY
    REPLY="${REPLY:-$default}"
  else
    echo -en "  ${label}: "
    read -r REPLY
  fi
}

# prompt_yn "Question" "y/n default" → 0 for yes, 1 for no
prompt_yn() {
  local question="$1" default="${2:-y}"
  if [[ "$default" == "y" ]]; then
    echo -en "  ${question} ${DIM}[Y/n]${RESET}: "
  else
    echo -en "  ${question} ${DIM}[y/N]${RESET}: "
  fi
  read -r REPLY
  REPLY="${REPLY:-$default}"
  [[ "$REPLY" =~ ^[Yy] ]]
}

# ─── Secret generation ──────────────────────────────────────────────────────

generate_hex() {
  local bytes="${1:-32}"
  if command -v openssl &>/dev/null; then
    openssl rand -hex "$bytes"
  elif [[ -r /dev/urandom ]]; then
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    node -e "console.log(require('crypto').randomBytes(${bytes}).toString('hex'))"
  fi
}

# ─── Require command ────────────────────────────────────────────────────────

require_cmd() {
  local cmd="$1" msg="${2:-$1 is required but not installed.}"
  if ! command -v "$cmd" &>/dev/null; then
    log_error "$msg"
    return 1
  fi
}
