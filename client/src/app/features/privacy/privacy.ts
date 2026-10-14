import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * What the site keeps, in plain words. Also what Google's OAuth consent screen links
 * to: publishing the Gmail sender requires a privacy policy on the site's own domain,
 * and it has to say how the Google data is used — hence the section on email.
 *
 * Keep this true. If something new is stored, it gets a line here.
 */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink],
  templateUrl: './privacy.html',
  styleUrl: './privacy.scss',
})
export class PrivacyComponent {
  protected readonly updated = '14 October 2026';
  protected readonly contact = 'beastnova904@gmail.com';
}
