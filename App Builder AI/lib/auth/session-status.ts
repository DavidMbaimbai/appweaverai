export type AuthSessionStatus =
  | 'loading'
  | 'authenticated'
  | 'unauthenticated';

export function getAuthSessionStatus({
  isPending,
  hasUser,
}: {
  isPending: boolean;
  hasUser: boolean;
}): AuthSessionStatus {
  if (isPending) return 'loading';
  return hasUser ? 'authenticated' : 'unauthenticated';
}

export function shouldShowAuthModal({
  requestedOpen,
  status,
}: {
  requestedOpen: boolean;
  status: AuthSessionStatus;
}) {
  return status === 'unauthenticated' && requestedOpen;
}
