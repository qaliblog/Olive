<p align="center">
  <a href="https://olive.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Olive logo">
    </picture>
  </a>
</p>
<p align="center">El agente de programación con IA de código abierto.</p>
<p align="center">
  <a href="https://olive.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@olive/cli"><img alt="npm" src="https://img.shields.io/npm/v/@olive/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/olive/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/olive/release.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Olive Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://olive.ai)

---

### Instalación

```bash
# YOLO
curl -fsSL https://olive.ai/v2/install | bash

# Gestores de paquetes
npm i -g @olive/cli@latest      # o bun/pnpm/yarn
brew install anomalyco/tap/olive-v2 # macOS y Linux (recomendado, siempre al día)
brew install olive              # macOS y Linux (fórmula oficial de brew, se actualiza menos)
sudo pacman -S olive            # Arch Linux (Stable)
paru -S olive-beta              # Arch Linux (Latest from AUR)
mise use -g olive               # cualquier sistema
nix run github:anomalyco/olive  # Nix
```

> [!TIP]
> Elimina versiones anteriores a 0.1.x antes de instalar.

### App de escritorio (BETA)

Olive también está disponible como aplicación de escritorio. Descárgala desde [olive.ai/download](https://olive.ai/download).

| Plataforma            | Descarga                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `olive-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `olive-desktop-mac-x64.dmg`     |
| Windows               | `olive-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, o AppImage         |

```bash
# macOS (Homebrew)
brew install --cask olive-desktop
```

#### Directorio de instalación

El script de instalación instala Olive en `$HOME/.olive/bin`.

### Agentes

Olive incluye dos agentes integrados que puedes alternar con la tecla `Tab`.

- **build** - Por defecto, agente con acceso completo para tareas de desarrollo
- **plan** - Agente de solo lectura para análisis y exploración de código
  - Deniega ediciones de archivos por defecto
  - Pide permiso antes de ejecutar comandos bash
  - Ideal para explorar codebases desconocidas o planificar cambios

Además, incluye un subagente **general** para búsquedas complejas y tareas de varios pasos.
Se usa internamente y se puede invocar con `@general` en los mensajes.

Más información sobre [agentes](https://olive.ai/v2/docs/agents).

### Documentación

Para más información sobre cómo configurar Olive, [**ve a nuestra documentación**](https://olive.ai/v2/docs).

### Contribuir

Si te interesa contribuir a Olive, lee nuestras [docs de contribución](./CONTRIBUTING.md) antes de enviar un pull request.

### Proyectos basados en Olive

Si estás trabajando en un proyecto basado en Olive y usas "olive" como parte del nombre, por ejemplo, "olive-dashboard" u "olive-mobile", agrega una nota en tu README para aclarar que no está hecho por el equipo de Olive y que no está afiliado con nosotros de ninguna manera.

---

**Únete a nuestra comunidad** [Discord](https://discord.gg/olive) | [X.com](https://x.com/olive)
