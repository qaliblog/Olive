#!/usr/bin/env bash
# render-homebrew.sh <sign-macos dir> <build-archives dir> <tap dir>: writes Formula olive-v2.rb with the
# hashes of the signed macOS and the Linux archives.
. "$(dirname "$0")/lib.sh"

macos=$1 archives=$2 tap=$3
sum() { sha256 "$1" | cut -c1-64; }
base="https://olive.ai/files/bin/$OLIVE_VERSION"
cat > "$tap/olive-v2.rb" <<FORMULA
# typed: false
# frozen_string_literal: true

class OliveV2 < Formula
  desc "Olive V2 - the AI coding agent for the terminal"
  homepage "https://github.com/anomalyco/olive"
  version "$OLIVE_VERSION"
  license "MIT"

  depends_on "ripgrep"
  conflicts_with "olive", because: "both install an olive binary"

  on_macos do
    if Hardware::CPU.arm?
      url "$base/olive-darwin-arm64.zip"
      sha256 "$(sum "$macos/olive-darwin-arm64.zip")"
    else
      url "$base/olive-darwin-x64-baseline.zip"
      sha256 "$(sum "$macos/olive-darwin-x64-baseline.zip")"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "$base/olive-linux-arm64.tar.gz"
      sha256 "$(sum "$archives/olive-linux-arm64.tar.gz")"
    else
      url "$base/olive-linux-x64-baseline.tar.gz"
      sha256 "$(sum "$archives/olive-linux-x64-baseline.tar.gz")"
    end
  end

  def install
    bin.install "olive"
  end
end
FORMULA
cat "$tap/olive-v2.rb"
