import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';

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
          #field
          readonly
          [value]="value()"
          [attr.data-testid]="testId()"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm"
          (focus)="field.select()"
        />
        <button
          type="button"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
          (click)="copy()"
        >
          {{
            feedback() === 'copied' ? 'Copied' : feedback() === 'failed' ? 'Copy failed' : 'Copy'
          }}
        </button>
      </div>
    </label>
  `,
})
export class CopyField {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly testId = input<string>();

  protected readonly feedback = signal<'idle' | 'copied' | 'failed'>('idle');
  private resetTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.resetTimer));
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.value());
      this.feedback.set('copied');
    } catch {
      // Clipboard denied or unavailable: the field stays selectable for manual copying.
      this.feedback.set('failed');
    }
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.feedback.set('idle'), COPIED_FEEDBACK_MS);
  }
}
