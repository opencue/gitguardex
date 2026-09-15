#!/usr/bin/env bash
# guardex-base-branch.sh — shared helper: infer PR base branch from git history
#
# Source this file, then call:
#   guardex_infer_base_branch <repo_root> <source_branch>
#
# Prints the inferred base branch name and exits 0, or exits 1 if none found.
#
# Algorithm:
#   1. Reflog hint: scan <source_branch>'s reflog for the oldest
#      "branch: Created from <name>" entry; if <name> is an existing local
#      branch (not HEAD, not a SHA, not the source itself) → return it.
#   2. Ancestry: build a candidate set (multiagent.baseBranch, protected
#      branches, dev/main/master, all local non-agent branches); for each
#      existing candidate compute git rev-list --count <merge-base>..<source>;
#      the candidate with the smallest count wins.
#   3. Ties: prefer multiagent.baseBranch, then multiagent.protectedBranches
#      order, then lexical; emit a WARNING line on stderr.
#   4. Returns 1 when no candidate has a merge-base with source_branch
#      (e.g. source_branch does not exist or has no shared history).

# Guard against double-sourcing.
[[ -n "${__GUARDEX_BASE_BRANCH_LIB_LOADED:-}" ]] && return 0
readonly __GUARDEX_BASE_BRANCH_LIB_LOADED=1

# _gib_add <candidate>
# Internal helper for guardex_infer_base_branch.
# Accesses _g_repo, _g_seen, _g_cands from the calling frame via bash dynamic
# scoping.  Appends <candidate> to _g_cands when it is unique and exists.
_gib_add() {
  local _c="$1"
  [[ -z "$_c" ]] && return 0
  # Dedup: sentinel-delimited newline check
  case $'\n'"${_g_seen}"$'\n' in *$'\n'"${_c}"$'\n'*) return 0 ;; esac
  _g_seen="${_g_seen}${_g_seen:+$'\n'}${_c}"
  if git -C "$_g_repo" show-ref --verify --quiet "refs/heads/${_c}" 2>/dev/null \
     || git -C "$_g_repo" show-ref --verify --quiet "refs/remotes/origin/${_c}" 2>/dev/null; then
    _g_cands="${_g_cands}${_g_cands:+$'\n'}${_c}"
  fi
}

guardex_infer_base_branch() {
  local _g_repo="$1"
  local _g_src="$2"

  # 1. Reflog hint: find the OLDEST "branch: Created from <name>" line.
  #    (reflog is newest-first, so the last match is the oldest entry.)
  local _g_rb="" _g_line
  while IFS= read -r _g_line; do
    case "$_g_line" in
      *': branch: Created from '*)
        _g_rb="${_g_line##*: branch: Created from }"
        ;;
    esac
  done < <(git -C "$_g_repo" reflog show --no-abbrev "$_g_src" 2>/dev/null || true)

  if [[ -n "$_g_rb" && "$_g_rb" != "HEAD" && "$_g_rb" != "$_g_src" ]]; then
    # Reject full SHAs (40 lowercase hex chars)
    if [[ ! "$_g_rb" =~ ^[0-9a-f]{40}$ ]]; then
      if git -C "$_g_repo" show-ref --verify --quiet "refs/heads/${_g_rb}" 2>/dev/null; then
        printf '%s' "$_g_rb"
        return 0
      fi
    fi
  fi

  # 2. Ancestry search.
  local _g_conf="" _g_prot=""
  _g_conf="$(git -C "$_g_repo" config --get multiagent.baseBranch 2>/dev/null || true)"
  _g_prot="$(git -C "$_g_repo" config --get multiagent.protectedBranches 2>/dev/null || true)"

  local _g_seen="" _g_cands="" _g_c

  [[ -n "$_g_conf" ]] && _gib_add "$_g_conf"
  if [[ -n "$_g_prot" ]]; then
    for _g_c in $_g_prot; do _gib_add "$_g_c"; done
  fi
  for _g_c in dev main master; do _gib_add "$_g_c"; done
  while IFS= read -r _g_c; do
    [[ -z "$_g_c" || "$_g_c" == "$_g_src" ]] && continue
    case "$_g_c" in agent/*) continue ;; esac
    _gib_add "$_g_c"
  done < <(git -C "$_g_repo" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null || true)

  [[ -z "$_g_cands" ]] && return 1

  # 3. Compute rev-list distance from merge-base.
  local _g_best=2147483647 _g_winners="" _g_n _g_mb _g_ref
  while IFS= read -r _g_c; do
    if git -C "$_g_repo" show-ref --verify --quiet "refs/remotes/origin/${_g_c}" 2>/dev/null; then
      _g_ref="origin/${_g_c}"
    else
      _g_ref="$_g_c"
    fi
    _g_mb="$(git -C "$_g_repo" merge-base "$_g_src" "$_g_ref" 2>/dev/null || true)"
    [[ -z "$_g_mb" ]] && continue
    _g_n="$(git -C "$_g_repo" rev-list --count "${_g_mb}..${_g_src}" 2>/dev/null || true)"
    [[ -z "$_g_n" || ! "$_g_n" =~ ^[0-9]+$ ]] && continue
    if (( _g_n < _g_best )); then
      _g_best=$_g_n
      _g_winners="$_g_c"
    elif (( _g_n == _g_best )); then
      _g_winners="${_g_winners}"$'\n'"${_g_c}"
    fi
  done <<< "$_g_cands"

  [[ -z "$_g_winners" ]] && return 1

  # 4. Tie-break.
  local _g_winner="" _g_wcount
  _g_wcount="$(printf '%s\n' "$_g_winners" | grep -c . || true)"
  _g_wcount="${_g_wcount// /}"

  if [[ "$_g_wcount" -gt 1 ]]; then
    # Priority: multiagent.baseBranch > protectedBranches order > lexical
    if [[ -n "$_g_conf" ]]; then
      case $'\n'"${_g_winners}"$'\n' in
        *$'\n'"${_g_conf}"$'\n'*) _g_winner="$_g_conf" ;;
      esac
    fi
    if [[ -z "$_g_winner" && -n "$_g_prot" ]]; then
      for _g_c in $_g_prot; do
        case $'\n'"${_g_winners}"$'\n' in
          *$'\n'"${_g_c}"$'\n'*)
            _g_winner="$_g_c"
            break
            ;;
        esac
      done
    fi
    if [[ -z "$_g_winner" ]]; then
      _g_winner="$(printf '%s\n' "$_g_winners" | LC_ALL=C sort | head -1)"
    fi
    local _g_tlist
    _g_tlist="$(printf '%s\n' "$_g_winners" | tr '\n' ',' | sed 's/,$//')"
    printf '[gx] WARNING: tie between base candidates [%s]; picked '"'"'%s'"'"'\n' \
      "$_g_tlist" "$_g_winner" >&2
  else
    _g_winner="$_g_winners"
  fi

  [[ -n "$_g_winner" ]] || return 1
  printf '%s' "$_g_winner"
}
