import { connection } from "next/server"

import { FileLibraryPage } from "@/components/file-library-page"
import { listStudioSavedAudioLibraryFiles } from "@/lib/studio-audio-library"
import {
  listStudioSavedGenericFiles,
  listStudioSavedImageOutputs,
} from "@/lib/studio-db"
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

  const imageFiles = listStudioSavedImageOutputs().map(
    mapSavedOutputToLibraryFile
  )
  const videoFiles = listStudioSavedVideoLibraryFiles()
  const audioFiles = listStudioSavedAudioLibraryFiles()
  const genericFiles = listStudioSavedGenericFiles()
  const files = [
    ...imageFiles,
    ...videoFiles,
    ...audioFiles,
    ...genericFiles,
  ].sort(
    (left, right) =>
      new Date(right.savedAt).getTime() - new Date(left.savedAt).getTime()
  )

  return <FileLibraryPage files={files} />
}
