import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

/**
 * The author's entrance. Reached only by typing the configured portal path — it is
 * never linked from the site, and the server answers any other path with a 404.
 *
 * All three factors are required. The form deliberately gives no indication of
 * which one was wrong, mirroring the server's uniform rejection.
 */
@Component({
  selector: 'app-portal',
  imports: [FormsModule],
  templateUrl: './portal.html',
  styleUrl: './portal.scss',
})
export class PortalComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly authKey = signal('');

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly alreadyIn = this.auth.isAdmin;

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.submitting()) return;

    this.submitting.set(true);
    this.error.set(null);

    this.auth
      .login({
        username: this.username(),
        password: this.password(),
        authKey: this.authKey(),
      })
      .subscribe({
        next: () => {
          // Land in preview, seeing the site as a reader does. Editing is entered
          // deliberately from the author bar rather than assumed.
          this.auth.editMode.set(false);
          this.router.navigate(['/']);
        },
        error: (response) => {
          this.error.set(
            response?.status === 429
              ? 'Too many attempts. Try again in a few minutes.'
              : 'Those credentials were not accepted.',
          );
          this.password.set('');
          this.authKey.set('');
          this.submitting.set(false);
        },
      });
  }
}
