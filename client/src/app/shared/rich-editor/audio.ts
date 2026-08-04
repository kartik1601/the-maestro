import { Node, mergeAttributes } from '@tiptap/core';
import { environment } from '../../../environments/environment';

export interface AudioOptions {
  src: string;
  title?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    audioBlock: {
      /** Inserts an audio block for an already-uploaded recording. */
      setAudio: (options: AudioOptions) => ReturnType;
    };
  }
}

/** `/api/media/<ObjectId>` — the only shape this site ever issues for a media file. */
const MEDIA_PATH = /^\/api\/media\/[a-f\d]{24}(\?[\w=&.%-]*)?$/i;

/**
 * Whether a stored source is a recording this site issued.
 *
 * Checked on the way in and again at render time, because the stored attribute ends
 * up as the `src` of a media element. A relative path is always ours. An absolute one
 * is only accepted when it points at the API this bundle was built to talk to — which
 * happens in local development, where the site and the API sit on different ports and
 * `resolveMediaUrl` therefore stores an absolute reference. Any other host is refused
 * rather than quietly fetched.
 */
export function isOurMedia(src: string | null | undefined): boolean {
  const value = String(src ?? '');
  if (MEDIA_PATH.test(value)) return true;

  const origin = environment.apiBase.replace(/\/api\/?$/, '');
  if (!/^https?:\/\//.test(origin) || !value.startsWith(origin)) return false;

  return MEDIA_PATH.test(value.slice(origin.length));
}

/**
 * A recording as a first-class block in the document.
 *
 * Stored as `<div data-audio="…">` rather than an `<audio>` element, for the same
 * reason videos are stored as a bare id: the player is built by our own code at render
 * time, from a source that has been validated as ours, instead of whatever markup
 * happened to survive the sanitizer.
 */
export const AudioBlock = Node.create({
  name: 'audioBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-audio'),
        renderHTML: (attributes) =>
          attributes['src'] ? { 'data-audio': attributes['src'] } : {},
      },
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') ?? '',
        renderHTML: (attributes) =>
          attributes['title'] ? { 'data-title': attributes['title'] } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-audio]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'audio' })];
  },

  /**
   * Inside the editor the block is a working player, so the author can hear what they
   * have just attached without leaving edit mode. `contentEditable = false` keeps
   * ProseMirror's selection out of the controls.
   */
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'audio audio--editing';
      dom.contentEditable = 'false';

      const src = String(node.attrs['src'] ?? '');
      const title = String(node.attrs['title'] ?? '');

      if (title) {
        const caption = document.createElement('span');
        caption.className = 'audio__title';
        caption.textContent = title;
        dom.append(caption);
      }

      if (isOurMedia(src)) {
        const player = document.createElement('audio');
        player.className = 'audio__player';
        player.controls = true;
        player.preload = 'metadata';
        player.src = src;
        dom.append(player);
      } else {
        const missing = document.createElement('span');
        missing.className = 'audio__missing';
        missing.textContent = 'This recording is missing.';
        dom.append(missing);
      }

      return { dom };
    };
  },

  addCommands() {
    return {
      setAudio:
        (options: AudioOptions) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },
});
