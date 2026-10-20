import { MeetingRequestForm } from '@/components/meetings/request-form';
import { listMyMeetingsAction } from '@/lib/actions/meetings';
import { formatInZone } from '@/lib/meetings/logic';

export const dynamic = 'force-dynamic';

export default async function MyMeetingsPage() {
  const rows = await listMyMeetingsAction();
  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Meetings</h1>
      <MeetingRequestForm
        meetings={rows.map((m) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          when: m.startsAt ? formatInZone(m.startsAt, m.timeZone) : null,
          link: m.conferenceUrl,
        }))}
      />
    </div>
  );
}
