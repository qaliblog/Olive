<p align="center">
  <a href="https://olive.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Olive logo">
    </picture>
  </a>
</p>
<p align="center">오픈 소스 AI 코딩 에이전트.</p>
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

### 설치

```bash
# YOLO
curl -fsSL https://olive.ai/v2/install | bash

# 패키지 매니저
npm i -g @olive/cli@latest      # bun/pnpm/yarn 도 가능
brew install anomalyco/tap/olive-v2 # macOS 및 Linux (권장, 항상 최신)
brew install olive              # macOS 및 Linux (공식 brew formula, 업데이트 빈도 낮음)
sudo pacman -S olive            # Arch Linux (Stable)
paru -S olive-beta              # Arch Linux (Latest from AUR)
mise use -g olive               # 어떤 OS든
nix run github:anomalyco/olive  # Nix
```

> [!TIP]
> 설치 전에 0.1.x 보다 오래된 버전을 제거하세요.

### 데스크톱 앱 (BETA)

Olive 는 데스크톱 앱으로도 제공됩니다. [olive.ai/download](https://olive.ai/download) 에서 다운로드하세요.

| 플랫폼                | 다운로드                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `olive-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `olive-desktop-mac-x64.dmg`     |
| Windows               | `olive-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, 또는 AppImage      |

```bash
# macOS (Homebrew)
brew install --cask olive-desktop
```

#### 설치 디렉터리

설치 스크립트는 Olive를 `$HOME/.olive/bin`에 설치합니다.

### Agents

Olive 에는 내장 에이전트 2개가 있으며 `Tab` 키로 전환할 수 있습니다.

- **build** - 기본값, 개발 작업을 위한 전체 권한 에이전트
- **plan** - 분석 및 코드 탐색을 위한 읽기 전용 에이전트
  - 기본적으로 파일 편집을 거부
  - bash 명령 실행 전에 권한을 요청
  - 낯선 코드베이스를 탐색하거나 변경을 계획할 때 적합

또한 복잡한 검색과 여러 단계 작업을 위한 **general** 서브 에이전트가 포함되어 있습니다.
내부적으로 사용되며, 메시지에서 `@general` 로 호출할 수 있습니다.

[agents](https://olive.ai/v2/docs/agents) 에 대해 더 알아보세요.

### 문서

Olive 설정에 대한 자세한 내용은 [**문서**](https://olive.ai/v2/docs) 를 참고하세요.

### 기여하기

Olive 에 기여하고 싶다면, Pull Request 를 제출하기 전에 [contributing docs](./CONTRIBUTING.md) 를 읽어주세요.

### Olive 기반으로 만들기

Olive 와 관련된 프로젝트를 진행하면서 이름에 "olive"(예: "olive-dashboard" 또는 "olive-mobile") 를 포함한다면, README 에 해당 프로젝트가 Olive 팀이 만든 것이 아니며 어떤 방식으로도 우리와 제휴되어 있지 않다는 점을 명시해 주세요.

---

**커뮤니티에 참여하기** [Discord](https://discord.gg/olive) | [X.com](https://x.com/olive)
