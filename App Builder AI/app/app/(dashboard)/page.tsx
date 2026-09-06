import { AppHome } from '@/components/app/home/app-home';
import { getCachedSession } from '@/lib/auth/cached';

export default async function AppPage() {
  const session = await getCachedSession();
  return (
    <AppHome
      user={{
        name: session?.user?.name,
        email: session?.user?.email,
        image: session?.user?.image,
      }}
    />
  );
}
