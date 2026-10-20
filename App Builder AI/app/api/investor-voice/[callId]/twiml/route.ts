import { handleTwiml, verifyVoiceRequest, xmlResponse } from '@/lib/investor-hub/voice';

export const maxDuration = 30;

/** Twilio fetches this when the investor answers; the AI disclosure is the first thing spoken. */
export async function POST(request: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const verified = await verifyVoiceRequest(request);
  if ('error' in verified) return verified.error;
  return xmlResponse(await handleTwiml(callId, verified.params));
}
