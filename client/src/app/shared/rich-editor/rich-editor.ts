import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { ContentService } from '../../core/content.service';
import { ModalService } from '../modal/modal.service';
import { AudioBlock } from './audio';
import { YouTubeBlock, youTubeId } from './youtube';

type ToolKind = 'mark' | 'node' | 'align' | 'action';

interface Tool {
  id: string;
  label: string;
  glyph: string;
  kind: ToolKind;
  /** Name TipTap uses for the active check, when it differs from `id`. */
  active?: string;
  attrs?: Record<string, unknown>;
  run: (editor: Editor) => void;
}

/**
 * The document editor behind Poems, Songs, the About page, and the feed composer.
 *
 * TipTap is a headless ProseMirror wrapper, so the toolbar and chrome here are
 * ours — that is what keeps the editor inside the site's palette instead of
 * dragging in a second design system.
 */
@Component({
  selector: 'app-rich-editor',
  templateUrl: './rich-editor.html',
  styleUrl: './rich-editor.scss',
})
export class RichEditorComponent {
  readonly value = input<string>('');
  readonly placeholder = input<string>('Write something…');
  readonly compact = input<boolean>(false);

  readonly valueChange = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('surface');
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');
  private readonly audioInput = viewChild.required<ElementRef<HTMLInputElement>>('audioFile');
  private readonly destroyRef = inject(DestroyRef);
  private readonly content = inject(ContentService);
  private readonly modal = inject(ModalService);

  private editor?: Editor;

  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  /** Bumped on every transaction so the toolbar's active states re-render. */
  protected readonly revision = signal(0);

  /**
   * True while the cursor sits inside a table, which reveals the table controls.
   *
   * Set straight from the editor rather than derived from `revision`: a computed
   * caches on its signal dependencies, and `editor.isActive()` is not one of them, so
   * the value only refreshed when something else happened to bump the counter. That
   * made the toolbar appear on insert and never come back when a cell was clicked.
   */
  protected readonly inTable = signal(false);

  /**
   * Table editing, shown only in context. Kept off the main toolbar because these
   * are meaningless anywhere else and would double its width.
   */
  protected readonly tableTools: Tool[] = [
    { id: 'addRowBefore', label: 'Insert row above', glyph: '⤒', kind: 'action', run: (e) => e.chain().focus().addRowBefore().run() },
    { id: 'addRowAfter', label: 'Insert row below', glyph: '⤓', kind: 'action', run: (e) => e.chain().focus().addRowAfter().run() },
    { id: 'deleteRow', label: 'Delete row', glyph: '⊟', kind: 'action', run: (e) => e.chain().focus().deleteRow().run() },
    { id: 'addColumnBefore', label: 'Insert column left', glyph: '⇤', kind: 'action', run: (e) => e.chain().focus().addColumnBefore().run() },
    { id: 'addColumnAfter', label: 'Insert column right', glyph: '⇥', kind: 'action', run: (e) => e.chain().focus().addColumnAfter().run() },
    { id: 'deleteColumn', label: 'Delete column', glyph: '⊠', kind: 'action', run: (e) => e.chain().focus().deleteColumn().run() },
    { id: 'toggleHeaderRow', label: 'Toggle header row', glyph: 'H↔', kind: 'action', run: (e) => e.chain().focus().toggleHeaderRow().run() },
    { id: 'toggleHeaderColumn', label: 'Toggle header column', glyph: 'H↕', kind: 'action', run: (e) => e.chain().focus().toggleHeaderColumn().run() },
    { id: 'mergeOrSplit', label: 'Merge or split cells', glyph: '⧉', kind: 'action', run: (e) => e.chain().focus().mergeOrSplit().run() },
    { id: 'deleteTable', label: 'Delete table', glyph: '🗑', kind: 'action', run: (e) => this.confirmDeleteTable(e) },
  ];

  protected readonly tools: Tool[][] = [
    [
      { id: 'bold', label: 'Bold', glyph: 'B', kind: 'mark', run: (e) => e.chain().focus().toggleBold().run() },
      { id: 'italic', label: 'Italic', glyph: 'I', kind: 'mark', run: (e) => e.chain().focus().toggleItalic().run() },
      { id: 'underline', label: 'Underline', glyph: 'U', kind: 'mark', run: (e) => e.chain().focus().toggleUnderline().run() },
      { id: 'strike', label: 'Strikethrough', glyph: 'S', kind: 'mark', run: (e) => e.chain().focus().toggleStrike().run() },
      { id: 'highlight', label: 'Highlight', glyph: '▨', kind: 'mark', run: (e) => e.chain().focus().toggleHighlight().run() },
    ],
    [
      { id: 'h1', label: 'Heading 1', glyph: 'H1', kind: 'node', active: 'heading', attrs: { level: 1 }, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
      { id: 'h2', label: 'Heading 2', glyph: 'H2', kind: 'node', active: 'heading', attrs: { level: 2 }, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
      { id: 'h3', label: 'Heading 3', glyph: 'H3', kind: 'node', active: 'heading', attrs: { level: 3 }, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    ],
    [
      { id: 'bulletList', label: 'Bulleted list', glyph: '•—', kind: 'node', run: (e) => e.chain().focus().toggleBulletList().run() },
      { id: 'orderedList', label: 'Numbered list', glyph: '1.', kind: 'node', run: (e) => e.chain().focus().toggleOrderedList().run() },
      { id: 'blockquote', label: 'Quote', glyph: '❝', kind: 'node', run: (e) => e.chain().focus().toggleBlockquote().run() },
      { id: 'codeBlock', label: 'Code block', glyph: '{ }', kind: 'node', run: (e) => e.chain().focus().toggleCodeBlock().run() },
    ],
    // Glyphs are chosen from ranges that default to text presentation — an emoji
    // codepoint here would render in colour and break the monochrome toolbar.
    [
      { id: 'left', label: 'Align left', glyph: '⇤', kind: 'align', run: (e) => e.chain().focus().setTextAlign('left').run() },
      { id: 'center', label: 'Align centre', glyph: '⇔', kind: 'align', run: (e) => e.chain().focus().setTextAlign('center').run() },
      { id: 'right', label: 'Align right', glyph: '⇥', kind: 'align', run: (e) => e.chain().focus().setTextAlign('right').run() },
    ],
    [
      { id: 'link', label: 'Link', glyph: '⧉', kind: 'action', run: (e) => this.promptForLink(e) },
      { id: 'upload', label: 'Upload an image', glyph: '▣', kind: 'action', run: () => this.pickFile() },
      { id: 'image', label: 'Image by address', glyph: '▤', kind: 'action', run: (e) => this.promptForImage(e) },
      { id: 'youtube', label: 'YouTube video', glyph: '▶', kind: 'action', run: () => this.promptForVideo() },
      { id: 'audio', label: 'Upload audio', glyph: '♪', kind: 'action', run: () => this.pickAudio() },
      { id: 'table', label: 'Insert a table', glyph: '▦', kind: 'action', run: () => this.promptForTable() },
      { id: 'horizontalRule', label: 'Divider', glyph: '—', kind: 'action', run: (e) => e.chain().focus().setHorizontalRule().run() },
    ],
    [
      { id: 'undo', label: 'Undo', glyph: '↶', kind: 'action', run: (e) => e.chain().focus().undo().run() },
      { id: 'redo', label: 'Redo', glyph: '↷', kind: 'action', run: (e) => e.chain().focus().redo().run() },
      { id: 'clear', label: 'Clear formatting', glyph: '⌫', kind: 'action', run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run() },
    ],
  ];

  constructor() {
    effect(() => {
      const element = this.host().nativeElement;
      if (!this.editor) this.editor = this.create(element);
    });

    /**
     * Adopt an externally supplied value — but only when it genuinely differs from
     * what the editor already holds, otherwise every keystroke would round-trip and
     * reset the cursor to the start of the document.
     */
    effect(() => {
      const incoming = this.value();
      if (this.editor && incoming !== this.editor.getHTML()) {
        this.editor.commands.setContent(incoming, { emitUpdate: false });
      }
    });

    this.destroyRef.onDestroy(() => this.editor?.destroy());
  }

  protected isActive(tool: Tool): boolean {
    this.revision();
    if (!this.editor) return false;

    if (tool.kind === 'align') return this.editor.isActive({ textAlign: tool.id });
    if (tool.kind === 'action') return false;
    return this.editor.isActive(tool.active ?? tool.id, tool.attrs);
  }

  protected run(tool: Tool): void {
    if (this.editor) tool.run(this.editor);
  }

  private create(element: HTMLElement): Editor {
    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          link: {
            openOnClick: false,
            HTMLAttributes: { rel: 'noopener noreferrer' },
          },
        }),
        TextStyleKit,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Highlight,
        Image.configure({ inline: false }),
        TableKit.configure({ table: { resizable: true } }),
        YouTubeBlock,
        AudioBlock,
        Placeholder.configure({ placeholder: () => this.placeholder() }),
      ],
      content: this.value(),

      onUpdate: ({ editor }) => this.valueChange.emit(editor.getHTML()),

      /**
       * Fires for every state change — typing, clicking, selecting — which is the
       * only hook that reliably covers moving the caret into a table cell.
       */
      onTransaction: ({ editor }) => {
        this.revision.update((n) => n + 1);
        this.inTable.set(editor.isActive('table'));
      },
    });

    return editor;
  }

  private async promptForLink(editor: Editor): Promise<void> {
    const previous = editor.getAttributes('link')['href'] as string | undefined;

    const href = await this.modal.prompt({
      title: 'Link address',
      message: 'Leave it empty to remove the link.',
      value: previous ?? 'https://',
      placeholder: 'https://',
      confirmLabel: 'Apply',
    });

    // Cancel leaves the document untouched; an empty string clears the link.
    if (href === null) return;
    if (href.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  private async promptForImage(editor: Editor): Promise<void> {
    const src = await this.modal.prompt({
      title: 'Image address',
      message: 'Paste a link to an image, or use the upload button instead.',
      placeholder: 'https://',
      confirmLabel: 'Insert',
    });

    if (src?.trim()) editor.chain().focus().setImage({ src: src.trim() }).run();
  }

  /** Asks for the size first rather than dropping a fixed 3×3 grid on the page. */
  private async promptForTable(): Promise<void> {
    const size = await this.modal.form({
      title: 'Insert a table',
      message: 'How big should it be? A header row is added automatically.',
      fields: [
        { name: 'rows', label: 'Rows', type: 'number', value: '3', min: 1, max: 50 },
        { name: 'cols', label: 'Columns', type: 'number', value: '3', min: 1, max: 20 },
      ],
      confirmLabel: 'Insert',
    });
    if (!size) return;

    const clamp = (value: number, min: number, max: number) =>
      Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : min;

    const rows = clamp(Number(size['rows']), 1, 50);
    const cols = clamp(Number(size['cols']), 1, 20);

    this.editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  }

  private async confirmDeleteTable(editor: Editor): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Delete this table?',
      message: 'The table and everything in it is removed.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (confirmed) editor.chain().focus().deleteTable().run();
  }

  /**
   * Accepts any YouTube link shape and stores only the extracted id, so the document
   * never carries a URL somebody could point elsewhere.
   */
  private async promptForVideo(): Promise<void> {
    const link = await this.modal.prompt({
      title: 'YouTube link',
      message: 'Paste the address of the video. It appears as a player readers can play in place.',
      placeholder: 'https://www.youtube.com/watch?v=…',
      confirmLabel: 'Insert',
    });
    if (link === null) return;

    const videoId = youTubeId(link);
    if (!videoId) {
      await this.modal.alert({
        title: 'That is not a YouTube link',
        message: 'Try a link like https://www.youtube.com/watch?v=… or https://youtu.be/…',
      });
      return;
    }

    const title = await this.modal.prompt({
      title: 'Give it a caption',
      message: 'Shown over the thumbnail, and read out by screen readers. Optional.',
      placeholder: 'Optional',
      confirmLabel: 'Insert',
    });

    this.editor?.chain().focus().setYouTube({ videoId, title: title?.trim() ?? '' }).run();
  }

  /** Opens the operating system's file picker. */
  private pickFile(): void {
    this.fileInput().nativeElement.click();
  }

  private pickAudio(): void {
    this.audioInput().nativeElement.click();
  }

  /**
   * Uploads a recording and inserts a player at the cursor.
   *
   * The caption is asked for after the upload rather than before, prefilled with the
   * file's own name: by then the author knows the file went through, and the common
   * case is one keystroke — Enter — instead of typing a name that is already there.
   */
  protected async onAudioChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.editor) return;

    input.value = '';
    this.uploading.set(true);
    this.uploadError.set(null);

    let uploaded: { url: string };
    try {
      uploaded = await firstValueFrom(this.content.uploadAudio(file));
    } catch (response: unknown) {
      const message = (response as { error?: { error?: string } })?.error?.error;
      this.uploadError.set(message ?? 'That recording could not be uploaded.');
      this.uploading.set(false);
      return;
    }

    this.uploading.set(false);

    const title = await this.modal.prompt({
      title: 'Name this recording',
      message: 'Shown above the player, and read out by screen readers.',
      value: file.name.replace(/\.[^.]+$/, ''),
      confirmLabel: 'Insert',
    });

    this.editor
      .chain()
      .focus()
      .setAudio({
        src: this.content.resolveMediaUrl(uploaded.url),
        title: title?.trim() ?? '',
      })
      .run();
  }

  /**
   * Uploads the chosen file and inserts it at the cursor. The document stores the
   * relative `/api/media/:id` reference; only the rendered `src` is absolute, so the
   * same HTML works unchanged once the site and API share an origin in production.
   */
  protected onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.editor) return;

    this.uploading.set(true);
    this.uploadError.set(null);

    this.content.uploadImage(file, file.name.replace(/\.[^.]+$/, '')).subscribe({
      next: ({ url }) => {
        this.editor
          ?.chain()
          .focus()
          .setImage({ src: this.content.resolveMediaUrl(url), alt: file.name })
          .run();
        this.uploading.set(false);
        input.value = '';
      },
      error: (response) => {
        this.uploadError.set(response?.error?.error ?? 'That image could not be uploaded.');
        this.uploading.set(false);
        input.value = '';
      },
    });
  }

  /** Images dropped or pasted into the surface take the same path as the picker. */
  protected onDrop(event: DragEvent): void {
    const file = [...(event.dataTransfer?.files ?? [])].find((item) =>
      item.type.startsWith('image/'),
    );
    if (!file) return;

    event.preventDefault();
    this.uploadDirect(file);
  }

  protected onPaste(event: ClipboardEvent): void {
    const item = [...(event.clipboardData?.items ?? [])].find((entry) =>
      entry.type.startsWith('image/'),
    );
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      this.uploadDirect(file);
      return;
    }

    this.pasteTable(event);
  }

  /**
   * Word and Excel both put real HTML on the clipboard, which ProseMirror parses into
   * a table on its own. Some sources — including Excel in certain paste paths, and
   * plain-text editors — offer only tab-separated text, which would otherwise land as
   * a single run of characters. This turns that case into a table too.
   */
  private pasteTable(event: ClipboardEvent): void {
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (/<table/i.test(html)) return; // ProseMirror handles it.

    const text = event.clipboardData?.getData('text/plain') ?? '';
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');

    // Needs at least two columns and two rows to be a table rather than prose.
    const grid = rows.map((row) => row.split('\t'));
    const columns = grid[0]?.length ?? 0;
    const looksTabular =
      grid.length > 1 && columns > 1 && grid.every((row) => row.length === columns);

    if (!looksTabular || !this.editor) return;

    event.preventDefault();

    const escapeCell = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const [head, ...body] = grid;
    const html5 =
      '<table><tbody>' +
      `<tr>${head.map((c) => `<th>${escapeCell(c)}</th>`).join('')}</tr>` +
      body.map((row) => `<tr>${row.map((c) => `<td>${escapeCell(c)}</td>`).join('')}</tr>`).join('') +
      '</tbody></table>';

    this.editor.chain().focus().insertContent(html5).run();
  }

  private uploadDirect(file: File): void {
    this.uploading.set(true);
    this.uploadError.set(null);

    this.content.uploadImage(file).subscribe({
      next: ({ url }) => {
        this.editor?.chain().focus().setImage({ src: this.content.resolveMediaUrl(url) }).run();
        this.uploading.set(false);
      },
      error: (response) => {
        this.uploadError.set(response?.error?.error ?? 'That image could not be uploaded.');
        this.uploading.set(false);
      },
    });
  }
}
