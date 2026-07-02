export function openOAuthPopupShell() {
  return null
}

export function navigateOAuthPopup(_popup: Window | null, url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
}
