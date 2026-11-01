const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://olive.ai" : `https://${stage}.olive.ai`,
  console: stage === "production" ? "https://olive.ai/auth" : `https://${stage}.olive.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/olive",
  discord: "https://olive.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/v2/docs" },
  ],
}
