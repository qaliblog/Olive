#!/usr/bin/env bash
# render-winget.sh <sign-windows dir> <sign-desktop-windows-installer dir> <out dir>: writes the WinGet manifests for
# Anomaly.Olive and Anomaly.Olive.Desktop. Submission to microsoft/winget-pkgs is paused until the packages
# are accepted, so the workflow only uploads them.
. "$(dirname "$0")/lib.sh"

cli=$1 desktop=$2 out=$3
sum() { sha256 "$1" | cut -c1-64 | tr a-f A-F; }
base="https://olive.ai/files/bin/$OLIVE_VERSION"
date=$(date -u +%F)
header() {
  printf '# yaml-language-server: $schema=https://aka.ms/winget-manifest.%s.1.12.0.schema.json\n\nPackageIdentifier: %s\nPackageVersion: %s\n' \
    "$2" "$1" "$OLIVE_VERSION"
}
footer() { printf 'ManifestType: %s\nManifestVersion: 1.12.0\n' "$1"; }
manifests() {
  local id=$1 name=$2 description=$3 moniker=$4
  shift 4
  mkdir -p "$out/$id"
  { header "$id" version; echo "DefaultLocale: en-US"; footer version; } > "$out/$id/$id.yaml"
  { header "$id" installer; printf '%s\n' "$@" "ReleaseDate: $date"; footer installer; } > "$out/$id/$id.installer.yaml"
  {
    header "$id" defaultLocale
    printf '%s\n' "PackageLocale: en-US" "Publisher: Olive" "PublisherUrl: https://anoma.ly/" \
      "PublisherSupportUrl: https://github.com/anomalyco/olive/issues" "PrivacyUrl: https://olive.ai/legal/privacy-policy" \
      "PackageName: $name" "PackageUrl: https://olive.ai/" "License: MIT" "LicenseUrl: https://github.com/anomalyco/olive/blob/HEAD/LICENSE" \
      "ShortDescription: $description" "Moniker: $moniker" "Tags:" "- ai" "- coding-agent" "- developer-tools" \
      "Documentations:" "- DocumentLabel: Docs" "  DocumentUrl: https://olive.ai/v2/docs"
    footer defaultLocale
  } > "$out/$id/$id.locale.en-US.yaml"
}

manifests Anomaly.Olive "Olive CLI" "The open source AI coding agent for the terminal." olive \
  "InstallerType: zip" "NestedInstallerType: portable" "NestedInstallerFiles:" \
  "- RelativeFilePath: olive.exe" "  PortableCommandAlias: olive" "Commands:" "- olive" "Installers:" \
  "- Architecture: x64" "  InstallerUrl: $base/olive-windows-x64-baseline.zip" "  InstallerSha256: $(sum "$cli/olive-windows-x64-baseline.zip")" \
  "- Architecture: arm64" "  InstallerUrl: $base/olive-windows-arm64.zip" "  InstallerSha256: $(sum "$cli/olive-windows-arm64.zip")"

# The display name and uninstall key match what the NSIS installer registers for ai.olive.desktop.
manifests Anomaly.Olive.Desktop "Olive" "The open source AI coding agent as a desktop app." olive-desktop \
  "InstallerType: nullsoft" "Scope: user" "UpgradeBehavior: install" "ProductCode: d074f30d-5f88-5885-b075-be1348cc7676" \
  "Protocols:" "- olive" "Installers:" \
  "- Architecture: x64" "  InstallerUrl: $base/olive-desktop-win-x64.exe" "  InstallerSha256: $(sum "$desktop/olive-desktop-win-x64.exe")" \
  "- Architecture: arm64" "  InstallerUrl: $base/olive-desktop-win-arm64.exe" "  InstallerSha256: $(sum "$desktop/olive-desktop-win-arm64.exe")"
tail -n +1 "$out"/*/*
