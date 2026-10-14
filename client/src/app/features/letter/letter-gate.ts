import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LetterService, LetterStatus, minutesUntil } from '../../core/letter.service';
import { ModalService } from '../../shared/modal/modal.service';

type View = 'form' | 'email' | 'otp' | 'wait' | 'blocked';

/**
 * The modal over the Blogs page: four answers, and what happens when they are wrong.
 *
 * Anyone can close it — once, or for good. It is a letter left on a table, not a
 * door: every other reader is here for the Blogs underneath.
 */
@Component({
  selector: 'app-letter-gate',
  imports: [FormsModule],
  templateUrl: './letter-gate.html',
  styleUrl: './letter-gate.scss',
})
export class LetterGateComponent {
  private readonly letter = inject(LetterService);
  private readonly modal = inject(ModalService);
  private readonly document = inject(DOCUMENT);

  /** Where the server says this address stands as the modal opens. */
  readonly initial = input.required<LetterStatus>();
  readonly closed = output<void>();
  readonly unlocked = output<void>();

  protected readonly status = linkedSignal<LetterStatus>(() => this.initial());
  protected readonly view = computed<View>(() => viewFor(this.status()));

  protected readonly name = signal('');
  protected readonly privateHandle = signal('');
  protected readonly publicHandle = signal('');
  protected readonly dob = signal('');
  protected readonly email = signal('');
  protected readonly code = signal('');

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Ticks so the "X minutes" copy counts down while the modal sits open. */
  private readonly now = signal(Date.now());
  protected readonly waitFor = computed(() => minutesUntil(this.status().retryAt, this.now()));

  protected readonly complete = computed(
    () => !!(this.name().trim() && this.privateHandle().trim() && this.publicHandle().trim() && this.dob()),
  );

  /** "2 more un-successful tries" after the first miss, "1 more … try" after the second. */
  protected readonly blockWarning = computed(() => {
    const left = this.status().triesLeft ?? 0;
    return `${left} more un-successful ${left === 1 ? 'try' : 'tries'}`;
  });

  /** Nobody is born tomorrow. */
  protected readonly today = new Date().toISOString().slice(0, 10);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    const body = this.document.body;
    const overflow = body.style.overflow;
    body.style.overflow = 'hidden';

    const tick = setInterval(() => this.now.set(Date.now()), 15_000);

    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      body.style.overflow = overflow;
    });

    queueMicrotask(() => this.panel()?.nativeElement.focus());
  }

  protected submit(): void {
    if (!this.complete() || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);

    this.letter
      .unlock({
        name: this.name(),
        privateHandle: this.privateHandle(),
        publicHandle: this.publicHandle(),
        dob: this.dob(),
      })
      .subscribe({
        next: (status) => {
          this.busy.set(false);
          if (status.state === 'unlocked' && status.token) {
            this.letter.token.set(status.token);
            this.unlocked.emit();
            return;
          }
          if (status.state === 'off') return this.closed.emit();
          this.status.set(status);
        },
        error: () => {
          this.busy.set(false);
          this.error.set('Something went wrong on the way. Try again in a moment.');
        },
      });
  }

  protected askForCode(): void {
    const email = this.email().trim();
    if (!email || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);

    this.letter.requestOtp(email).subscribe({
      next: (status) => {
        this.busy.set(false);
        if (status.error === 'email') {
          this.error.set('That does not look like an email address.');
        }
        this.status.set(status);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Something went wrong on the way. Try again in a moment.');
      },
    });
  }

  protected redeem(): void {
    const code = this.code().replace(/\D/g, '');
    if (code.length !== 6 || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);

    this.letter.redeem(code).subscribe({
      next: (status) => {
        this.busy.set(false);
        this.code.set('');

        if (status.state === 'otp') {
          const left = status.otpTriesLeft ?? 0;
          this.error.set(`That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
        }
        this.status.set(status);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Something went wrong on the way. Try again in a moment.');
      },
    });
  }

  protected close(): void {
    this.letter.dismissed.set(true);
    this.closed.emit();
  }

  protected async neverAgain(): Promise<void> {
    const sure = await this.modal.confirm({
      title: 'Never show this again?',
      message:
        'This message will not appear on this browser again — not after a reload, not ever. ' +
        'There is no way to bring it back.',
      confirmLabel: 'Never show again',
      cancelLabel: 'Keep it',
    });
    if (!sure) return;

    this.letter.setNeverShow();
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    // The confirm above this handles its own Escape.
    if (!this.modal.active()) this.close();
  }

  protected setCode(value: string): void {
    this.code.set(value.replace(/\D/g, '').slice(0, 6));
  }
}

function viewFor(status: LetterStatus): View {
  switch (status.state) {
    case 'email':
      return 'email';
    case 'otp':
      return 'otp';
    case 'cooldown':
      return 'wait';
    case 'blocked':
      return 'blocked';
    default:
      return 'form';
  }
}
