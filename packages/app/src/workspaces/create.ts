import type { LocationGetOutput, OliveClient } from "@olive/client/promise"
import type { Data } from "@olive/client/solid"

export async function createWorktree(input: {
  api: Pick<OliveClient, "location" | "worktree">
  data: Pick<Data, "location">
  directory: string
  project?: LocationGetOutput["project"]
  branch?: string
}) {
  const project = input.project ?? (await input.api.location.get({ location: { directory: input.directory } })).project

  const created = await input.api.worktree.create({
    projectID: project.id,
    from: project.canonical,
    branch: input.branch,
  })

  // Populate the client cache before the destination session mounts.
  await input.data.location.syncInfo({ directory: created.directory })

  return created.directory
}
