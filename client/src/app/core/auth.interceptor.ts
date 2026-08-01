import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { ReactorService } from './reactor.service';

/**
 * Attaches the two pieces of identity this app uses — the author's bearer token and
 * the visitor's anonymous reactor id — and transparently retries once when the
 * access token has expired but the refresh cookie is still good.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const reactor = inject(ReactorService);

  // The auth endpoints manage their own credentials; adding a stale bearer token
  // to a refresh call would be meaningless and could mask a real failure.
  const isAuthCall = request.url.startsWith(
    `${environment.apiBase}/${environment.adminPortalPath}/auth`,
  );

  const authorized = decorate(request);

  return next(authorized).pipe(
    catchError((error: unknown) => {
      const expired =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        error.error?.code === 'TOKEN_EXPIRED';

      if (!expired || isAuthCall) return throwError(() => error);

      return auth.refresh().pipe(
        switchMap((renewed) =>
          renewed ? next(decorate(request)) : throwError(() => error),
        ),
      );
    }),
  );

  function decorate(original: typeof request) {
    const headers: Record<string, string> = { 'X-Reactor-Id': reactor.id };

    const token = auth.token();
    if (token && !isAuthCall) headers['Authorization'] = `Bearer ${token}`;

    return original.clone({ setHeaders: headers });
  }
};
