/**
 * Application-wide constants and configuration
 */
export const config = {
  consoleMarketingEnabled: import.meta.env.VITE_CONSOLE_MARKETING_ENABLED === "true",

  // Base URL
  baseUrl: "https://olive.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/olive",
    starsFormatted: {
      compact: "220K",
      full: "220,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/olive",
    discord: "https://discord.gg/olive",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "950",
    commits: "20,000",
    monthlyUsers: "16M",
  },
} as const
