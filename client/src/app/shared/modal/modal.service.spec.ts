import { TestBed } from '@angular/core/testing';
import { ModalService } from './modal.service';

describe('ModalService', () => {
  let modal: ModalService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    modal = TestBed.inject(ModalService);
  });

  it('has nothing open to begin with', () => {
    expect(modal.active()).toBeNull();
  });

  it('opens a confirm and resolves with the answer', async () => {
    const answer = modal.confirm({ title: 'Remove "Rains of Love"?' });

    expect(modal.active()?.kind).toBe('confirm');
    expect(modal.active()?.title).toBe('Remove "Rains of Love"?');

    modal.settle(true);
    await expect(answer).resolves.toBe(true);
    expect(modal.active()).toBeNull();
  });

  it('resolves a dismissed confirm as false', async () => {
    const answer = modal.confirm({ title: 'Delete this?' });
    modal.settle(false);
    await expect(answer).resolves.toBe(false);
  });

  it('resolves a prompt with the entered text', async () => {
    const answer = modal.prompt({ title: 'Title', value: 'Requiem' });

    expect(modal.active()?.kind).toBe('prompt');
    modal.settle('Bells of Requiem');
    await expect(answer).resolves.toBe('Bells of Requiem');
  });

  it('resolves a dismissed prompt as null', async () => {
    const answer = modal.prompt({ title: 'Title' });
    modal.settle(null);
    await expect(answer).resolves.toBeNull();
  });

  it('resolves a form as a name/value map', async () => {
    const answer = modal.form({
      title: 'Series',
      fields: [{ name: 'number', label: 'Number', type: 'number' }],
    });

    expect(modal.active()?.kind).toBe('form');
    modal.settle({ number: '7' });
    await expect(answer).resolves.toEqual({ number: '7' });
  });

  it('resolves an alert once acknowledged', async () => {
    const answer = modal.alert({ title: 'Signed out' });
    expect(modal.active()?.kind).toBe('alert');
    modal.settle(null);
    await expect(answer).resolves.toBeNull();
  });

  it('carries the request through to whatever renders it', () => {
    modal.confirm({
      title: 'Remove',
      message: '3 works move to Unfiled.',
      confirmLabel: 'Remove',
      danger: true,
    });

    expect(modal.active()).toMatchObject({
      message: '3 works move to Unfiled.',
      confirmLabel: 'Remove',
      danger: true,
    });
  });

  it('keeps only one modal open, cancelling whatever it replaced', async () => {
    const first = modal.confirm({ title: 'First' });
    const second = modal.confirm({ title: 'Second' });

    // The one it displaced resolves as declined rather than hanging forever.
    await expect(first).resolves.toBe(false);
    expect(modal.active()?.title).toBe('Second');

    modal.settle(true);
    await expect(second).resolves.toBe(true);
  });

  it('cancels a displaced prompt as null rather than false', async () => {
    const first = modal.prompt({ title: 'First' });
    modal.alert({ title: 'Second' });

    await expect(first).resolves.toBeNull();
  });

  it('ignores an answer when nothing is open', () => {
    expect(() => modal.settle(true)).not.toThrow();
    expect(modal.active()).toBeNull();
  });

  it('lets a handler open another modal as this one closes', async () => {
    const first = modal.confirm({ title: 'First' });
    first.then(() => modal.alert({ title: 'Second' }));

    modal.settle(true);
    await first;

    expect(modal.active()?.title).toBe('Second');
  });
});
