import { listStudioSavedAudioOutputs } from "@/lib/studio-audio-db"
import type {
  StudioAudioLibraryFile,
  StudioSavedAudioOutput,
} from "@/lib/studio-audio-types"

export function mapSavedAudioOutputToLibraryFile(
  output: StudioSavedAudioOutput
): StudioAudioLibraryFile {
  const contentUrl = `/api/studio/audio-outputs/${output.id}/content`

  return {
    ...output,
    kind: "audio",
    src: contentUrl,
    downloadUrl: `${contentUrl}?download=1`,
    canOpenFolder: Boolean(output.storagePath),
  }
}

export function listStudioSavedAudioLibraryFiles() {
  return listStudioSavedAudioOutputs().map(mapSavedAudioOutputToLibraryFile)
}
