import { upsertLead } from '@/lib/leads/service';
import { cleanUtm, CONSENT_TEXT, publicLeadSchema } from '@/lib/leads/logic';
import { CORS_HEADERS, findPublicProject, json, limited } from '@/lib/project-reviews/public-api';

type Ctx = { params: Promise<{ projectId: string }> };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Public lead capture. Consent is optional to submit, but without it the lead can never be emailed. */
export async function POST(request: Request, { params }: Ctx) {
  const { projectId } = await params;
  const limit = await limited(request, 'leads-post', projectId, 5, 60 * 60_000);
  if (limit) return limit;

  const project = await findPublicProject(projectId);
  if (!project) return json({ error: 'Project not found.' }, 404);

  const parsed = publicLeadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Please provide your name and a valid email.' }, 400);
  const input = parsed.data;

  // Pretend success to bots so they get no signal.
  if (input.website?.trim()) return json({ success: true });

  try {
    await upsertLead(
      projectId,
      {
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        source: 'widget',
        utm: cleanUtm(input.utm),
        notes: input.message ? `Message: ${input.message}` : '',
        consent: input.consent === true,
      },
      { consentText: CONSENT_TEXT },
    );
  } catch (error) {
    console.error('[leads] public capture failed:', error);
    return json({ error: 'Could not submit right now.' }, 500);
  }
  return json({ success: true });
}
