import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'slm-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white p-8">
      <h1 class="text-xl font-semibold">Page not found</h1>
      <a routerLink="/" class="mt-4 inline-block text-sm font-medium underline"
        >Go to the start page</a
      >
    </section>
  `,
})
export class NotFoundPage {}
