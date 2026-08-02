import { Node, mergeAttributes } from '@tiptap/core';

export interface YouTubeOptions {
  videoId: string;
  title?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    youtube: {
      /** Inserts a YouTube block for the given video id. */
      setYouTube: (options: YouTubeOptions) => ReturnType;
    };
  }
}

/**
 * Extracts the eleven-character video id from any of the shapes YouTube hands out —
 * a watch URL, a share link, an embed URL, a Shorts link, or the bare id itself.
 */
export function youTubeId(input: string): string | null {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;

  const patterns = [
    /youtube\.com\/watch\?(?:.*&)?v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
    /youtube\.com\/live\/([\w-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * A YouTube video as a first-class block in the document.
 *
 * Stored as `<div data-youtube="ID">` rather than a raw <iframe>: the sanitizer
 * running over every save strips iframes on purpose, and it should keep doing so.
 * The player is constructed at render time from the id alone, so nothing arbitrary
 * from the editor ends up framed on the page.
 */
export const YouTubeBlock = Node.create({
  name: 'youtube',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      videoId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-youtube'),
        renderHTML: (attributes) =>
          attributes['videoId'] ? { 'data-youtube': attributes['videoId'] } : {},
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
    return [{ tag: 'div[data-youtube]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'yt' })];
  },

  /** Inside the editor the block shows the thumbnail, so it is recognisable while writing. */
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'yt yt--editing';
      dom.contentEditable = 'false';

      const id = node.attrs['videoId'];
      dom.innerHTML = id
        ? `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" />
           <span class="yt__badge">▶ YouTube</span>`
        : '<span class="yt__badge">Video</span>';

      return { dom };
    };
  },

  addCommands() {
    return {
      setYouTube:
        (options: YouTubeOptions) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: options }),
    };
  },
});
