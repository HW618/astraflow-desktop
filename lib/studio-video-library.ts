import { listStudioSavedVideoOutputs } from "@/lib/studio-video-db"
import type {
  StudioSavedVideoOutput,
  StudioVideoLibraryFile,
} from "@/lib/studio-video-types"

export function mapSavedVideoOutputToLibraryFile(
  output: StudioSavedVideoOutput
): StudioVideoLibraryFile {
  const contentUrl = `/api/studio/video-outputs/${output.id}/content`

  return {
    ...output,
    kind: "video",
    src: contentUrl,
    downloadUrl: `${contentUrl}?download=1`,
    canOpenFolder: Boolean(output.storagePath),
  }
}

export function listStudioSavedVideoLibraryFiles() {
  return listStudioSavedVideoOutputs().map(mapSavedVideoOutputToLibraryFile)
}
