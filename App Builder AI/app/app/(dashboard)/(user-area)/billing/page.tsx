import { BillingPage } from '@/components/app/dashbaord/billing-page';

type PageProps = {
  searchParams: Promise<{
    checkout?: string;
    session_id?: string;
    upgraded?: string;
  }>;
};

export default function Page({ searchParams }: PageProps) {
  return <BillingPage searchParams={searchParams} />;
}
