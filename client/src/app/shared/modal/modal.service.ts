import { Injectable, signal } from '@angular/core';

export type ModalKind = 'confirm' | 'prompt' | 'alert' | 'form';

export interface ModalField {
  name: string;
  label: string;
  type?: 'text' | 'number';
  value?: string;
  min?: number;
  max?: number;
}

export type ModalResult = boolean | string | Record<string, string> | null;

export interface ModalRequest {
  kind: ModalKind;
  title: string;
  message?: string;
  /** Prompt only. */
  value?: string;
  placeholder?: string;
  /** Form only — one input per entry, resolved as a name/value map. */
  fields?: ModalField[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm action as destructive. */
  danger?: boolean;
}

interface OpenModal extends ModalRequest {
  resolve: (result: ModalResult) => void;
}

/**
 * Replaces `window.confirm` / `window.prompt` / `window.alert`, which cannot be
 * styled, block the whole tab, and look nothing like the rest of the site.
 *
 * Each method returns a promise that settles when the reader answers, so calling
 * code reads the same as the native call it replaces.
 */
@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly current = signal<OpenModal | null>(null);

  /** The modal host renders whatever this holds; null means nothing is open. */
  readonly active = this.current.asReadonly();

  confirm(request: Omit<ModalRequest, 'kind'>): Promise<boolean> {
    return this.open({ ...request, kind: 'confirm' }) as Promise<boolean>;
  }

  /** Resolves to the entered string, or null if dismissed. */
  prompt(request: Omit<ModalRequest, 'kind'>): Promise<string | null> {
    return this.open({ ...request, kind: 'prompt' }) as Promise<string | null>;
  }

  alert(request: Omit<ModalRequest, 'kind'>): Promise<void> {
    return this.open({ ...request, kind: 'alert' }) as Promise<void>;
  }

  /** Several inputs at once. Resolves to a name/value map, or null if dismissed. */
  form(request: Omit<ModalRequest, 'kind'>): Promise<Record<string, string> | null> {
    return this.open({ ...request, kind: 'form' }) as Promise<Record<string, string> | null>;
  }

  /** Called by the host component when the reader answers. */
  settle(result: ModalResult): void {
    const open = this.current();
    if (!open) return;

    // Cleared before resolving so a handler that opens another modal is not
    // immediately overwritten by this one's teardown.
    this.current.set(null);
    open.resolve(result);
  }

  private open(request: ModalRequest): Promise<unknown> {
    // Only one modal at a time; anything already open is dismissed as cancelled.
    this.settle(request.kind === 'confirm' ? false : null);

    return new Promise((resolve) => {
      this.current.set({ ...request, resolve });
    });
  }
}
