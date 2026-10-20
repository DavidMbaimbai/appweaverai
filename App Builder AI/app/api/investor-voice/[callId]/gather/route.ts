import { handleGather, verifyVoiceRequest, xmlResponse } from '@/lib/investor-hub/voice';

export const maxDuration = 30;

/** One turn of the conversation: Twilio posts the investor's transcribed speech here. */
export async function POST(request: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const verified = await verifyVoiceRequest(request);
  if ('error' in verified) return verified.error;
  const silence = Number(new URL(request.url).searchParams.get('n') ?? 0);
  return xmlResponse(await handleGather(callId, verified.params, Number.isFinite(silence) ? silence : 0));
}
