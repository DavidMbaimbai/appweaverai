const STYLE_ID = 'replit-clone-device-preview-scrollbar-hide';

const HIDE_SCROLLBAR_CSS = `
  html,
  body {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
  }

  html::-webkit-scrollbar,
  body::-webkit-scrollbar,
  *::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
    background: transparent !important;
  }
`;

export function hideDevicePreviewScrollbars(iframe: HTMLIFrameElement | null) {
  if (!iframe) return;

  try {
    const doc = iframe.contentDocument;
    if (!doc?.head) return;

    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      doc.head.appendChild(style);
    }

    style.textContent = HIDE_SCROLLBAR_CSS;
  } catch {
    // Sandboxed or cross-origin iframe — ignore.
  }
}
