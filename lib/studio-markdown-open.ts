export const STUDIO_OPEN_MARKDOWN_TARGET_EVENT =
  "astraflow:open-markdown-target"

export type StudioOpenMarkdownTargetDetail = {
  href: string
  source: "image" | "link"
}
