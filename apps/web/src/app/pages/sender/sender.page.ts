import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DOCUMENT, DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MAX_MESSAGE_BYTES, parseSenderLink, receiverLinkPath, senderLinkPath } from '@slm/crypto';
import type { EndReason } from '@slm/protocol';
import { SenderController, type SenderStatus } from '../../live/sender-controller';
import { LIVE_TRANSPORT } from '../../live/transport';
import { SessionApi } from '../../session/session-api';
import { CopyField } from '../../ui/copy-field';

const ENDED_REASON: Record<EndReason, string> = {
  'ended-by-sender': 'You ended this session. The message has been deleted from the server.',
  expired:
    'This session expired after an hour without activity. The message has been deleted from the server.',
};

const STATUS_LABEL: Partial<Record<SenderStatus, string>> = {
  connecting: 'Connecting…',
  ready: 'Live. The receiver sees what you type.',
  sending: 'Sending…',
  offline: 'Offline: changes will be sent on reconnect.',
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
    } @else if (controller.status() === 'ended') {
      @let reason = controller.endedReason();
      <section
        role="alert"
        data-testid="session-ended"
        class="rounded-2xl border border-slate-200 bg-white p-8"
      >
        <h1 class="text-xl font-semibold">Session ended</h1>
        <p class="mt-2 text-slate-600">{{ reason ? endedReason[reason] : '' }}</p>
        <a routerLink="/" class="mt-4 inline-block text-sm font-medium underline"
          >Start a new session</a
        >
      </section>
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
    } @else if (controller.status() === 'role-taken') {
      <section role="alert" class="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 class="text-xl font-semibold">This session is already open in another tab</h1>
        <p class="mt-2 text-slate-600">
          Only one editor can be connected at a time. Close the other tab and reload this page.
        </p>
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
        <div class="flex items-center justify-between">
          <h1 class="text-2xl font-semibold tracking-tight">Your session</h1>
          <span
            data-testid="receiver-presence"
            class="inline-flex items-center gap-2 text-sm"
            [class.text-emerald-700]="controller.receiverConnected()"
            [class.text-slate-500]="!controller.receiverConnected()"
          >
            <span
              aria-hidden="true"
              class="size-2 rounded-full"
              [class.bg-emerald-500]="controller.receiverConnected()"
              [class.bg-slate-300]="!controller.receiverConnected()"
            ></span>
            {{ controller.receiverConnected() ? 'Receiver connected' : 'Waiting for receiver' }}
          </span>
        </div>
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
        <div class="border-t border-slate-200 pt-6">
          @if (confirmingEnd()) {
            <div role="alertdialog" aria-labelledby="end-title" class="space-y-3">
              <p id="end-title" class="text-sm text-slate-700">
                End this session for good? The message is deleted from the server and the receiver
                is told the session has ended. This can't be undone.
              </p>
              <div class="flex gap-3">
                <button
                  type="button"
                  data-testid="confirm-end"
                  class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  [disabled]="controller.ending()"
                  (click)="controller.end()"
                >
                  {{ controller.ending() ? 'Ending…' : 'End session' }}
                </button>
                <button
                  type="button"
                  data-testid="cancel-end"
                  class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                  (click)="confirmingEnd.set(false)"
                >
                  Keep it open
                </button>
              </div>
            </div>
          } @else {
            <button
              type="button"
              data-testid="end-session"
              class="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              (click)="confirmingEnd.set(true)"
            >
              End session
            </button>
          }
          @if (controller.endFailed()) {
            <p role="alert" class="mt-2 text-sm text-red-700">
              Couldn't end the session. Check your connection and try again.
            </p>
          }
        </div>
      </section>
    }
  `,
})
export class SenderPage {
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly endedReason = ENDED_REASON;
  protected readonly confirmingEnd = signal(false);
  protected readonly maxBytes = MAX_MESSAGE_BYTES;
  protected readonly controller: SenderController | null;
  protected readonly links: { receiver: string; sender: string } | null;

  constructor() {
    const origin = inject(DOCUMENT).location.origin;
    const api = inject(SessionApi);
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
        endSession: () => api.endSession(link.sessionId, link.senderToken),
      });

    if (this.controller) {
      const controller = this.controller;
      void controller.start();
      inject(DestroyRef).onDestroy(() => controller.dispose());
    }
  }
}
