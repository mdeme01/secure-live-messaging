import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { DatePipe, DOCUMENT, DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MAX_MESSAGE_BYTES, parseSenderLink, receiverLinkPath, senderLinkPath } from '@slm/crypto';
import { SenderController, type SenderStatus } from '../../live/sender-controller';
import { LIVE_TRANSPORT } from '../../live/transport';
import { CopyField } from '../../ui/copy-field';

const STATUS_LABEL: Partial<Record<SenderStatus, string>> = {
  connecting: 'Connecting…',
  ready: 'Live. The receiver sees what you type.',
  sending: 'Sending…',
  offline: 'Offline. Your edits will be sent when the connection is back.',
  error: "Couldn't send the last change. Keep typing to retry.",
};

@Component({
  selector: 'slm-sender-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CopyField, DatePipe, DecimalPipe, RouterLink],
  template: `
    @if (!controller || !links) {
      <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-red-800">
        This sender link is invalid or incomplete. Create a new session.
      </p>
    } @else if (controller.status() === 'not-found') {
      <section role="alert" class="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 class="text-xl font-semibold">This session doesn't exist or has ended</h1>
        <a routerLink="/" class="mt-4 inline-block text-sm font-medium underline"
          >Start a new session</a
        >
      </section>
    } @else if (controller.status() === 'unauthorized') {
      <section role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-900">
        <h1 class="text-xl font-semibold">This sender link isn't valid for this session</h1>
        <p class="mt-2">Make sure you copied the whole Sender Link.</p>
      </section>
    } @else if (controller.status() === 'unverifiable') {
      <section role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-900">
        <h1 class="text-xl font-semibold">The current message couldn't be verified</h1>
        <p class="mt-2">
          The link may be wrong, or the stored data was altered. Editing is disabled so the message
          isn't overwritten.
        </p>
      </section>
    } @else {
      <section class="space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 class="text-2xl font-semibold tracking-tight">Your session</h1>
        <div>
          <label for="message" class="mb-1 block text-sm font-medium text-slate-700">Message</label>
          <textarea
            id="message"
            data-testid="editor"
            rows="8"
            class="w-full rounded-lg border border-slate-300 p-3 font-mono text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
            placeholder="Type your message. The receiver sees it as you write."
            [disabled]="!controller.editable()"
            [value]="controller.text()"
            (input)="controller.setText($any($event.target).value)"
          ></textarea>
          <p data-testid="sender-status" aria-live="polite" class="mt-1 text-sm text-slate-600">
            @switch (controller.status()) {
              @case ('sent') {
                Sent at {{ controller.lastSentAt() | date: 'HH:mm:ss' }}
              }
              @case ('too-long') {
                <span class="text-red-700"
                  >Too long to send: the limit is {{ maxBytes | number }} bytes. Shorten the
                  message.</span
                >
              }
              @default {
                {{ statusLabel[controller.status()] }}
              }
            }
          </p>
        </div>
        <div>
          <slm-copy-field label="Receiver Link" [value]="links.receiver" testId="receiver-link" />
          <p class="mt-1 text-sm text-slate-500">
            Share this with the one person who should read your message.
          </p>
        </div>
        <div>
          <slm-copy-field label="Sender Link" [value]="links.sender" testId="sender-link" />
          <p class="mt-1 text-sm text-amber-700">
            Keep this private: anyone with it can edit or end the session.
          </p>
        </div>
      </section>
    }
  `,
})
export class SenderPage {
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly maxBytes = MAX_MESSAGE_BYTES;
  protected readonly controller: SenderController | null;
  protected readonly links: { receiver: string; sender: string } | null;

  constructor() {
    const origin = inject(DOCUMENT).location.origin;
    const { paramMap, fragment } = inject(ActivatedRoute).snapshot;
    const link = parseSenderLink(paramMap.get('id'), fragment);

    this.links = link && {
      receiver: origin + receiverLinkPath(link),
      sender: origin + senderLinkPath(link),
    };
    this.controller =
      link &&
      new SenderController({
        link,
        transport: inject(LIVE_TRANSPORT)({ senderToken: link.senderToken }),
      });

    if (this.controller) {
      const controller = this.controller;
      void controller.start();
      inject(DestroyRef).onDestroy(() => controller.dispose());
    }
  }
}
