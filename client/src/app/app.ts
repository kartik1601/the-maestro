import { Component, HostListener, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './core/auth.service';
import { ThemeService } from './core/theme.service';
import { SECTION_META } from './core/models';
import { ModalHostComponent } from './shared/modal/modal-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ModalHostComponent, NgTemplateOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  protected readonly sections = SECTION_META;
  protected readonly menuOpen = signal(false);
  protected readonly scrolled = signal(false);
  protected readonly reactionOpen = signal(false);

  constructor() {
    // Closing on navigation keeps the mobile menu from covering the page it just
    // navigated to, and the equation from following the reader to the next section.
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.menuOpen.set(false);
      this.reactionOpen.set(false);
    });
  }

  /**
   * Opens the panel under the bar — on touch screens only.
   *
   * Where a pointer exists, hover already unfolds the chain inline and the panel would
   * be a second, contradictory way to see the same thing. Read at the moment of the
   * press rather than once at startup, so a window dragged between a laptop screen and
   * a touch display answers for where it is now.
   */
  protected toggleReaction(): void {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    this.reactionOpen.update((open) => !open);
  }

  @HostListener('window:scroll')
  protected onScroll(): void {
    this.scrolled.set(window.scrollY > 8);
  }

  /** Both panels hang off the masthead, and Escape is how a reader dismisses either. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.reactionOpen.set(false);
    this.menuOpen.set(false);
  }

  protected toggleEditMode(): void {
    this.auth.editMode.update((on) => !on);
  }

  protected signOut(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/']));
  }
}
