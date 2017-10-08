#!/bin/bash

NODE_PKG_DIRS=(server)
MIN_NPM_VERSION=5.3.0

cd "$(dirname "$0")/.." || exit 1

NPM_VERSION=$(npm --version) || exit 1

if ! sort -CV < <(printf '%s\n%s\n' "$MIN_NPM_VERSION" "$NPM_VERSION"); then
    echo "npm version too old (have $NPM_VERSION, requires $MIN_NPM_VERSION" >&2
    exit 1
fi

for d in "${NODE_PKG_DIRS[@]}"; do
    echo "Running npm install in $d:"
    pushd "$d" > /dev/null || exit 1
    npm install || exit 1
    popd > /dev/null || exit 1
done

exit 0
