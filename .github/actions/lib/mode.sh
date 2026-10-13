#!/usr/bin/env bash
check_mode() {
  [[ "$VERIFY_ONLY" == true || "$VERIFY_ONLY" == false ]] || {
    echo '::error::verify-only must be true or false'; exit 1;
  }
  if [[ "$VERIFY_ONLY" == false ]]; then
    if [[ "${GITHUB_EVENT_NAME:-}" != push || "${GITHUB_REF:-}" != refs/heads/renovate/* ]] ||
       ! jq -e '.sender.id == 29139614' "${GITHUB_EVENT_PATH:?}" > /dev/null; then
      echo '::error::Updates require a Mend Renovate push to a renovate/ branch'; exit 1
    fi
  fi
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then check_mode; fi
