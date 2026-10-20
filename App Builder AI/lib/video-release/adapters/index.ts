import type { ReleasePlatform } from '../capabilities';

import { facebook } from './facebook';
import { instagramReels } from './instagram-reels';
import { linkedin } from './linkedin';
import { tiktok } from './tiktok';
import type { VideoPublisher } from './types';
import { x } from './x';
import { youtube } from './youtube';

export const PUBLISHERS: Record<ReleasePlatform, VideoPublisher> = {
  YOUTUBE: youtube,
  FACEBOOK: facebook,
  INSTAGRAM: instagramReels,
  LINKEDIN: linkedin,
  X: x,
  TIKTOK: tiktok,
};
