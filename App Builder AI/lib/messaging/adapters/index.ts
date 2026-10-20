import type { MessageChannelName } from '../types';
import { emailAdapter } from './email';
import { facebookAdapter, instagramAdapter } from './meta';
import { smsAdapter } from './sms';
import type { ChannelAdapter } from './types';
import { webchatAdapter } from './webchat';
import { whatsappAdapter } from './whatsapp';

const ADAPTERS: Record<MessageChannelName, ChannelAdapter<never>> = {
  WEBCHAT: webchatAdapter as ChannelAdapter<never>,
  EMAIL: emailAdapter as ChannelAdapter<never>,
  WHATSAPP: whatsappAdapter as ChannelAdapter<never>,
  SMS: smsAdapter as ChannelAdapter<never>,
  FACEBOOK: facebookAdapter as ChannelAdapter<never>,
  INSTAGRAM: instagramAdapter as ChannelAdapter<never>,
};

export function getAdapter(channel: MessageChannelName): ChannelAdapter<never> {
  return ADAPTERS[channel];
}

export type { ChannelAdapter, SendInput, SendResult } from './types';
export { ChannelSendError } from './types';
