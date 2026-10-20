export type SubtitleScene = { prompt: string; seconds: number };

export type SubtitleResult =
  | { available: true; srt: string; cues: number; note: string }
  | { available: false; reason: string };

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function srtTime(totalSeconds: number) {
  const ms = Math.round(totalSeconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/**
 * SRT built only from the text the owner wrote in the scene prompts, one cue
 * per scene over that scene's duration. Scenes without text produce no cue.
 * Nothing is transcribed or invented: the generated videos carry no speech
 * track this app can read, so these are scene descriptions, not a transcript.
 */
export function buildSrt(scenes: SubtitleScene[], translated?: string[]): SubtitleResult {
  let at = 0;
  const blocks: string[] = [];
  for (const [i, scene] of scenes.entries()) {
    const text = (translated?.[i] ?? scene.prompt).replace(/\s+/g, ' ').trim();
    const start = at;
    at += Math.max(scene.seconds, 0);
    if (!text || !scene.prompt.trim()) continue;
    blocks.push(`${blocks.length + 1}\n${srtTime(start)} --> ${srtTime(at)}\n${text}`);
  }
  if (blocks.length === 0) {
    return { available: false, reason: 'Subtitles are not available: this video has no scene text to build them from.' };
  }
  return {
    available: true,
    srt: `${blocks.join('\n\n')}\n`,
    cues: blocks.length,
    note: 'Built from the scene prompts (visual descriptions), not from speech. Review before use.',
  };
}
