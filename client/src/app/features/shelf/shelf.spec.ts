import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { ShelfComponent } from './shelf';
import { AuthService } from '../../core/auth.service';
import { Page, Section, Work, WorkCollection } from '../../core/models';
import { environment } from '../../../environments/environment';
import { resetMediaQueries, setMediaQuery } from '../../../testing/setup';

const PHONE = '(max-width: 40rem)';
const API = environment.apiBase;

const collection = (key: string, label: string, sortOrder: number): WorkCollection => ({
  key,
  label,
  note: '',
  sortOrder,
});

const work = (id: string, collectionKey: string, title = id): Work =>
  ({
    id,
    section: 'poems',
    kind: 'document',
    title,
    slug: id,
    subtitle: '',
    summary: '',
    collectionKey,
    seriesNumber: null,
    tintWord: '',
    videoId: '',
    sortOrder: 0,
    pinned: false,
    published: true,
    excerpt: '',
    readingMinutes: 1,
    publishedAt: null,
    updatedAt: '',
    pdf: {
      hasFile: false,
      byteSize: 0,
      pageCount: null,
      originalName: null,
      uploadedAt: null,
    },
  }) satisfies Work;

const page = (collections: WorkCollection[]): Partial<Page> => ({
  id: 'p',
  slug: 'poems',
  title: 'Poems',
  subtitle: 'All for you.',
  dialogue: [],
  dialogueSource: '',
  collections,
});

describe('ShelfComponent', () => {
  let fixture: ComponentFixture<ShelfComponent>;
  let http: HttpTestingController;
  let routeData: BehaviorSubject<{ section: Section }>;

  const collections = [
    collection('rains-of-love', 'Rains of Love', 0),
    collection('others', 'All Others', 1),
  ];

  const works = [
    work('rain-one', 'rains-of-love'),
    work('rain-two', 'rains-of-love'),
    work('other-one', 'others'),
  ];

  /**
   * Renders the shelf for a section at a given width, and answers the two requests it
   * makes on arrival.
   */
  async function shelf(
    section: Section,
    { narrow, works: listed = works, collections: groups = collections } = {
      narrow: false,
      works,
      collections,
    },
  ) {
    resetMediaQueries();
    setMediaQuery(PHONE, narrow);

    routeData = new BehaviorSubject<{ section: Section }>({ section });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ShelfComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { data: routeData.asObservable() } },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ShelfComponent);
    fixture.detectChanges();

    answer(section, listed, groups);
    await fixture.whenStable();
    return fixture;
  }

  /** Flushes the works, page and version calls a freshly-arrived shelf makes. */
  function answer(section: Section, listed: Work[], groups: WorkCollection[]) {
    http.expectOne(`${API}/works/${section}`).flush({ section, works: listed });
    http.expectOne(`${API}/pages/${section}`).flush(page(groups));
    for (const request of http.match(`${API}/version`)) {
      // Every section is present in a real answer, null included — see version.js.
      request.flush({ posts: null, works: { [section]: null }, pages: {}, checkedAt: '' });
    }
  }

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
  });

  const html = () => fixture.nativeElement as HTMLElement;
  const sections = () => [...html().querySelectorAll('.group')];
  const toggles = () => [...html().querySelectorAll<HTMLButtonElement>('.group__toggle')];
  const openPanels = () => [...html().querySelectorAll('.group__panel--open')];
  const cards = () => [...html().querySelectorAll('.card')];

  describe('on a wide screen', () => {
    it('lays every sub-section out, with no toggle', async () => {
      await shelf('poems');

      expect(sections()).toHaveLength(2);
      expect(toggles()).toHaveLength(0);
      expect(sections().every((group) => !group.classList.contains('group--collapsible'))).toBe(
        true,
      );
    });

    it('leaves every panel open', async () => {
      await shelf('poems');
      expect(openPanels()).toHaveLength(2);
      expect(cards()).toHaveLength(3);
    });
  });

  describe('on a phone', () => {
    it('collapses poems to their sub-section headings', async () => {
      await shelf('poems', { narrow: true, works, collections });

      expect(toggles()).toHaveLength(2);
      expect(openPanels()).toHaveLength(0);
      expect(sections().every((group) => group.classList.contains('group--collapsible'))).toBe(
        true,
      );
    });

    it('collapses songs the same way', async () => {
      await shelf('songs', { narrow: true, works, collections });
      expect(toggles()).toHaveLength(2);
    });

    it('leaves novels laid out — a short list of large works', async () => {
      await shelf('novels', { narrow: true, works, collections });

      expect(toggles()).toHaveLength(0);
      expect(openPanels()).toHaveLength(2);
    });

    it('leaves plays and novelettes laid out too', async () => {
      await shelf('plays', { narrow: true, works, collections });
      expect(toggles()).toHaveLength(0);

      await shelf('novelettes', { narrow: true, works, collections });
      expect(toggles()).toHaveLength(0);
    });

    it('still shows the headings, counts and notes while closed', async () => {
      await shelf('poems', { narrow: true, works, collections });

      const headings = [...html().querySelectorAll('.group__title')].map((h) =>
        h.textContent?.trim(),
      );
      expect(headings).toEqual(['Rains of Love', 'All Others']);

      const counts = [...html().querySelectorAll('.group__count')].map((c) =>
        c.textContent?.trim(),
      );
      expect(counts).toEqual(['2', '1']);
    });

    describe('opening a sub-section', () => {
      beforeEach(async () => {
        await shelf('poems', { narrow: true, works, collections });
      });

      it('opens the one that was tapped and no other', async () => {
        toggles()[0].click();
        await fixture.whenStable();

        expect(openPanels()).toHaveLength(1);
        expect(toggles()[0].getAttribute('aria-expanded')).toBe('true');
        expect(toggles()[1].getAttribute('aria-expanded')).toBe('false');
      });

      it('closes again on a second tap', async () => {
        toggles()[0].click();
        await fixture.whenStable();
        toggles()[0].click();
        await fixture.whenStable();

        expect(openPanels()).toHaveLength(0);
        expect(toggles()[0].getAttribute('aria-expanded')).toBe('false');
      });

      it('lets several be open at once', async () => {
        toggles()[0].click();
        toggles()[1].click();
        await fixture.whenStable();

        expect(openPanels()).toHaveLength(2);
      });

      it('turns the chevron over', async () => {
        const chevron = () => html().querySelector('.group__chevron');
        expect(chevron()?.classList.contains('group__chevron--open')).toBe(false);

        toggles()[0].click();
        await fixture.whenStable();
        expect(chevron()?.classList.contains('group__chevron--open')).toBe(true);
      });
    });

    describe('accessibility', () => {
      beforeEach(async () => {
        await shelf('poems', { narrow: true, works, collections });
      });

      it('names each toggle by the sub-section it opens', () => {
        expect(toggles().map((button) => button.getAttribute('aria-label'))).toEqual([
          'Rains of Love',
          'All Others',
        ]);
      });

      it('points each toggle at the panel it controls', () => {
        for (const button of toggles()) {
          const id = button.getAttribute('aria-controls');
          expect(id).toBeTruthy();
          expect(html().querySelector(`#${id}`)?.classList.contains('group__panel')).toBe(true);
        }
      });

      it('keeps the headings as headings rather than putting them in the button', () => {
        expect(html().querySelectorAll('h2.group__title')).toHaveLength(2);
        expect(html().querySelector('.group__toggle h2')).toBeNull();
      });
    });
  });

  describe('when the viewport changes under it', () => {
    it('lays everything back out when the screen widens', async () => {
      await shelf('poems', { narrow: true, works, collections });
      expect(openPanels()).toHaveLength(0);

      setMediaQuery(PHONE, false);
      await fixture.whenStable();

      expect(toggles()).toHaveLength(0);
      expect(openPanels()).toHaveLength(2);
    });

    it('collapses when a wide screen becomes narrow', async () => {
      await shelf('poems');
      expect(toggles()).toHaveLength(0);

      setMediaQuery(PHONE, true);
      await fixture.whenStable();

      expect(toggles()).toHaveLength(2);
      expect(openPanels()).toHaveLength(0);
    });
  });

  describe('navigating between sections', () => {
    it('arrives at the next shelf closed rather than carrying the last one open', async () => {
      await shelf('poems', { narrow: true, works, collections });

      toggles()[0].click();
      await fixture.whenStable();
      expect(openPanels()).toHaveLength(1);

      routeData.next({ section: 'songs' });
      answer('songs', works, collections);
      await fixture.whenStable();

      expect(openPanels()).toHaveLength(0);
    });
  });

  describe('unfiled works', () => {
    const orphan = [...works, work('lost-poem', 'a-removed-collection')];

    it('gives them a home of their own', async () => {
      await shelf('poems', { narrow: false, works: orphan, collections });

      const headings = [...html().querySelectorAll('.group__title')].map((h) =>
        h.textContent?.trim(),
      );
      expect(headings).toContain('Unfiled');
    });

    it('collapses that home too, so the shelf reads as one list', async () => {
      await shelf('poems', { narrow: true, works: orphan, collections });

      expect(toggles()).toHaveLength(3);
      expect(toggles()[2].getAttribute('aria-label')).toBe('Unfiled');
      expect(openPanels()).toHaveLength(0);

      toggles()[2].click();
      await fixture.whenStable();
      expect(openPanels()).toHaveLength(1);
    });
  });

  describe('sub-sections with nothing in them', () => {
    it('stay hidden from a reader', async () => {
      await shelf('poems', {
        narrow: true,
        works: [work('rain-one', 'rains-of-love')],
        collections,
      });

      expect(toggles()).toHaveLength(1);
      expect(html().querySelector('.group__title')?.textContent?.trim()).toBe('Rains of Love');
    });
  });

  describe('the refresh pill', () => {
    const pill = () => html().querySelector('.pill');

    /** A second poll, without waiting out the interval: returning to the tab forces one. */
    const pollAgain = async (poems: string | null) => {
      document.dispatchEvent(new Event('visibilitychange'));
      http
        .expectOne(`${API}/version`)
        .flush({ posts: null, works: { poems }, pages: {}, checkedAt: '' });
      await fixture.whenStable();
    };

    it('offers a reader the refresh, with no session of any kind', async () => {
      await shelf('poems');
      expect(TestBed.inject(AuthService).isAdmin()).toBe(false);
      expect(pill()).toBeNull();

      await pollAgain('moved on');
      expect(pill()).not.toBeNull();
    });

    it('stays away while nothing has changed', async () => {
      await shelf('poems');
      await pollAgain(null);
      expect(pill()).toBeNull();
    });
  });

  describe('ordering the shelf', () => {
    const grips = () => [...html().querySelectorAll('.drag-grip')];
    const titles = () =>
      [...html().querySelectorAll('.card__title')].map((title) => title.textContent?.trim());

    /** Renders a shelf and puts the author into edit mode on it. */
    async function editing(section: Section) {
      await shelf(section);

      const auth = TestBed.inject(AuthService);
      auth.login({ username: 'u', password: 'p', authKey: 'k' }).subscribe();
      http
        .expectOne((request) => request.url.endsWith('/login'))
        .flush({ accessToken: 'a.b.c', admin: { displayName: 'K' } });
      auth.editMode.set(true);
      await fixture.whenStable();
    }

    /** The drop the CDK would report, without driving a pointer across the grid. */
    async function drag(group: number, from: number, to: number) {
      const shelfComponent = fixture.componentInstance as unknown as {
        groups: () => { key: string; works: Work[] }[];
        dropWork: (group: unknown, event: unknown) => void;
      };

      shelfComponent.dropWork(shelfComponent.groups()[group], {
        previousIndex: from,
        currentIndex: to,
      });
      await fixture.whenStable();
    }

    it('gives the author a grip on every card', async () => {
      await editing('poems');
      expect(grips()).toHaveLength(3);
    });

    it('gives a reader none', async () => {
      await shelf('poems');
      expect(grips()).toHaveLength(0);
    });

    it('leaves the uploaded shelves alone, where the order already means something', async () => {
      await editing('novels');
      expect(grips()).toHaveLength(0);
    });

    it('shows the new order at once and writes it behind', async () => {
      await editing('poems');
      await drag(0, 0, 1);

      expect(titles()).toEqual(['rain-two', 'rain-one', 'other-one']);

      const written = http.expectOne(`${API}/works/reorder`);
      expect(written.request.body).toEqual({ ids: ['rain-two', 'rain-one'] });
      written.flush({ ordered: 2 });
    });

    it('moves only the sub-section that was dragged in', async () => {
      await editing('poems');
      await drag(0, 0, 1);

      http.expectOne(`${API}/works/reorder`).flush({ ordered: 2 });
      expect(titles()[2]).toBe('other-one');
    });

    it('puts the shelf back and says so when the order will not save', async () => {
      await editing('poems');
      await drag(0, 0, 1);

      http
        .expectOne(`${API}/works/reorder`)
        .flush({ error: 'no' }, { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();

      expect(titles()).toEqual(['rain-one', 'rain-two', 'other-one']);
      expect(html().querySelector('.notice--warn')?.textContent).toContain('not saved');
    });
  });

  describe('for the author', () => {
    it('opens the sub-section it is adding to, so the composer is not hidden', async () => {
      await shelf('poems', { narrow: true, works, collections });

      const auth = TestBed.inject(AuthService);
      auth.login({ username: 'u', password: 'p', authKey: 'k' }).subscribe();
      http
        .expectOne((request) => request.url.endsWith('/login'))
        .flush({
          accessToken: 'a.b.c',
          admin: { displayName: 'K' },
        });
      auth.editMode.set(true);
      await fixture.whenStable();

      html().querySelector<HTMLButtonElement>('.group__add')?.click();
      await fixture.whenStable();

      expect(openPanels()).toHaveLength(1);
      expect(html().querySelector('.new-work')).not.toBeNull();
    });
  });
});
