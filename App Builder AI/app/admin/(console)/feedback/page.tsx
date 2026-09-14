import {
  AdminPageHeader,
  KpiCard,
  StatusPill,
  formatDateTime,
} from '@/components/admin/ui/primitives';
import { listFeedbackMessages, listProductReviews } from '@/lib/admin/queries/feedback';
import { requireAdmin } from '@/lib/auth/require-admin';
import { hasPermission } from '@/lib/admin/permissions';
import { Select } from '@/components/ui/select';
import { FeedbackReplyPanel } from '@/components/admin/feedback/feedback-reply-panel';

const STATUS_TONE = {
  NEW: 'warning',
  READ: 'neutral',
  RESOLVED: 'success',
} as const;

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const auth = await requireAdmin('feedback:read');
  if (!auth.ok) return null;

  const params = await searchParams;
  const page = Number(params.page) || 1;
  const canRespond = hasPermission(auth.admin.adminRole, 'feedback:write');

  const [{ messages, total, byStatus }, { reviews, total: reviewTotal, averageRating }] =
    await Promise.all([
      listFeedbackMessages({ status: params.status, page }),
      listProductReviews(),
    ]);

  const countFor = (status: string) =>
    byStatus.find((s) => s.status === status)?._count._all ?? 0;

  return (
    <div>
      <AdminPageHeader
        title="Feedback"
        description={`${total} messages · ${reviewTotal} reviews from users`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="New" value={String(countFor('NEW'))} />
        <KpiCard label="Read" value={String(countFor('READ'))} />
        <KpiCard label="Resolved" value={String(countFor('RESOLVED'))} />
        <KpiCard
          label="Average rating"
          value={averageRating ? averageRating.toFixed(1) : '—'}
        />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-app-text">Messages from users</h2>

        <form className="mb-4 flex flex-wrap gap-2" method="get">
          <Select theme="app" name="status" defaultValue={params.status ?? ''}>
            <option value="">All statuses</option>
            <option value="NEW">New</option>
            <option value="READ">Read</option>
            <option value="RESOLVED">Resolved</option>
          </Select>
          <button
            type="submit"
            className="rounded-full bg-app-surface-active px-4 py-2 text-sm text-app-text hover:bg-app-surface-hover">
            Filter
          </button>
        </form>

        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className="rounded-xl border border-app-border-subtle bg-app-surface p-4">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-app-text">
                    {message.userEmail ?? message.userId ?? 'Unknown user'}
                  </p>
                  <p className="text-xs text-app-text-muted">
                    {formatDateTime(message.createdAt)}
                  </p>
                </div>
                <StatusPill tone={STATUS_TONE[message.status]}>
                  {message.status}
                </StatusPill>
              </div>
              {message.language && message.language.toLowerCase() !== 'english' ? (
                <span className="mb-2 inline-block rounded-full bg-app-surface-active px-2 py-0.5 text-[11px] font-medium text-app-text-muted">
                  🌐 Written in {message.language}
                </span>
              ) : null}
              <p className="mb-1 whitespace-pre-wrap text-sm text-app-text-secondary">
                {message.message}
              </p>
              {message.translatedMessage ? (
                <div className="mb-3 rounded-lg border border-app-border-subtle bg-app-surface-active/30 p-2.5">
                  <p className="mb-1 text-[11px] font-medium text-app-text-muted">
                    English translation
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-app-text-secondary">
                    {message.translatedMessage}
                  </p>
                </div>
              ) : (
                <div className="mb-3" />
              )}

              {message.response ? (
                <div className="rounded-lg border border-app-border-subtle bg-app-surface-active/40 p-3">
                  <p className="text-xs font-medium text-app-text-muted">
                    Response{message.respondedBy ? ` · ${message.respondedBy}` : ''}
                    {message.respondedAt
                      ? ` · ${formatDateTime(message.respondedAt)}`
                      : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-app-text">
                    {message.response}
                  </p>
                  {message.translatedResponse ? (
                    <>
                      <p className="mt-2 text-[11px] font-medium text-app-text-muted">
                        🌐 Auto-translated to {message.language} and sent to the user
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-app-text-secondary">
                        {message.translatedResponse}
                      </p>
                    </>
                  ) : null}
                </div>
              ) : null}

              {canRespond ? (
                <FeedbackReplyPanel
                  id={message.id}
                  existingResponse={message.response}
                  status={message.status}
                />
              ) : null}
            </div>
          ))}
          {messages.length === 0 ? (
            <p className="p-8 text-center text-sm text-app-text-muted">
              No feedback messages match these filters.
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-app-text">Product reviews</h2>
        <div className="overflow-hidden rounded-xl border border-app-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-app-surface text-left text-xs text-app-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Rating</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Comment</th>
                <th className="px-4 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((review) => (
                <tr key={review.id} className="border-t border-app-border-subtle">
                  <td className="px-4 py-2.5 text-app-text">
                    {'★'.repeat(review.rating)}
                    {'☆'.repeat(5 - review.rating)}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {review.userEmail ?? review.userId}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {review.comment ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-app-text-secondary">
                    {formatDateTime(review.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {reviews.length === 0 ? (
            <p className="p-8 text-center text-sm text-app-text-muted">
              No reviews yet.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
