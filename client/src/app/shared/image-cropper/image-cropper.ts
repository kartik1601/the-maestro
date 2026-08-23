import {
  Component,
  ElementRef,
  HostListener,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** The portrait is square everywhere it appears, so the crop frame is too. */
const OUTPUT_SIZE = 768;

/** Zoom is expressed as a multiple of the cover fit — 1 is "just fills the frame". */
const MAX_ZOOM = 4;

/**
 * A square crop dialog: drag to reposition, pinch or scroll to zoom.
 *
 * The image is never scaled up beyond what the source has to give — everything the
 * frame shows is read back out of the original pixels at export time, so a tight crop
 * of a large photograph stays sharp.
 *
 * The source must be same-origin or a blob URL. A cross-origin image taints the
 * canvas and `toBlob` would throw; the caller is expected to fetch bytes first.
 */
@Component({
  selector: 'app-image-cropper',
  templateUrl: './image-cropper.html',
  styleUrl: './image-cropper.scss',
})
export class ImageCropperComponent {
  /** Object URL or data URL for the image being adjusted. */
  readonly src = input.required<string>();
  readonly title = input('Adjust photo');
  /** Set while the parent is uploading the result. */
  readonly busy = input(false);

  readonly cropped = output<Blob>();
  readonly cancelled = output<void>();

  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
  private readonly image = viewChild.required<ElementRef<HTMLImageElement>>('image');

  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  protected readonly exporting = signal(false);

  /** Natural size of the source, known only once it has decoded. */
  private readonly natural = signal({ width: 0, height: 0 });

  /** Side of the on-screen frame in CSS pixels, remeasured when the window changes. */
  private readonly frameSize = signal(0);

  protected readonly zoom = signal(1);

  /** Top-left of the scaled image relative to the frame, in CSS pixels. */
  private readonly offset = signal({ x: 0, y: 0 });

  /** Pixels per source pixel at zoom 1 — the smallest scale that still covers. */
  private readonly coverScale = computed(() => {
    const { width, height } = this.natural();
    const frame = this.frameSize();
    if (!width || !height || !frame) return 0;
    return frame / Math.min(width, height);
  });

  private readonly scale = computed(() => this.coverScale() * this.zoom());

  protected readonly displayWidth = computed(() => this.natural().width * this.scale());
  protected readonly displayHeight = computed(() => this.natural().height * this.scale());

  protected readonly transform = computed(() => {
    const { x, y } = this.offset();
    return `translate(${x}px, ${y}px)`;
  });

  protected readonly canApply = computed(
    () => this.loaded() && !this.failed() && !this.exporting() && !this.busy(),
  );

  /** Active pointers, so a two-finger pinch can be told apart from a drag. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: { distance: number; zoom: number } | null = null;
  private dragFrom: { x: number; y: number; ox: number; oy: number } | null = null;

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.exporting() && !this.busy()) this.cancelled.emit();
  }

  @HostListener('window:resize')
  protected onResize(): void {
    if (!this.loaded()) return;

    // Keep the same part of the photograph framed as the frame changes size.
    const previous = this.frameSize();
    this.measureFrame();
    const ratio = previous ? this.frameSize() / previous : 1;
    this.offset.update(({ x, y }) => ({ x: x * ratio, y: y * ratio }));
    this.clamp();
  }

  protected onImageLoad(): void {
    const element = this.image().nativeElement;
    this.natural.set({ width: element.naturalWidth, height: element.naturalHeight });
    this.measureFrame();
    this.zoom.set(1);
    this.centre();
    this.loaded.set(true);
  }

  protected onImageError(): void {
    this.failed.set(true);
  }

  // ── Panning and pinching ───────────────────────────────────────────────────

  protected onPointerDown(event: PointerEvent): void {
    if (!this.loaded()) return;

    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      this.dragFrom = null;
      this.pinchStart = { distance: this.pointerDistance(), zoom: this.zoom() };
      return;
    }

    const { x, y } = this.offset();
    this.dragFrom = { x: event.clientX, y: event.clientY, ox: x, oy: y };
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pinchStart && this.pointers.size >= 2) {
      const distance = this.pointerDistance();
      if (distance > 0) this.zoomTo(this.pinchStart.zoom * (distance / this.pinchStart.distance));
      return;
    }

    const from = this.dragFrom;
    if (!from) return;

    event.preventDefault();
    this.offset.set({
      x: from.ox + (event.clientX - from.x),
      y: from.oy + (event.clientY - from.y),
    });
    this.clamp();
  }

  protected onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;

    // The finger that stays down after a pinch continues as a drag, from where it is.
    if (this.pointers.size === 1) {
      const [remaining] = [...this.pointers.values()];
      const { x, y } = this.offset();
      this.dragFrom = { x: remaining.x, y: remaining.y, ox: x, oy: y };
    } else {
      this.dragFrom = null;
    }
  }

  protected onWheel(event: WheelEvent): void {
    if (!this.loaded()) return;

    event.preventDefault();
    // Exponential so each notch feels the same at every zoom level.
    this.zoomTo(this.zoom() * Math.exp(-event.deltaY / 400));
  }

  protected onZoomInput(value: string): void {
    this.zoomTo(Number(value));
  }

  protected reset(): void {
    this.zoom.set(1);
    this.centre();
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  protected apply(): void {
    if (!this.canApply()) return;

    const frame = this.frameSize();
    const scale = this.scale();
    if (!frame || !scale) return;

    this.exporting.set(true);

    const { x, y } = this.offset();
    // Frame coordinates back into source pixels — what the author actually framed.
    const source = {
      x: -x / scale,
      y: -y / scale,
      size: frame / scale,
    };

    // Never enlarge: a crop smaller than the target exports at its own resolution.
    const size = Math.max(1, Math.round(Math.min(OUTPUT_SIZE, source.size)));

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext('2d');
    if (!context) {
      this.exporting.set(false);
      this.failed.set(true);
      return;
    }

    context.imageSmoothingQuality = 'high';
    context.drawImage(
      this.image().nativeElement,
      source.x,
      source.y,
      source.size,
      source.size,
      0,
      0,
      size,
      size,
    );

    canvas.toBlob(
      (blob) => {
        this.exporting.set(false);
        if (blob) this.cropped.emit(blob);
        else this.failed.set(true);
      },
      'image/jpeg',
      0.92,
    );
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  private measureFrame(): void {
    this.frameSize.set(this.frame().nativeElement.clientWidth);
  }

  private centre(): void {
    const frame = this.frameSize();
    this.offset.set({
      x: (frame - this.displayWidth()) / 2,
      y: (frame - this.displayHeight()) / 2,
    });
  }

  private zoomTo(value: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(1, value));
    const previous = this.zoom();
    if (next === previous) return;

    // Zoom about the middle of the frame, so the subject the author centred stays put.
    const frame = this.frameSize();
    const ratio = next / previous;
    this.offset.update(({ x, y }) => ({
      x: frame / 2 - (frame / 2 - x) * ratio,
      y: frame / 2 - (frame / 2 - y) * ratio,
    }));

    this.zoom.set(next);
    this.clamp();
  }

  /** Keeps the frame full — the image can never be dragged off its own edge. */
  private clamp(): void {
    const frame = this.frameSize();
    const width = this.displayWidth();
    const height = this.displayHeight();

    this.offset.update(({ x, y }) => ({
      x: Math.min(0, Math.max(frame - width, x)),
      y: Math.min(0, Math.max(frame - height, y)),
    }));
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget && !this.exporting() && !this.busy()) {
      this.cancelled.emit();
    }
  }
}
