import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import * as path from 'path';
import { Logger } from '../../common/logger';
import { SettingsBase } from '../../common/settings/settings.base';
import { FileAccessBase } from '../../common/io/file-access.base';
import { DesktopBase } from '../../common/io/desktop.base';
import { TrackRepositoryBase } from '../../data/repositories/track-repository.base';
import { Track } from '../../data/entities/track';
import { DataDelimiter } from '../../data/data-delimiter';
import { StringUtils } from '../../common/utils/string-utils';
import { LrcLibApi } from '../../common/api/lyrics/lrc-lib.api';
import { LrcLibMatch, LrcLibMatcher } from './lrc-lib-matcher';
import { IndexingService } from '../indexing/indexing.service';
import { EmbeddedLyricsWriter } from './embedded-lyrics-writer';

type AttemptStatus =
    | 'baseline'
    | 'tagged'
    | 'not_found'
    | 'instrumental'
    | 'plain_skipped'
    | 'parse_error'
    | 'write_error'
    | 'api_error'
    | 'no_metadata';

interface LrcLibAttempt {
    path: string;
    triedAt: number;
    status: AttemptStatus;
    strategy?: string;
    lrclibId?: number;
    error?: string;
}

interface LrcLibManifest {
    version: number;
    attempts: { [path: string]: LrcLibAttempt };
}

@Injectable()
export class LrcLibBackgroundFetcher implements OnDestroy {
    private static readonly throttleMs: number = 250;
    private static readonly baselineDelayMs: number = 4000;

    private subscription: Subscription = new Subscription();
    private isRunning: boolean = false;
    private cancelRequested: boolean = false;
    private baselineEstablished: boolean = false;
    private baselineTimer: ReturnType<typeof setTimeout> | undefined;

    private trackTaggedSubject: Subject<string> = new Subject<string>();
    public trackTagged$: Observable<string> = this.trackTaggedSubject.asObservable();

    private progressSubject: Subject<{ processed: number; total: number; tagged: number }> = new Subject();
    public progress$ = this.progressSubject.asObservable();

    public constructor(
        private indexingService: IndexingService,
        private trackRepository: TrackRepositoryBase,
        private fileAccess: FileAccessBase,
        private desktop: DesktopBase,
        private api: LrcLibApi,
        private writer: EmbeddedLyricsWriter,
        private settings: SettingsBase,
        private logger: Logger,
    ) {}

    public initialize(): void {
        this.baselineTimer = setTimeout(() => {
            this.baselineTimer = undefined;
            this.establishBaselineIfNeeded();
        }, LrcLibBackgroundFetcher.baselineDelayMs);

        this.subscription.add(
            this.indexingService.indexingFinished$.subscribe(() => {
                if (!this.settings.downloadLyricsOnline) {
                    return;
                }

                void this.runAsync();
            }),
        );
    }

    public ngOnDestroy(): void {
        this.cancelRequested = true;
        if (this.baselineTimer != undefined) {
            clearTimeout(this.baselineTimer);
            this.baselineTimer = undefined;
        }
        this.subscription.unsubscribe();
    }

    public async runAsync(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        this.cancelRequested = false;

        try {
            const manifest: LrcLibManifest = this.loadManifestOrUndefined() ?? this.createBaselineManifest();
            const allTracks: Track[] = this.trackRepository.getVisibleTracks() ?? [];
            const candidates: Track[] = allTracks.filter((t) => this.shouldFetch(t, manifest));

            if (candidates.length === 0) {
                this.logger.info('No new tracks need lyrics from LRCLIB', 'LrcLibBackgroundFetcher', 'runAsync');
                this.saveManifest(manifest);
                return;
            }

            this.logger.info(
                `Fetching lyrics from LRCLIB for ${candidates.length} new track(s)`,
                'LrcLibBackgroundFetcher',
                'runAsync',
            );

            const matcher: LrcLibMatcher = new LrcLibMatcher(this.api);
            let tagged: number = 0;
            let saveCounter: number = 0;

            for (let i = 0; i < candidates.length; i++) {
                if (this.cancelRequested) {
                    break;
                }

                const track: Track = candidates[i];
                const attempt: LrcLibAttempt = await this.processTrackAsync(track, matcher);
                manifest.attempts[track.path] = attempt;

                if (attempt.status === 'tagged') {
                    tagged++;
                    this.trackTaggedSubject.next(track.path);
                }

                this.progressSubject.next({ processed: i + 1, total: candidates.length, tagged });

                saveCounter++;
                if (saveCounter % 10 === 0 || i + 1 === candidates.length) {
                    this.saveManifest(manifest);
                }

                await this.delay(LrcLibBackgroundFetcher.throttleMs);
            }

            this.saveManifest(manifest);

            this.logger.info(
                `LRCLIB lookup finished: tagged ${tagged} of ${candidates.length}`,
                'LrcLibBackgroundFetcher',
                'runAsync',
            );
        } catch (e: unknown) {
            this.logger.error(e, 'LRCLIB background fetch failed', 'LrcLibBackgroundFetcher', 'runAsync');
        } finally {
            this.isRunning = false;
        }
    }

    private establishBaselineIfNeeded(): void {
        if (this.baselineEstablished) {
            return;
        }

        const existing: LrcLibManifest | undefined = this.loadManifestOrUndefined();

        if (existing != undefined) {
            this.baselineEstablished = true;
            return;
        }

        const manifest: LrcLibManifest = this.createBaselineManifest();
        this.saveManifest(manifest);
        this.baselineEstablished = true;

        const count: number = Object.keys(manifest.attempts).length;
        this.logger.info(
            `Baselined ${count} pre-existing track(s); only newly added tracks will be looked up on LRCLIB`,
            'LrcLibBackgroundFetcher',
            'establishBaselineIfNeeded',
        );
    }

    private createBaselineManifest(): LrcLibManifest {
        const manifest: LrcLibManifest = { version: 1, attempts: {} };
        const allTracks: Track[] = this.trackRepository.getVisibleTracks() ?? [];
        const now: number = Date.now();

        for (const track of allTracks) {
            if (!track.path) continue;

            manifest.attempts[track.path] = {
                path: track.path,
                triedAt: now,
                status: 'baseline',
            };
        }

        return manifest;
    }

    private shouldFetch(track: Track, manifest: LrcLibManifest): boolean {
        if (!track.path) {
            return false;
        }

        if (track.hasLyrics === 1) {
            return false;
        }

        if (manifest.attempts[track.path] != undefined) {
            return false;
        }

        const artist: string = this.firstArtist(track);
        const title: string = (track.trackTitle ?? '').trim();

        return !StringUtils.isNullOrWhiteSpace(artist) && !StringUtils.isNullOrWhiteSpace(title);
    }

    private async processTrackAsync(track: Track, matcher: LrcLibMatcher): Promise<LrcLibAttempt> {
        const artist: string = this.firstArtist(track);
        const title: string = (track.trackTitle ?? '').trim();
        const album: string = (track.albumTitle ?? '').trim();
        const durationSeconds: number = Math.max(0, (track.duration ?? 0) / 1000);

        if (!artist || !title || durationSeconds <= 0) {
            return { path: track.path, triedAt: Date.now(), status: 'no_metadata' };
        }

        let match: LrcLibMatch | undefined;

        try {
            match = await matcher.findMatchAsync({ artist, title, album, durationSeconds });
        } catch (e: unknown) {
            return { path: track.path, triedAt: Date.now(), status: 'api_error', error: this.errorMessage(e) };
        }

        if (match == undefined) {
            return { path: track.path, triedAt: Date.now(), status: 'not_found' };
        }

        if (match.hit.instrumental) {
            return {
                path: track.path,
                triedAt: Date.now(),
                status: 'instrumental',
                strategy: match.strategy,
                lrclibId: match.hit.id,
            };
        }

        const lyricsToWrite: string | undefined = match.hit.synced ?? match.hit.plain;

        if (!lyricsToWrite) {
            return {
                path: track.path,
                triedAt: Date.now(),
                status: 'plain_skipped',
                strategy: match.strategy,
                lrclibId: match.hit.id,
            };
        }

        try {
            this.writer.write(track.path, lyricsToWrite);
            track.hasLyrics = 1;
            this.trackRepository.updateTrack(track);
        } catch (e: unknown) {
            return {
                path: track.path,
                triedAt: Date.now(),
                status: 'write_error',
                strategy: match.strategy,
                lrclibId: match.hit.id,
                error: this.errorMessage(e),
            };
        }

        this.logger.info(
            `Embedded ${match.hit.synced ? 'synced' : 'plain'} lyrics for ${artist} - ${title} (lrclib id ${match.hit.id}, ${match.strategy})`,
            'LrcLibBackgroundFetcher',
            'processTrackAsync',
        );

        return {
            path: track.path,
            triedAt: Date.now(),
            status: 'tagged',
            strategy: match.strategy,
            lrclibId: match.hit.id,
        };
    }

    private firstArtist(track: Track): string {
        const artists: string[] = DataDelimiter.fromDelimitedString(track.artists);

        if (DataDelimiter.isUnknownValue(artists)) {
            return '';
        }

        const nonEmpty: string[] = artists.filter((a) => !StringUtils.isNullOrWhiteSpace(a));

        return nonEmpty.length > 0 ? nonEmpty[0].trim() : '';
    }

    private manifestPath(): string {
        return path.join(this.desktop.getApplicationDataDirectory(), 'lrclib-attempts.json');
    }

    private loadManifestOrUndefined(): LrcLibManifest | undefined {
        const file: string = this.manifestPath();

        if (!this.fileAccess.pathExists(file)) {
            return undefined;
        }

        try {
            const text: string = this.fileAccess.getFileContentAsString(file);
            const data: unknown = JSON.parse(text);

            if (typeof data === 'object' && data != null && 'attempts' in (data as object)) {
                const attempts: { [path: string]: LrcLibAttempt } =
                    ((data as LrcLibManifest).attempts ?? {}) as { [path: string]: LrcLibAttempt };

                return { version: 1, attempts };
            }
        } catch (e: unknown) {
            this.logger.warn(
                `Could not read LRCLIB manifest, treating as missing: ${this.errorMessage(e)}`,
                'LrcLibBackgroundFetcher',
                'loadManifestOrUndefined',
            );
        }

        return undefined;
    }

    private saveManifest(manifest: LrcLibManifest): void {
        try {
            this.fileAccess.writeToFile(this.manifestPath(), JSON.stringify(manifest, null, 2));
        } catch (e: unknown) {
            this.logger.warn(
                `Could not save LRCLIB manifest: ${this.errorMessage(e)}`,
                'LrcLibBackgroundFetcher',
                'saveManifest',
            );
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private errorMessage(e: unknown): string {
        if (e instanceof Error) return e.message;
        return String(e);
    }
}
