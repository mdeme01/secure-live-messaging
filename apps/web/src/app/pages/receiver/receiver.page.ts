import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { parseReceiverLink } from '@slm/crypto';
import type { EndReason } from '@slm/protocol';
import { ReceiverController, type ReceiverStatus } from '../../live/receiver-controller';
import { LIVE_TRANSPORT } from '../../live/transport';

const ENDED_REASON: Record<EndReason, string> = {
  'ended-by-sender': 'The sender ended this session.',
  expired: 'This session expired after an hour without activity.',
};

const STATUS_LABEL: Record<ReceiverStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  ended: 'Session ended',
  'not-found': 'Session ended',
  'role-taken': 'Already has a receiver',
  error: 'Error',
};

@Component({
  selector: 'slm-receiver-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink],
  template: `
    @if (!controller) {
      <section role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-900">
        <h1 class="text-xl font-semibold">This link is invalid or incomplete</h1>
        <p class="mt-2">Ask the sender for a new link. Make sure you copied all of it.</p>
      </section>
    } @else if (controller.status() === 'ended') {
      @let reason = controller.endedReason();
      <section
        role="alert"
        data-testid="session-ended"
        class="rounded-2xl border border-slate-200 bg-white p-8"
      >
        <h1 class="text-xl font-semibold">This session has ended</h1>
        <p class="mt-2 text-slate-600">
          {{ reason ? endedReason[reason] : '' }} No more updates will arrive.
        </p>
        <a routerLink="/" class="mt-4 inline-block text-sm font-medium underline"
          >Start your own session</a
        >
      </section>
    } @else if (controller.status() === 'not-found') {
      <section role="alert" class="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 class="text-xl font-semibold">This session doesn't exist or has ended</h1>
        <p class="mt-2 text-slate-600">No more updates will arrive.</p>
        <a routerLink="/" class="mt-4 inline-block text-sm font-medium underline"
          >Start your own session</a
        >
      </section>
    } @else if (controller.status() === 'role-taken') {
      <section role="alert" class="rounded-2xl border border-slate-200 bg-white p-8">
        <h1 class="text-xl font-semibold">This session already has a receiver</h1>
        <p class="mt-2 text-slate-600">
          Only one person can view a session at a time. If that was you in another tab or browser,
          close it and reload this page.
        </p>
      </section>
    } @else if (controller.status() === 'error') {
      <section role="alert" class="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-900">
        <h1 class="text-xl font-semibold">Couldn't open this session</h1>
        <p class="mt-2">Please reload the page to try again.</p>
      </section>
    } @else {
      <section class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div class="flex items-center justify-between text-sm text-slate-600">
          <span data-testid="receiver-status">{{ statusLabel[controller.status()] }}</span>
          @if (controller.lastUpdatedAt(); as at) {
            <span>Last update received {{ at | date: 'HH:mm:ss' }}</span>
          }
        </div>
        @if (controller.integrityFailure() && controller.message() !== null) {
          <p
            role="alert"
            data-testid="integrity-banner"
            class="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            Latest update failed integrity check — showing last verified message
          </p>
        }
        @switch (controller.message()) {
          @case (null) {
            @if (controller.integrityFailure()) {
              <p role="alert" class="mt-6 rounded-lg bg-red-50 px-3 py-2 text-red-800">
                The message couldn't be verified. The link may be wrong, or the data was altered on
                the way. Nothing unverified is shown.
              </p>
            } @else {
              <p class="mt-6 text-slate-500">Loading the message…</p>
            }
          }
          @case ('') {
            <p data-testid="empty-message" class="mt-6 italic text-slate-500">
              The sender hasn't written anything yet.
            </p>
          }
          @default {
            <div
              data-testid="message"
              role="document"
              aria-readonly="true"
              class="mt-6 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4"
            >
              {{ controller.message() }}
            </div>
          }
        }
      </section>
    }
  `,
})
export class ReceiverPage {
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly endedReason = ENDED_REASON;
  protected readonly controller: ReceiverController | null;

  constructor() {
    const { paramMap, fragment } = inject(ActivatedRoute).snapshot;
    const link = parseReceiverLink(paramMap.get('id'), fragment);
    this.controller = link && new ReceiverController({ link, transport: inject(LIVE_TRANSPORT)() });

    if (this.controller) {
      const controller = this.controller;
      void controller.start();
      inject(DestroyRef).onDestroy(() => controller.dispose());
    }
  }
}
