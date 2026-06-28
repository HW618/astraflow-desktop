import { connection } from "next/server"

import { FileLibraryPage } from "@/components/file-library-page"
import { listStudioSavedAudioLibraryFiles } from "@/lib/studio-audio-library"
import { listStudioSavedImageOutputs } from "@/lib/studio-db"
import type { StudioLibraryFile } from "@/lib/studio-types"
import { listStudioSavedVideoLibraryFiles } from "@/lib/studio-video-library"

function mapSavedOutputToLibraryFile(
  output: ReturnType<typeof listStudioSavedImageOutputs>[number]
): StudioLibraryFile {
  const contentUrl = `/api/studio/image-outputs/${output.id}/content`

  return {
    ...output,
    kind: "image",
    src: contentUrl,
    downloadUrl: `${contentUrl}?download=1`,
  }
}

export default async function FilesPage() {
  await connection()

  const files = [
    ...listStudioSavedImageOutputs().map(mapSavedOutputToLibraryFile),
    ...listStudioSavedVideoLibraryFiles(),
    ...listStudioSavedAudioLibraryFiles(),
  ].sort(
    (first, second) =>
      new Date(second.savedAt).getTime() - new Date(first.savedAt).getTime()
  )

  return <FileLibraryPage files={files} />
}
