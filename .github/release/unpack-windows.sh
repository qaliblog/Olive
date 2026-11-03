#!/usr/bin/env bash
# unpack-windows.sh <download dir> <work dir>: lays out what the signing action signs in <work dir>:
# cli/<target>/package from the Windows CLI npm tarballs.
. "$(dirname "$0")/lib.sh"

in=$(posix "$1") work=$(posix "$2")
mkdir -p "$work"
if [ -d "$in/build-npm" ]; then
  for target in windows-arm64 windows-x64 windows-x64-baseline; do
    mkdir -p "$work/cli/$target"
    tar -xzf "$in/build-npm/olive-cli-$target-$OLIVE_VERSION.tgz" -C "$work/cli/$target"
    test -s "$work/cli/$target/package/bin/olive.exe" || die "Missing olive.exe for $target"
  done
fi
