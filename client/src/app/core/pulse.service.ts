import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type PulseRange = 'today' | '7d' | '30d' | 'all';

export interface LiveReader {
  id: string;
  /** A few characters of the reader's random id — enough to tell two apart. */
  reader: string;
  title: string;
  path: string;
  place: string;
  page: number | null;
  pages: number | null;
  from: string;
  seconds: number;
}

export interface PulsePlace {
  key: string;
  label: string;
  count: number;
}

export interface PulseTotals {
  views: number;
  readers: number;
  today: number;
  allTime: number;
  /** Sessions that began inside the range, and how many of those Instagram sent. */
  arrivals: number;
  instagram: number;
}

export interface PulseWork {
  path: string;
  title: string;
  place: string;
  views: number;
  readers: number;
  staySeconds: number;
  allTime: number;
}

export interface PulseLink {
  /** Null for the "untagged" row, which is a tally rather than a link. */
  id: string | null;
  tag: string;
  label: string;
  path: string;
  opens: number;
  lastOpenedAt: string | null;
}

export interface Pulse {
  range: PulseRange;
  checkedAt: string;
  live: LiveReader[];
  places: PulsePlace[];
  totals: PulseTotals;
  days: { day: string; views: number }[];
  top: PulseWork[];
  links: PulseLink[];
}

/** The author's read on who is here. Every call 404s for anyone else. */
@Injectable({ providedIn: 'root' })
export class PulseService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBase}/${environment.adminPortalPath}/pulse`;

  /** The timezone goes along so "today" is the author's day, not the server's. */
  load(range: PulseRange): Observable<Pulse> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return this.http.get<Pulse>(this.base, { params: { range, tz } });
  }

  createLink(label: string, path: string): Observable<PulseLink> {
    return this.http.post<PulseLink>(`${this.base}/links`, { label, path });
  }

  removeLink(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/links/${id}`);
  }
}
