export async function downloadVideoAsDataUrl(url: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch video (${response.status})`)
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ?? "video/mp4"
  const buffer = Buffer.from(await response.arrayBuffer())
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`

  return { dataUrl, mimeType }
}
