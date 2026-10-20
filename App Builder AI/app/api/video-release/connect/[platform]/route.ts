import { NextResponse } from 'next/server';

import { appBaseUrl } from '@/lib/ads/customer-oauth';
import { getCachedSession } from '@/lib/auth/cached';
import {
  VIDEO_RETURN_PATH,
  createVideoState,
  isVideoConnectConfigured,
  isVideoConnectPlatform,
  videoAuthorizeUrl,
} from '@/lib/video-release/oauth';

/** Starts the owner's YouTube / TikTok OAuth flow for scheduled video releases. */
export async function GET(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const platform = (await params).platform.toUpperCase();
  const userId = (await getCachedSession())?.user?.id;
  if (!userId || !isVideoConnectPlatform(platform) || !isVideoConnectConfigured(platform)) {
    return NextResponse.redirect(`${appBaseUrl()}${VIDEO_RETURN_PATH}?connect=unavailable`);
  }
  return NextResponse.redirect(videoAuthorizeUrl(platform, createVideoState(platform, userId)));
}
