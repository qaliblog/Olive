interface ImportMetaEnv {
  readonly OLIVE_CHANNEL: string
  readonly OLIVE_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
