#!/usr/bin/env bash
# render-aur.sh <build-npm dir> <aur dir>: writes PKGBUILD, .SRCINFO and the olive2 shim for olive-beta.
# The package installs the published npm tarballs, so their hashes come from the build-npm artifact.
# LICENSE comes from the AUR repository itself.
. "$(dirname "$0")/lib.sh"

npm=$1 aur=$2
name=olive-beta
pkgver="${OLIVE_VERSION//-/.}"
if dry_run && [ ! -f "$aur/LICENSE" ]; then printf 'MIT License\n' > "$aur/LICENSE"; fi
test -s "$aur/LICENSE" || die "The AUR repository has no LICENSE"
printf '#!/bin/sh\nexec "$(dirname "$0")/olive" "$@"\n' > "$aur/olive2"
sum() { sha256 "$1" | cut -c1-64; }
x64=$(sum "$npm/olive-cli-linux-x64-baseline-$OLIVE_VERSION.tgz")
arm64=$(sum "$npm/olive-cli-linux-arm64-$OLIVE_VERSION.tgz")
x64_url="https://registry.npmjs.org/@olive/cli-linux-x64-baseline/-/cli-linux-x64-baseline-$OLIVE_VERSION.tgz"
arm64_url="https://registry.npmjs.org/@olive/cli-linux-arm64/-/cli-linux-arm64-$OLIVE_VERSION.tgz"
license=$(sum "$aur/LICENSE")
shim=$(sum "$aur/olive2")

# Stripping a compiled Bun executable can damage its embedded application.
cat > "$aur/PKGBUILD" <<PKGBUILD
# Maintainer: Dax <mail@thdxr.com>
pkgname=$name
pkgver=$pkgver
pkgrel=1
pkgdesc='Olive beta - the AI coding agent for the terminal'
url='https://github.com/anomalyco/olive'
arch=('x86_64' 'aarch64')
license=('MIT')
depends=('glibc' 'gcc-libs' 'ripgrep')
provides=('olive' 'olive2')
conflicts=('olive' 'olive2')
options=('!strip' '!debug')
source=('LICENSE' 'olive2')
sha256sums=('$license' '$shim')
source_x86_64=('$name-$pkgver-x86_64.tgz::$x64_url')
sha256sums_x86_64=('$x64')
source_aarch64=('$name-$pkgver-aarch64.tgz::$arm64_url')
sha256sums_aarch64=('$arm64')

package() {
  install -Dm755 "\$srcdir/package/bin/olive" "\$pkgdir/usr/bin/olive"
  install -Dm755 "\$srcdir/olive2" "\$pkgdir/usr/bin/olive2"
  install -Dm644 "\$srcdir/LICENSE" "\$pkgdir/usr/share/licenses/\$pkgname/LICENSE"
}
PKGBUILD

# What makepkg --printsrcinfo prints for the PKGBUILD above.
t=$'\t'
cat > "$aur/.SRCINFO" <<SRCINFO
pkgbase = $name
${t}pkgdesc = Olive beta - the AI coding agent for the terminal
${t}pkgver = $pkgver
${t}pkgrel = 1
${t}url = https://github.com/anomalyco/olive
${t}arch = x86_64
${t}arch = aarch64
${t}license = MIT
${t}depends = glibc
${t}depends = gcc-libs
${t}depends = ripgrep
${t}provides = olive
${t}provides = olive2
${t}conflicts = olive
${t}conflicts = olive2
${t}options = !strip
${t}options = !debug
${t}source = LICENSE
${t}source = olive2
${t}sha256sums = $license
${t}sha256sums = $shim
${t}source_x86_64 = $name-$pkgver-x86_64.tgz::$x64_url
${t}sha256sums_x86_64 = $x64
${t}source_aarch64 = $name-$pkgver-aarch64.tgz::$arm64_url
${t}sha256sums_aarch64 = $arm64

pkgname = $name
SRCINFO
cat "$aur/PKGBUILD" "$aur/.SRCINFO"
