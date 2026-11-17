import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { parseSenderLink, receiverLinkPath, senderLinkPath } from '@slm/crypto';
import { CopyField } from '../../ui/copy-field';

@Component({
  selector: 'slm-sender-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CopyField],
  template: `
    @if (links; as l) {
      <section class="space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 class="text-2xl font-semibold tracking-tight">Your session</h1>
        <div>
          <slm-copy-field label="Receiver Link" [value]="l.receiver" testId="receiver-link" />
          <p class="mt-1 text-sm text-slate-500">
            Share this with the one person who should read your message.
          </p>
        </div>
        <div>
          <slm-copy-field label="Sender Link" [value]="l.sender" testId="sender-link" />
          <p class="mt-1 text-sm text-amber-700">
            Keep this private: anyone with it can edit or end the session.
          </p>
        </div>
      </section>
    } @else {
      <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-red-800">
        This sender link is invalid or incomplete. Create a new session.
      </p>
    }
  `,
})
export class SenderPage {
  private readonly origin = inject(DOCUMENT).location.origin;
  private readonly snapshot = inject(ActivatedRoute).snapshot;
  private readonly link = parseSenderLink(this.snapshot.paramMap.get('id'), this.snapshot.fragment);

  protected readonly links = this.link && {
    receiver: this.origin + receiverLinkPath(this.link),
    sender: this.origin + senderLinkPath(this.link),
  };
}
