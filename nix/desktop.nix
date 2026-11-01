{
  lib,
  stdenv,
  bun,
  nodejs,
  darwin,
  callPackage,
  makeWrapper,
  writableTmpDirAsHomeHook,
  autoPatchelfHook,
  copyDesktopItems,
  makeDesktopItem,
  olive,
}:
let
  electronPin =
    (lib.pipe ../packages/desktop/package.json [
      builtins.readFile
      builtins.fromJSON
    ]).devDependencies.electron;
  electron = callPackage ./electron.nix { inherit electronPin; };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "olive-desktop";
  inherit (olive)
    version
    src
    node_modules
    patches
    ;

  nativeBuildInputs = [
    bun
    nodejs
    makeWrapper
    writableTmpDirAsHomeHook
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    autoPatchelfHook
    copyDesktopItems
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [
    darwin.cctools
    darwin.sigtool
    # Ad-hoc sign the .app: --config.mac.identity=null below skips signing.
    darwin.autoSignDarwinBinariesHook
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    (lib.getLib stdenv.cc.cc)
  ];

  desktopItems = lib.optional stdenv.hostPlatform.isLinux (makeDesktopItem {
    name = "ai.olive.desktop";
    desktopName = "Olive";
    exec = "olive-desktop %U";
    icon = "ai.olive.desktop";
    # Electron derives X11 WM_CLASS from app.name.
    startupWMClass = "Olive";
    categories = [ "Development" ];
  });

  env = olive.env // {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

  postPatch =
    # NOTE: Relax Bun version check to be a warning instead of an error
    ''
      substituteInPlace packages/script/src/index.ts \
        --replace-fail 'throw new Error(`This script requires bun@''${expectedBunVersionRange}' \
                       'console.warn(`Warning: This script requires bun@''${expectedBunVersionRange}'
    ''
    # https://github.com/electron/electron/issues/31121
    # mac builds use a .app bundle which doesnt have this issue
    + lib.optionalString stdenv.hostPlatform.isLinux ''
      substituteInPlace \
        packages/desktop/src/main/windows/appearance.ts \
        packages/desktop/src/main/service/desktop-cli.ts \
        --replace-fail "process.resourcesPath" "'$out/opt/olive-desktop/resources'"
    '';

  preBuild = ''
    echo "electron ${electron.version} from nixpkgs ${lib.version}, package.json pins ${electronPin}"
    cp -r "${electron.dist}" $HOME/.electron-dist
    chmod -R u+w $HOME/.electron-dist

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules
  '';

  buildPhase = ''
    runHook preBuild

    cd packages/desktop

    export OLIVE_CLI_DIST="$TMPDIR/desktop-cli"
    cli_package=$(bun -e 'import { getCurrentCli } from "./script/utils.ts"; console.log(getCurrentCli().package.replace("@olive/", ""))')
    # copyBuiltCliToResources joins this dist with the npm package name getCurrentCli()
    # reports, not the Nix build's name. It reads only .version from the manifest and
    # writes it as olive-cli.version beside the binary.
    mkdir -p "$OLIVE_CLI_DIST/$cli_package/bin"
    cp ${lib.getExe olive} "$OLIVE_CLI_DIST/$cli_package/bin/olive"
    # OLIVE_VERSION is what the bundled CLI prints for --version, so the manifest
    # and the executable cannot drift.
    bun -e 'await Bun.write(process.argv[1], JSON.stringify({ version: process.env.OLIVE_VERSION }) + "\n")' \
      "$OLIVE_CLI_DIST/$cli_package/package.json"

    bun run build
    npx electron-builder --dir \
      --config electron-builder.config.ts \
      --config.mac.identity=null \
      --config.electronDist="$HOME/.electron-dist"

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
  ''
  + lib.optionalString stdenv.hostPlatform.isDarwin ''
    mkdir -p $out/Applications
    mv dist/mac*/*.app $out/Applications
    makeWrapper "$out/Applications/Olive.app/Contents/MacOS/Olive" $out/bin/olive-desktop
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    mkdir -p $out/opt/olive-desktop
    cp -r dist/linux*-unpacked/{resources,LICENSE*} $out/opt/olive-desktop
    install -Dm644 resources/icons/32x32.png \
      "$out/share/icons/hicolor/32x32/apps/ai.olive.desktop.png"
    install -Dm644 resources/icons/64x64.png \
      "$out/share/icons/hicolor/64x64/apps/ai.olive.desktop.png"
    install -Dm644 resources/icons/128x128.png \
      "$out/share/icons/hicolor/128x128/apps/ai.olive.desktop.png"
    install -Dm644 resources/icons/128x128@2x.png \
      "$out/share/icons/hicolor/256x256/apps/ai.olive.desktop.png"
    install -Dm644 resources/icons/icon.png \
      "$out/share/icons/hicolor/512x512/apps/ai.olive.desktop.png"
    install -Dm644 resources/ai.olive.desktop.metainfo.xml \
      "$out/share/metainfo/ai.olive.desktop.metainfo.xml"
    makeWrapper ${lib.getExe electron} $out/bin/olive-desktop \
     --inherit-argv0 \
     --set ELECTRON_FORCE_IS_PACKAGED 1 \
     --add-flags $out/opt/olive-desktop/resources/app.asar \
     --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}"
  ''
  + ''
    runHook postInstall
  '';

  autoPatchelfIgnoreMissingDeps = [
    "libc.musl-x86_64.so.1"
  ];

  passthru = {
    # electronVersion is what ships; electronPin is what packages/desktop/package.json
    # asks for. They differ whenever nixpkgs carries no release of the pinned minor.
    electronVersion = electron.version;
    inherit electronPin;
  };

  meta = {
    description = "Olive Desktop App";
    mainProgram = "olive-desktop";
    inherit (olive.meta) homepage license platforms;
  };
})
