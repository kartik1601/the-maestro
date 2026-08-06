import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ContentService } from './content.service';
import { environment } from '../../environments/environment';

const API = environment.apiBase;

describe('ContentService', () => {
  let content: ContentService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    content = TestBed.inject(ContentService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('works', () => {
    it('lists a section', () => {
      content.listWorks('poems').subscribe();
      expect(http.expectOne(`${API}/works/poems`).request.method).toBe('GET');
    });

    it('narrows a listing to one sub-section', () => {
      content.listWorks('songs', 'kk').subscribe();
      http.expectOne(`${API}/works/songs?collection=kk`).flush({ section: 'songs', works: [] });
    });

    it('escapes a sub-section key that needs it', () => {
      content.listWorks('poems', 'rains of love').subscribe();
      http
        .expectOne(`${API}/works/poems?collection=rains%20of%20love`)
        .flush({ section: 'poems', works: [] });
    });

    it('fetches one work by slug', () => {
      content.getWork('novels', 'gates-of-infinity').subscribe();
      http.expectOne(`${API}/works/novels/gates-of-infinity`).flush({});
    });

    it('creates a work', () => {
      content.createWork({ section: 'poems', title: 'Requiem' }).subscribe();

      const request = http.expectOne(`${API}/works`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ section: 'poems', title: 'Requiem' });
      request.flush({});
    });

    it('saves changes as a patch, not a whole replacement', () => {
      content.saveWork('abc123', { published: true }).subscribe();

      const request = http.expectOne(`${API}/works/abc123`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ published: true });
      request.flush({});
    });

    it('deletes a work', () => {
      content.deleteWork('abc123').subscribe();
      expect(http.expectOne(`${API}/works/abc123`).request.method).toBe('DELETE');
    });
  });

  describe('PDFs', () => {
    it('asks where the document lives before fetching it', () => {
      content.pdfLink('novels', 'a-red-kingdom').subscribe();
      http.expectOne(`${API}/works/novels/a-red-kingdom/pdf-link`).flush({ url: null });
    });

    it('fetches the bytes as a blob', () => {
      content.loadPdf('novels', 'a-red-kingdom').subscribe();

      const request = http.expectOne(`${API}/works/novels/a-red-kingdom/pdf`);
      expect(request.request.responseType).toBe('blob');
      request.flush(new Blob());
    });

    it('uploads a PDF as multipart under the field the server reads', () => {
      const file = new File(['%PDF-1.7'], 'kingdom.pdf', { type: 'application/pdf' });
      content.uploadPdf('abc123', file).subscribe();

      const request = http.expectOne(`${API}/works/abc123/pdf`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toBeInstanceOf(FormData);
      expect((request.request.body as FormData).get('pdf')).toBe(file);
      request.flush({});
    });

    it('removes a PDF without removing its work', () => {
      content.removePdf('abc123').subscribe();
      expect(http.expectOne(`${API}/works/abc123/pdf`).request.method).toBe('DELETE');
    });
  });

  describe('media', () => {
    it('uploads an image with its alt text', () => {
      const file = new File([''], 'photo.png', { type: 'image/png' });
      content.uploadImage(file, 'The author').subscribe();

      const body = http.expectOne(`${API}/media`).request.body as FormData;
      expect(body.get('image')).toBe(file);
      expect(body.get('alt')).toBe('The author');
    });

    it('uploads a recording', () => {
      const file = new File([''], 'cover.mp3', { type: 'audio/mpeg' });
      content.uploadAudio(file).subscribe();

      const request = http.expectOne(`${API}/media/audio`);
      expect((request.request.body as FormData).get('audio')).toBe(file);
      request.flush({});
    });

    it('replaces a keyed image in place rather than orphaning the old one', () => {
      const file = new File([''], 'portrait.jpg', { type: 'image/jpeg' });
      content.replaceKeyedImage('author-portrait', file).subscribe();

      const request = http.expectOne(`${API}/media/key/author-portrait`);
      expect(request.request.method).toBe('PUT');
      request.flush({});
    });
  });

  describe('pages', () => {
    it('reads a page by slug', () => {
      content.getPage('about').subscribe();
      http.expectOne(`${API}/pages/about`).flush({});
    });

    it('saves a page with a put', () => {
      content.savePage('poems', { title: 'Poems' }).subscribe();

      const request = http.expectOne(`${API}/pages/poems`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ title: 'Poems' });
      request.flush({});
    });
  });

  describe('feed', () => {
    it('reads the feed', () => {
      content.feed().subscribe();
      http.expectOne(`${API}/posts`).flush({ emotes: [], posts: [] });
    });

    it('creates a post, carrying any options alongside the body', () => {
      content.createPost('<p>Hello</p>', { pinned: true }).subscribe();

      const request = http.expectOne(`${API}/posts`);
      expect(request.request.body).toEqual({ body: '<p>Hello</p>', pinned: true });
      request.flush({});
    });

    it('updates a post', () => {
      content.updatePost('p1', { published: false }).subscribe();

      const request = http.expectOne(`${API}/posts/p1`);
      expect(request.request.method).toBe('PATCH');
      request.flush({});
    });

    it('deletes a post', () => {
      content.deletePost('p1').subscribe();
      expect(http.expectOne(`${API}/posts/p1`).request.method).toBe('DELETE');
    });

    it('toggles a reaction by emote', () => {
      content.react('p1', 'heart').subscribe();

      const request = http.expectOne(`${API}/posts/p1/reactions`);
      expect(request.request.body).toEqual({ emote: 'heart' });
      request.flush({ emote: 'heart', reacted: true, counts: {} });
    });
  });

  it('exposes media URL resolution for templates to display by', () => {
    expect(content.resolveMediaUrl('https://example.com/x.png')).toBe('https://example.com/x.png');
  });
});
