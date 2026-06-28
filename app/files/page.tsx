import { connection } from "next/server"

import { FileLibraryPage } from "@/components/file-library-page"
import { listStudioSavedImageOutputs } from "@/lib/studio-db"
import type { StudioLibraryFile } from "@/lib/studio-types"

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

  const files = listStudioSavedImageOutputs().map(mapSavedOutputToLibraryFile)

  return <FileLibraryPage files={files} />
}
