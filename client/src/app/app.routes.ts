import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { environment } from '../environments/environment';
import { AuthService } from './core/auth.service';

/**
 * Sections split into two shapes:
 *   - upload sections (novels, plays, novelettes) list works and open a PDF reader
 *   - document sections (poems, songs) list works and open an editable document
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home').then((m) => m.HomeComponent),
    title: 'Blogs · the maestro',
  },

  {
    path: 'novels',
    loadComponent: () => import('./features/shelf/shelf').then((m) => m.ShelfComponent),
    data: { section: 'novels' },
    title: 'Novels · the maestro',
  },
  {
    path: 'novels/:slug',
    loadComponent: () => import('./features/reader/reader').then((m) => m.ReaderComponent),
    data: { section: 'novels' },
  },

  {
    path: 'plays',
    loadComponent: () => import('./features/shelf/shelf').then((m) => m.ShelfComponent),
    data: { section: 'plays' },
    title: 'Plays · the maestro',
  },
  {
    path: 'plays/:slug',
    loadComponent: () => import('./features/reader/reader').then((m) => m.ReaderComponent),
    data: { section: 'plays' },
  },

  {
    path: 'novelettes',
    loadComponent: () => import('./features/shelf/shelf').then((m) => m.ShelfComponent),
    data: { section: 'novelettes' },
    title: 'Novelettes · the maestro',
  },
  {
    path: 'novelettes/:slug',
    loadComponent: () => import('./features/reader/reader').then((m) => m.ReaderComponent),
    data: { section: 'novelettes' },
  },

  {
    path: 'poems',
    loadComponent: () => import('./features/shelf/shelf').then((m) => m.ShelfComponent),
    data: { section: 'poems' },
    title: 'Poems · the maestro',
  },
  {
    path: 'poems/:slug',
    loadComponent: () => import('./features/document/document').then((m) => m.DocumentComponent),
    data: { section: 'poems' },
  },

  {
    path: 'songs',
    loadComponent: () => import('./features/shelf/shelf').then((m) => m.ShelfComponent),
    data: { section: 'songs' },
    title: 'Songs · the maestro',
  },
  {
    path: 'songs/:slug',
    loadComponent: () => import('./features/document/document').then((m) => m.DocumentComponent),
    data: { section: 'songs' },
  },

  {
    path: 'about',
    loadComponent: () => import('./features/about/about').then((m) => m.AboutComponent),
    title: 'About the Author · the maestro',
  },

  {
    path: 'privacy',
    loadComponent: () => import('./features/privacy/privacy').then((m) => m.PrivacyComponent),
    title: 'Privacy · the maestro',
  },

  /**
   * The admin entrance. Its path comes from configuration and is never linked to
   * from anywhere in the UI — a visitor who does not know the segment gets the
   * same not-found page as any other unknown URL.
   */
  {
    path: environment.adminPortalPath,
    loadComponent: () => import('./features/portal/portal').then((m) => m.PortalComponent),
    title: 'the maestro',
  },

  /**
   * The author's dashboard. `canMatch` rather than `canActivate`: without a session
   * the route does not match at all, so the URL falls through to the same not-found
   * page as any other and never shows that something is here.
   */
  {
    path: 'pulse',
    canMatch: [() => inject(AuthService).isAdmin()],
    loadComponent: () => import('./features/pulse/pulse').then((m) => m.PulseComponent),
    title: 'Pulse · the maestro',
  },

  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found').then((m) => m.NotFoundComponent),
    title: 'Not found · the maestro',
  },
];
