import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Emote, Feed, Page, Post, ReactionResult, Section, Work } from './models';
import { resolveMediaUrl } from './media-url';

/** Every call the site makes against the content API. */
@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBase;

  // ── Works ──────────────────────────────────────────────────────────────────

  listWorks(section: Section, collection?: string): Observable<{ section: Section; works: Work[] }> {
    const query = collection ? `?collection=${encodeURIComponent(collection)}` : '';
    return this.http.get<{ section: Section; works: Work[] }>(
      `${this.base}/works/${section}${query}`,
    );
  }

  getWork(section: Section, slug: string): Observable<Work> {
    return this.http.get<Work>(`${this.base}/works/${section}/${slug}`);
  }

  /**
   * Fetches the PDF through HttpClient rather than letting pdf.js request the URL
   * itself. The viewer's own XHR carries no Authorization header, so an unpublished
   * draft would 404 for the author who is looking right at it. Going through the
   * interceptor also means the reader keeps working when the bytes later move behind
   * a redirect to object storage.
   */
  /**
   * Asks where the document lives. A URL means object storage — hand it straight to
   * pdf.js so it can range-request the file. Null means the bytes are in MongoDB and
   * must be fetched through the API.
   */
  pdfLink(section: Section, slug: string): Observable<{ url: string | null }> {
    return this.http.get<{ url: string | null }>(
      `${this.base}/works/${section}/${slug}/pdf-link`,
    );
  }

  loadPdf(section: Section, slug: string): Observable<Blob> {
    return this.http.get(`${this.base}/works/${section}/${slug}/pdf`, {
      responseType: 'blob',
    });
  }

  removePdf(id: string): Observable<Work> {
    return this.http.delete<Work>(`${this.base}/works/${id}/pdf`);
  }

  saveWork(id: string, changes: Partial<Work>): Observable<Work> {
    return this.http.patch<Work>(`${this.base}/works/${id}`, changes);
  }

  createWork(work: Partial<Work>): Observable<Work> {
    return this.http.post<Work>(`${this.base}/works`, work);
  }

  deleteWork(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/works/${id}`);
  }

  uploadPdf(id: string, file: File): Observable<Work> {
    const form = new FormData();
    form.append('pdf', file);
    return this.http.put<Work>(`${this.base}/works/${id}/pdf`, form);
  }

  // ── Media ──────────────────────────────────────────────────────────────────

  /** Uploads an image and returns the relative URL to reference it by. */
  uploadImage(file: File, alt = ''): Observable<{ id: string; url: string }> {
    const form = new FormData();
    form.append('image', file);
    form.append('alt', alt);
    return this.http.post<{ id: string; url: string }>(`${this.base}/media`, form);
  }

  /**
   * Uploads a recording. Audio always goes to object storage, so this fails loudly
   * when the bucket is not configured rather than falling back the way images do.
   */
  uploadAudio(file: File): Observable<{ id: string; url: string; originalName: string }> {
    const form = new FormData();
    form.append('audio', file);
    return this.http.post<{ id: string; url: string; originalName: string }>(
      `${this.base}/media/audio`,
      form,
    );
  }

  /**
   * Replaces a singleton image — one whose old copy is worthless the moment it is
   * swapped, like the author's portrait. Reuses the same database document instead
   * of leaving the previous upload orphaned; the returned URL carries a version so
   * the browser still sees the new picture.
   */
  replaceKeyedImage(key: string, file: File, alt = ''): Observable<{ id: string; url: string }> {
    const form = new FormData();
    form.append('image', file);
    form.append('alt', alt);
    return this.http.put<{ id: string; url: string }>(`${this.base}/media/key/${key}`, form);
  }

  /**
   * Stored media URLs are relative (`/api/media/:id`) so a document is portable
   * between environments; the browser still needs an absolute one during local
   * development, where the API and the site are on different ports. See
   * `core/media-url.ts` — this is display only, and must never be written back.
   */
  resolveMediaUrl(url: string): string {
    return resolveMediaUrl(url);
  }

  // ── Pages ──────────────────────────────────────────────────────────────────

  getPage(slug: string): Observable<Page> {
    return this.http.get<Page>(`${this.base}/pages/${slug}`);
  }

  savePage(slug: string, changes: Partial<Page>): Observable<Page> {
    return this.http.put<Page>(`${this.base}/pages/${slug}`, changes);
  }

  // ── Feed ───────────────────────────────────────────────────────────────────

  feed(): Observable<Feed> {
    return this.http.get<Feed>(`${this.base}/posts`);
  }

  createPost(body: string, options: { pinned?: boolean } = {}): Observable<Post> {
    return this.http.post<Post>(`${this.base}/posts`, { body, ...options });
  }

  updatePost(id: string, changes: Partial<Post>): Observable<Post> {
    return this.http.patch<Post>(`${this.base}/posts/${id}`, changes);
  }

  deletePost(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/posts/${id}`);
  }

  react(postId: string, emote: Emote): Observable<ReactionResult> {
    return this.http.post<ReactionResult>(`${this.base}/posts/${postId}/reactions`, { emote });
  }
}
