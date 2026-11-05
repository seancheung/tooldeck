#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/messages.sh"
message=$(greeting)
destination=${TOOLDECK_PARAM_DESTINATION:-}
[[ -n $destination ]] || fail "Missing destination"
[[ $destination == /* ]] || fail "Choose an absolute destination path."
if ! (set -o noclobber; printf '%s\n' "$message" > "$destination"); then
  fail "Could not create the file. Choose a new path in an existing directory."
fi
printf '%s: %s\n' "$(text Saved)" "$destination"
