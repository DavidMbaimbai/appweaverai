const NO_REPLY_PATTERN =
  /(^|[^a-z])(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|bounce|notifications?)([^a-z]|@)/i;

export type InboundHeaders = {
  get(name: string): unknown;
};

/**
 * Decides whether an inbound message is safe to auto-reply to. Guards against
 * reply loops (our own address, other auto-responders, bulk/list mail, bounces).
 */
export function shouldAutoReply({
  fromAddress,
  ownAddresses,
  headers,
}: {
  fromAddress: string | undefined;
  ownAddresses: string[];
  headers: InboundHeaders;
}): { reply: boolean; reason?: string } {
  const from = fromAddress?.trim().toLowerCase();
  if (!from || !from.includes('@')) return { reply: false, reason: 'no sender' };

  if (ownAddresses.some((a) => a.trim().toLowerCase() === from)) {
    return { reply: false, reason: 'own address' };
  }

  if (NO_REPLY_PATTERN.test(from)) {
    return { reply: false, reason: 'no-reply sender' };
  }

  const autoSubmitted = String(headers.get('auto-submitted') ?? '')
    .trim()
    .toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') {
    return { reply: false, reason: 'auto-submitted' };
  }

  const precedence = String(headers.get('precedence') ?? '')
    .trim()
    .toLowerCase();
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) {
    return { reply: false, reason: `precedence ${precedence}` };
  }

  if (
    headers.get('list-id') ||
    headers.get('list-unsubscribe') ||
    headers.get('x-auto-response-suppress')
  ) {
    return { reply: false, reason: 'bulk/list mail' };
  }

  return { reply: true };
}
