import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { senderLinkPath } from '@slm/crypto';
import { ErrorCode } from '@slm/protocol';
import { ApiError } from '../../session/session-api';
import { SessionCreator } from '../../session/session-creator';

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK')
      return "Couldn't reach the server. Check your connection and try again.";
    if (error.code === ErrorCode.CapacityReached)
      return 'The server is at capacity. Please try again later.';
  }
  return 'Something went wrong while creating the session. Please try again.';
}

@Component({
  selector: 'slm-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 class="text-2xl font-semibold tracking-tight">Share a live, encrypted message</h1>
      <p class="mt-2 text-slate-600">
        Your text is encrypted in your browser. The server only relays data it cannot read.
      </p>
      <button
        type="button"
        class="mt-6 rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        [disabled]="creating()"
        (click)="create()"
      >
        {{ creating() ? 'Creating…' : 'Create session' }}
      </button>
      @if (error(); as message) {
        <p role="alert" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {{ message }}
        </p>
      }
    </section>
  `,
})
export class LandingPage {
  private readonly creator = inject(SessionCreator);
  private readonly router = inject(Router);

  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async create(): Promise<void> {
    this.creating.set(true);
    this.error.set(null);
    try {
      const link = await this.creator.create();
      await this.router.navigateByUrl(senderLinkPath(link));
    } catch (error) {
      this.error.set(describeError(error));
    } finally {
      this.creating.set(false);
    }
  }
}
