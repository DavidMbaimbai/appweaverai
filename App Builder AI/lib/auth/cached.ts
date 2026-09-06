import { headers } from 'next/headers';
import { cache } from 'react';
import { auth } from '../auth';
import { getUserWorkspaces } from '../queries/projects';
import { getUserSettings } from '../queries/settings';

export const getCachedSession = cache(async () => {
  return auth.api.getSession({
    headers: await headers(),
  });
});

export const getCachedUserWorkspaces = cache(getUserWorkspaces);

export const getCachedUserSettings = cache(getUserSettings);
