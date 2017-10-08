#!/bin/bash

MAKEDIRS=(decode)

cd "$(dirname "$0")/.." || exit 1

for d in "${MAKEDIRS[@]}"; do
    echo "Running make in $d:"
    pushd "$d" > /dev/null || exit 1
    make || exit 1
    popd > /dev/null || exit 1
done

exit 0
