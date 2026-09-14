'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { submitSalesInquiryAction } from '@/lib/sales/actions';

export function SalesContactCta({ label = 'Email sales' }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const submit = () => {
    startTransition(async () => {
      const result = await submitSalesInquiryAction({
        name,
        email,
        company,
        teamSize,
        message,
      });
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      setSent(true);
    });
  };

  return (
    <>
      <Button
        type="button"
        className="mt-2 h-[45px] px-6"
        onClick={() => setOpen(true)}>
        {label}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-[24px] bg-white p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            {sent ? (
              <div className="text-center">
                <p className="font-display text-xl text-text-agent-heading">
                  Thanks — we got it!
                </p>
                <p className="mt-2 text-sm text-text-dim">
                  A member of our sales team will follow up within a day.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-6 h-11 w-full"
                  onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between">
                  <p className="font-display text-xl text-text-agent-heading">
                    Talk to sales
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-text-dim hover:text-text-primary"
                    aria-label="Close">
                    ✕
                  </button>
                </div>
                <div className="space-y-3">
                  <Input
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Input
                    type="email"
                    placeholder="Email (work or personal)"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <Input
                    placeholder="Company (optional)"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                  <Input
                    placeholder="Team size (optional)"
                    value={teamSize}
                    onChange={(e) => setTeamSize(e.target.value)}
                  />
                  <textarea
                    className="min-h-24 w-full rounded-xl border border-border-light px-3.5 py-2.5 text-sm text-text-primary transition-[border-color,box-shadow] focus:border-appweaver-orange focus:outline-none focus:ring-2 focus:ring-appweaver-orange/30"
                    placeholder="Tell us about what you're building and your team size"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  className="mt-5 h-11 w-full"
                  disabled={isPending || !name.trim() || !email.trim() || !message.trim()}
                  onClick={submit}>
                  {isPending ? 'Sending…' : 'Send to sales'}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
