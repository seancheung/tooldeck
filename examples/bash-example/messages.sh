# Shared by both Bash actions. The catalog is data, never sourced as code.
text() {
  local english=$1 key translation
  if [[ ${TOOLDECK_LOCALE:-en} == zh-CN ]]; then
    while IFS=$'\t' read -r key translation; do
      if [[ $key == "$english" ]]; then
        printf '%s' "$translation"
        return
      fi
    done < "$(dirname -- "${BASH_SOURCE[0]}")/zh-CN.tsv"
  fi
  printf '%s' "$english"
}

fail() { text "$1" >&2; printf '\n' >&2; exit 1; }

greeting() {
  [[ -n ${TOOLDECK_PARAM_NAME:-} ]] || fail "Missing name"
  local prefix=${TOOLDECK_SETTING_PREFIX:-}
  if [[ -z $prefix ]]; then prefix=$(text Hello); fi
  local message="$prefix, $TOOLDECK_PARAM_NAME!"
  case ${TOOLDECK_SETTING_UPPERCASE:-} in
    true) printf '%s\n' "${message^^}" ;;
    false) printf '%s\n' "$message" ;;
    *) fail "Invalid uppercase setting" ;;
  esac
}
