import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'slm-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 class="text-2xl font-semibold tracking-tight">Share a live, encrypted message</h1>
      <p class="mt-2 text-slate-600">
        Your text is encrypted in your browser. The server only relays data it cannot read.
      </p>
    </section>
  `,
})
export class LandingPage {}
