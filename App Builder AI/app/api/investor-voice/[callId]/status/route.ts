import { handleStatus, verifyVoiceRequest } from '@/lib/investor-hub/voice';

export const maxDuration = 30;

/** Twilio call-status callback (ringing, answered, completed, no-answer, failed). */
export async function POST(request: Request, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const verified = await verifyVoiceRequest(request);
  if ('error' in verified) return verified.error;
  await handleStatus(callId, verified.params);
  return new Response(null, { status: 204 });
}
