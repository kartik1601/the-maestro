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
  private readonly destroyRef = inject(DestroyRef);
  private readonly content = inject(ContentService);
  private readonly modal = inject(ModalService);

  private editor?: Editor;

  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  /** Bumped on every transaction so the toolbar's active states re-render. */
  protected readonly revision = signal(0);

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
      { id: 'table', label: 'Table', glyph: '▦', kind: 'action', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
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
        Placeholder.configure({ placeholder: () => this.placeholder() }),
      ],
      content: this.value(),
      onUpdate: ({ editor }) => {
        this.revision.update((n) => n + 1);
        this.valueChange.emit(editor.getHTML());
      },
      onSelectionUpdate: () => this.revision.update((n) => n + 1),
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

  /** Opens the operating system's file picker. */
  private pickFile(): void {
    this.fileInput().nativeElement.click();
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
    if (!file) return;

    event.preventDefault();
    this.uploadDirect(file);
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
