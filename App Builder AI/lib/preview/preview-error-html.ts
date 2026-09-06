export function buildPreviewErrorHtml(message: string, details?: string) {
  const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeDetails = details
    ? details.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview error</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0a0a0a;
      color: #f5f5f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 24px;
    }
    .panel {
      width: min(640px, 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.03);
      padding: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 18px;
      font-weight: 600;
    }
    p {
      margin: 0 0 16px;
      color: rgba(255, 255, 255, 0.65);
      line-height: 1.5;
      font-size: 14px;
    }
    pre {
      margin: 0;
      padding: 16px;
      overflow: auto;
      border-radius: 12px;
      background: #111;
      color: #ffb199;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="panel">
    <h1>Preview could not be built</h1>
    <p>${safeMessage}</p>
    ${safeDetails ? `<pre>${safeDetails}</pre>` : ''}
  </div>
</body>
</html>`;
}
