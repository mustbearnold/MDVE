#!/usr/bin/env bash

set -euo pipefail

: "${NPM_VERSION:?NPM_VERSION must be set}"

npm install --global "npm@${NPM_VERSION}"
test "$(npm --version)" = "${NPM_VERSION}"
