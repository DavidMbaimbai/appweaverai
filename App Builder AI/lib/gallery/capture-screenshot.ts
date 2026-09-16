import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PROJECT_WORKSPACE_ROOT } from "@/lib/project-files";
import { prisma } from "@/lib/prisma";

/** Directory (inside the public workspace root) that holds generated cover
 * thumbnails, kept separate from raw project source files so it's obvious
 * these are derived, publicly-servable marketing assets. */
const PREVIEWS_DIRNAME = ".previews";

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, "") ||
    "https://appweaverai.com"
  );
}

/**
 * Renders an artifact's live preview in a headless browser and stores a
 * JPEG thumbnail on disk, then writes the resulting URL onto
 * `Artifact.previewImageUrl` so it shows up in the Explore gallery
 * (Replit/Lovable-style automatic screenshot capture).
 *
 * Best-effort only: any failure (missing Chromium, slow render, broken
 * preview) is swallowed so a screenshot problem can never break publishing.
 * Callers should invoke this without awaiting it from a request path.
 */
export async function captureArtifactScreenshot(
  projectId: string,
  artifactId: string,
  artifactSlug: string,
): Promise<void> {
  let browser: import("puppeteer").Browser | undefined;

  try {
    const puppeteer = await import("puppeteer");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const previewUrl = `${getAppUrl()}/api/projects/${projectId}/preview/${artifactSlug}`;

    await page.goto(previewUrl, {
      waitUntil: "networkidle2",
      timeout: 20_000,
    });

    // Give client-side rendered apps a brief moment to paint after network
    // idle (fonts, late CSS, small async renders).
    await new Promise((resolve) => setTimeout(resolve, 500));

    const buffer = await page.screenshot({ type: "jpeg", quality: 70 });

    const dir = path.join(PROJECT_WORKSPACE_ROOT, projectId, PREVIEWS_DIRNAME);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${artifactId}.jpg`);
    await writeFile(filePath, buffer);

    const publicUrl = `/project-workspace/${projectId}/${PREVIEWS_DIRNAME}/${artifactId}.jpg?v=${Date.now()}`;

    await prisma.artifact.update({
      where: { id: artifactId },
      data: { previewImageUrl: publicUrl },
    });
  } catch (error) {
    console.error(
      `[capture-screenshot] Failed to capture preview for artifact ${artifactId}:`,
      error,
    );
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * Fires off screenshot capture for every artifact in a project without
 * blocking the caller. Intended to be called (unawaited) right after a
 * publish succeeds.
 */
export function captureProjectScreenshots(
  projectId: string,
  artifacts: Array<{ id: string; slug: string }>,
) {
  for (const artifact of artifacts) {
    void captureArtifactScreenshot(projectId, artifact.id, artifact.slug);
  }
}
