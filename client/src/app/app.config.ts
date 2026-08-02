import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { AuthService } from './core/auth.service';
import { ThemeService } from './core/theme.service';
import { SessionGuardService } from './core/session-guard.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    provideRouter(
      routes,
      // Cross-fades between pages using the platform's own transition primitive,
      // which degrades to an instant swap where it is unsupported.
      withViewTransitions({ skipInitialTransition: true }),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),

    provideHttpClient(withInterceptors([authInterceptor])),

    /**
     * Resolve the theme and any existing admin session before the first render, so
     * the page never flashes light-then-dark or reader-then-author.
     */
    provideAppInitializer(async () => {
      inject(ThemeService);
      // Instantiated here so it starts watching as soon as a session exists.
      inject(SessionGuardService);
      await firstValueFrom(inject(AuthService).restoreSession());
    }),
  ],
};
