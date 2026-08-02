import { Component, ElementRef, HostListener, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalService } from './modal.service';

/**
 * Renders whatever the ModalService has open. Mounted once in the app shell, so any
 * component can raise a dialog without owning any markup for it.
 */
@Component({
  selector: 'app-modal-host',
  imports: [FormsModule],
  templateUrl: './modal-host.html',
  styleUrl: './modal-host.scss',
})
export class ModalHostComponent {
  protected readonly modal = inject(ModalService);
  protected readonly draft = signal('');

  /** Working values for a multi-field form, keyed by field name. */
  protected readonly fieldValues = signal<Record<string, string>>({});

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    effect(() => {
      const open = this.modal.active();
      if (!open) return;

      this.draft.set(open.value ?? '');
      this.fieldValues.set(
        Object.fromEntries((open.fields ?? []).map((field) => [field.name, field.value ?? ''])),
      );

      // Focus moves into the dialog so the keyboard lands somewhere useful, and so
      // Escape and Enter are handled without the reader hunting for the mouse.
      queueMicrotask(() => {
        const target = this.field()?.nativeElement ?? this.panel()?.nativeElement;
        target?.focus();
        if (target instanceof HTMLInputElement) target.select();
      });
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.modal.active()) this.dismiss();
  }

  protected accept(): void {
    const open = this.modal.active();
    if (!open) return;

    if (open.kind === 'prompt') this.modal.settle(this.draft());
    else if (open.kind === 'form') this.modal.settle(this.fieldValues());
    else if (open.kind === 'confirm') this.modal.settle(true);
    else this.modal.settle(null);
  }

  protected setField(name: string, value: string): void {
    this.fieldValues.update((values) => ({ ...values, [name]: value }));
  }

  protected dismiss(): void {
    const open = this.modal.active();
    if (!open) return;

    this.modal.settle(open.kind === 'confirm' ? false : null);
  }

  /** A click on the backdrop itself — not on the panel above it — dismisses. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.dismiss();
  }
}
