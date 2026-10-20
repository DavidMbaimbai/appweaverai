import type { Interval } from './logic';

export type CalendarProviderName = 'GOOGLE' | 'MICROSOFT';
export const CALENDAR_PROVIDERS: CalendarProviderName[] = ['GOOGLE', 'MICROSOFT'];
export const isCalendarProvider = (v: unknown): v is CalendarProviderName => v === 'GOOGLE' || v === 'MICROSOFT';

/** Token revoked/expired beyond refresh, or permission removed: the owner must reconnect. */
export class CalendarAuthError extends Error {}
export class CalendarApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string };
export type ConferenceKind = 'GOOGLE_MEET' | 'TEAMS';
export type EventInput = {
  /** Stable idempotency id (see eventIdFor). */
  eventId: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
  conference?: ConferenceKind | null;
  location?: string | null;
  /** Meetings only: provider-sent invitations are used once a time is confirmed. */
  attendees?: string[];
};
export type EventResult = { eventId: string; conferenceUrl: string | null; start: Date; end: Date; cancelled: boolean };

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'];
export const MICROSOFT_SCOPES = ['offline_access', 'Calendars.ReadWrite'];

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';
const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export function calendarCredentials(provider: CalendarProviderName) {
  const id = process.env[provider === 'GOOGLE' ? 'GOOGLE_CALENDAR_CLIENT_ID' : 'MICROSOFT_CALENDAR_CLIENT_ID']?.trim();
  const secret = process.env[provider === 'GOOGLE' ? 'GOOGLE_CALENDAR_CLIENT_SECRET' : 'MICROSOFT_CALENDAR_CLIENT_SECRET']?.trim();
  return id && secret ? { id, secret } : null;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return ((await res.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

async function tokenRequest(provider: CalendarProviderName, params: Record<string, string>, previousRefresh: string | null): Promise<Tokens> {
  const creds = calendarCredentials(provider);
  if (!creds) throw new CalendarApiError('Calendar credentials are not configured.', 503);
  const body = new URLSearchParams({ ...params, client_id: creds.id, client_secret: creds.secret });
  const res = await fetch(provider === 'GOOGLE' ? GOOGLE_TOKEN : MS_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await readJson(res);
  if (!res.ok) {
    const code = String(json.error ?? '');
    if (code === 'invalid_grant' || code === 'invalid_client' || code === 'unauthorized_client' || code === 'interaction_required') {
      throw new CalendarAuthError(`Token rejected (${code}).`);
    }
    throw new CalendarApiError(`Token request failed (${res.status}).`, res.status);
  }
  const access = String(json.access_token ?? '');
  if (!access) throw new CalendarApiError('Token response had no access token.', 502);
  const expiresIn = Number(json.expires_in) || 3600;
  return {
    accessToken: access,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : previousRefresh,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scopes: typeof json.scope === 'string' ? json.scope : '',
  };
}

export function authorizeUrl(provider: CalendarProviderName, args: { state: string; challenge: string; redirectUri: string }) {
  const creds = calendarCredentials(provider);
  if (!creds) throw new CalendarApiError('Calendar credentials are not configured.', 503);
  const url = new URL(provider === 'GOOGLE' ? GOOGLE_AUTH : MS_AUTH);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', creds.id);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', (provider === 'GOOGLE' ? GOOGLE_SCOPES : MICROSOFT_SCOPES).join(' '));
  if (provider === 'GOOGLE') {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'false');
  } else {
    url.searchParams.set('response_mode', 'query');
  }
  return url.toString();
}

export const exchangeCode = (provider: CalendarProviderName, args: { code: string; verifier: string; redirectUri: string }) =>
  tokenRequest(provider, { grant_type: 'authorization_code', code: args.code, code_verifier: args.verifier, redirect_uri: args.redirectUri }, null);

export const refreshAccessToken = (provider: CalendarProviderName, refreshToken: string) =>
  tokenRequest(
    provider,
    { grant_type: 'refresh_token', refresh_token: refreshToken, ...(provider === 'MICROSOFT' ? { scope: MICROSOFT_SCOPES.join(' ') } : {}) },
    refreshToken,
  );

async function api(url: string, token: string, init: RequestInit = {}, okStatuses: number[] = []) {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
  if (res.ok || okStatuses.includes(res.status)) return { res, json: res.status === 204 ? {} : await readJson(res) };
  const json = await readJson(res);
  const message = JSON.stringify(json.error ?? json).slice(0, 300);
  if (res.status === 401 || (res.status === 403 && /insufficient|forbidden|access.?denied|AuthorizationRequest/i.test(message))) {
    throw new CalendarAuthError(`Calendar access denied (${res.status}).`);
  }
  throw new CalendarApiError(`Calendar API error ${res.status}: ${message}`, res.status);
}

const iso = (d: Date) => d.toISOString();
const asDate = (v: unknown) => {
  const s = typeof v === 'string' ? (/(Z|[+-]\d\d:?\d\d)$/.test(v) ? v : `${v}Z`) : '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Live call proving the credentials and token work. Returns a display label for the connected account. */
export async function verifyConnection(provider: CalendarProviderName, token: string): Promise<{ label: string | null }> {
  if (provider === 'GOOGLE') {
    const now = new Date();
    await api(`${GOOGLE_API}/freeBusy`, token, {
      method: 'POST',
      body: JSON.stringify({ timeMin: iso(now), timeMax: iso(new Date(now.getTime() + 3600_000)), items: [{ id: 'primary' }] }),
    });
    return { label: 'Google Calendar (primary)' };
  }
  const { json } = await api(`${GRAPH}/me/calendar?$select=name,owner`, token);
  const owner = json.owner as { address?: string } | undefined;
  return { label: owner?.address ?? (typeof json.name === 'string' ? json.name : 'Outlook calendar') };
}

/** Busy intervals only; event titles and attendees are never requested or returned. */
export async function fetchBusy(provider: CalendarProviderName, token: string, range: Interval, calendarId = 'primary'): Promise<Interval[]> {
  if (provider === 'GOOGLE') {
    const { json } = await api(`${GOOGLE_API}/freeBusy`, token, {
      method: 'POST',
      body: JSON.stringify({ timeMin: iso(range.start), timeMax: iso(range.end), items: [{ id: calendarId }] }),
    });
    const cal = (json.calendars as Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> | undefined)?.[calendarId];
    if (!cal || cal.errors?.length) throw new CalendarApiError('Free/busy lookup failed.', 502);
    return (cal.busy ?? []).flatMap((b) => {
      const start = asDate(b.start);
      const end = asDate(b.end);
      return start && end ? [{ start, end }] : [];
    });
  }
  const out: Interval[] = [];
  let url: string | null =
    `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(iso(range.start))}&endDateTime=${encodeURIComponent(iso(range.end))}&$select=start,end,showAs,isCancelled&$top=100`;
  for (let page = 0; url && page < 5; page++) {
    const { json } = await api(url, token, { headers: { Prefer: 'outlook.timezone="UTC"' } });
    for (const ev of (json.value as { start?: { dateTime?: string }; end?: { dateTime?: string }; showAs?: string; isCancelled?: boolean }[]) ?? []) {
      if (ev.isCancelled || ev.showAs === 'free') continue;
      const start = asDate(ev.start?.dateTime);
      const end = asDate(ev.end?.dateTime);
      if (start && end) out.push({ start, end });
    }
    url = typeof json['@odata.nextLink'] === 'string' ? (json['@odata.nextLink'] as string) : null;
  }
  return out;
}

type GoogleEvent = {
  id?: string;
  status?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[]; createRequest?: { status?: { statusCode?: string } } };
};
type GraphEvent = {
  id?: string;
  isCancelled?: boolean;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  onlineMeeting?: { joinUrl?: string } | null;
};

const googleResult = (e: GoogleEvent, fallback: EventInput | null): EventResult => ({
  eventId: e.id ?? fallback?.eventId ?? '',
  conferenceUrl: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null,
  start: asDate(e.start?.dateTime) ?? fallback?.start ?? new Date(NaN),
  end: asDate(e.end?.dateTime) ?? fallback?.end ?? new Date(NaN),
  cancelled: e.status === 'cancelled',
});
const graphResult = (e: GraphEvent, fallback: EventInput | null): EventResult => ({
  eventId: e.id ?? fallback?.eventId ?? '',
  conferenceUrl: e.onlineMeeting?.joinUrl ?? null,
  start: asDate(e.start?.dateTime) ?? fallback?.start ?? new Date(NaN),
  end: asDate(e.end?.dateTime) ?? fallback?.end ?? new Date(NaN),
  cancelled: Boolean(e.isCancelled),
});

const googleBody = (input: EventInput) => ({
  summary: input.title,
  description: input.description,
  ...(input.location ? { location: input.location } : {}),
  start: { dateTime: iso(input.start), timeZone: 'UTC' },
  end: { dateTime: iso(input.end), timeZone: 'UTC' },
  extendedProperties: { private: { appweaver: input.eventId } },
  ...(input.attendees?.length ? { attendees: input.attendees.map((email) => ({ email })) } : {}),
});
const sendUpdates = (input: EventInput) => (input.attendees?.length ? 'all' : 'none');
const graphBody = (input: EventInput) => ({
  subject: input.title,
  body: { contentType: 'text', content: input.description },
  ...(input.location ? { location: { displayName: input.location } } : {}),
  start: { dateTime: iso(input.start).replace('Z', ''), timeZone: 'UTC' },
  end: { dateTime: iso(input.end).replace('Z', ''), timeZone: 'UTC' },
  ...(input.attendees?.length ? { attendees: input.attendees.map((address) => ({ emailAddress: { address }, type: 'required' })) } : {}),
});

/** Idempotent: a retry with the same eventId returns the existing event instead of creating a duplicate. */
export async function createEvent(provider: CalendarProviderName, token: string, input: EventInput, calendarId = 'primary'): Promise<EventResult> {
  if (provider === 'GOOGLE') {
    const meet = input.conference === 'GOOGLE_MEET';
    const body = {
      ...googleBody(input),
      id: input.eventId,
      ...(meet ? { conferenceData: { createRequest: { requestId: input.eventId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
    };
    const base = `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events`;
    const { res, json } = await api(`${base}?sendUpdates=${sendUpdates(input)}${meet ? '&conferenceDataVersion=1' : ''}`, token, { method: 'POST', body: JSON.stringify(body) }, [409]);
    if (res.status === 409) {
      const existing = await getEvent(provider, token, input.eventId, calendarId);
      if (!existing) throw new CalendarApiError('Event id conflict.', 409);
      // A previously deleted event keeps its id; revive it rather than failing.
      return existing.cancelled ? updateEvent(provider, token, input, calendarId, true) : existing;
    }
    let result = googleResult(json as GoogleEvent, input);
    if (meet && !result.conferenceUrl && (json as GoogleEvent).conferenceData?.createRequest?.status?.statusCode === 'pending') {
      result = (await getEvent(provider, token, input.eventId, calendarId)) ?? result;
    }
    return result;
  }
  const graphBase = calendarId === 'primary' ? `${GRAPH}/me/calendar` : `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}`;
  const { json } = await api(`${graphBase}/events`, token, {
    method: 'POST',
    body: JSON.stringify({
      ...graphBody(input),
      transactionId: input.eventId,
      ...(input.conference === 'TEAMS' ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
    }),
    headers: { Prefer: 'outlook.timezone="UTC"' },
  });
  return graphResult(json as GraphEvent, input);
}

export async function updateEvent(provider: CalendarProviderName, token: string, input: EventInput, calendarId = 'primary', revive = false): Promise<EventResult> {
  if (provider === 'GOOGLE') {
    const { json } = await api(
      `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=${sendUpdates(input)}&conferenceDataVersion=1`,
      token,
      { method: 'PATCH', body: JSON.stringify({ ...googleBody(input), ...(revive ? { status: 'confirmed' } : {}) }) },
    );
    return googleResult(json as GoogleEvent, input);
  }
  const { json } = await api(`${GRAPH}/me/events/${encodeURIComponent(input.eventId)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(graphBody(input)),
    headers: { Prefer: 'outlook.timezone="UTC"' },
  });
  return graphResult(json as GraphEvent, input);
}

/** Missing events (404/410) count as already deleted. */
export async function deleteEvent(provider: CalendarProviderName, token: string, eventId: string, calendarId = 'primary') {
  const url =
    provider === 'GOOGLE'
      ? `${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`
      : `${GRAPH}/me/events/${encodeURIComponent(eventId)}`;
  await api(url, token, { method: 'DELETE' }, [404, 410]);
}

/** Null when the event no longer exists. */
export async function getEvent(provider: CalendarProviderName, token: string, eventId: string, calendarId = 'primary'): Promise<EventResult | null> {
  if (provider === 'GOOGLE') {
    const { res, json } = await api(`${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, token, {}, [404, 410]);
    return res.ok ? googleResult(json as GoogleEvent, null) : null;
  }
  const { res, json } = await api(`${GRAPH}/me/events/${encodeURIComponent(eventId)}?$select=start,end,isCancelled,onlineMeeting`, token, { headers: { Prefer: 'outlook.timezone="UTC"' } }, [404, 410]);
  return res.ok ? graphResult(json as GraphEvent, null) : null;
}
