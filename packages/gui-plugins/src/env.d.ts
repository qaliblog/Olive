interface ImportMetaEnv {
  /** The commit a beta desktop build was built from; undefined in every other build. */
  readonly OLIVE_COMMIT?: string
  /** A beta desktop build's commit, recent history and notes as JSON (packages/desktop/script/beta-notes.ts). */
  readonly OLIVE_BETA_NOTES?: string
}
