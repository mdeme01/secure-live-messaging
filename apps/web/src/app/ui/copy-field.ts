import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

const COPIED_FEEDBACK_MS = 2000;

/** Read-only value with a Copy button and a short "Copied" confirmation. */
@Component({
  selector: 'slm-copy-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="block">
      <span class="text-sm font-medium text-slate-700">{{ label() }}</span>
      <div class="mt-1 flex gap-2">
        <input
          readonly
          [value]="value()"
          [attr.data-testid]="testId()"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm"
          (focus)="$any($event.target).select()"
        />
        <button
          type="button"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
          (click)="copy()"
        >
          {{ copied() ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </label>
  `,
})
export class CopyField {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly testId = input<string>();

  protected readonly copied = signal(false);
  private resetTimer?: ReturnType<typeof setTimeout>;

  protected async copy(): Promise<void> {
    await navigator.clipboard.writeText(this.value());
    this.copied.set(true);
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.copied.set(false), COPIED_FEEDBACK_MS);
  }
}
