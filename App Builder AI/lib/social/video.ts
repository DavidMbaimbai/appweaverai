export const MAX_VIDEO_SECONDS = 180;

/** Reads the duration (seconds) from an MP4/MOV `mvhd` box inside `buf`, if present. */
export function parseMp4Duration(buf: Uint8Array): number | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 4; i + 32 <= buf.length; i++) {
    // 'mvhd'
    if (buf[i] !== 0x6d || buf[i + 1] !== 0x76 || buf[i + 2] !== 0x68 || buf[i + 3] !== 0x64) {
      continue;
    }
    const version = buf[i + 4];
    if (version === 1) {
      if (i + 36 > buf.length) return null;
      const timescale = view.getUint32(i + 24);
      const duration = Number(view.getBigUint64(i + 28));
      return timescale ? duration / timescale : null;
    }
    const timescale = view.getUint32(i + 16);
    const duration = view.getUint32(i + 20);
    return timescale ? duration / timescale : null;
  }
  return null;
}

async function fetchRange(url: string, range: string) {
  const response = await fetch(url, {
    headers: { range },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Video URL returned ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Best-effort duration probe for a public MP4 URL (reads the head, then the
 * tail where `moov` often lives). Returns null when it can't be determined.
 */
export async function probeVideoDuration(url: string): Promise<number | null> {
  try {
    const head = await fetchRange(url, 'bytes=0-262143');
    const fromHead = parseMp4Duration(head);
    if (fromHead !== null) return fromHead;
    const tail = await fetchRange(url, 'bytes=-1048576');
    return parseMp4Duration(tail);
  } catch {
    return null;
  }
}

/** Returns an error message if the video violates the 3-minute rule, else null. */
export async function validateMarketingVideo(
  url: string,
  declaredSeconds?: number,
): Promise<string | null> {
  const seconds = declaredSeconds ?? (await probeVideoDuration(url));
  if (seconds === null) {
    return 'Could not determine the video length. Pass durationSeconds (max 180) or use an MP4 with metadata.';
  }
  if (seconds > MAX_VIDEO_SECONDS) {
    return `Video is ${Math.round(seconds)}s; marketing videos must be at most ${MAX_VIDEO_SECONDS}s (3 minutes).`;
  }
  return null;
}
