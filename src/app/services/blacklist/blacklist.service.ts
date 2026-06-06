import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Logger } from '../../common/logger';
import { ReleaseCalendarRepositoryBase } from '../../data/repositories/release-calendar-repository.base';
import { ReleaseNameKey } from '../release-calendar/release-name-key';
import { TrackModel } from '../track/track-model';
import { TrackModels } from '../track/track-models';
import { TrackServiceBase } from '../track/track.service.base';

export interface BlacklistedArtistEntry {
    name: string;
    nameKey: string;
}

@Injectable({ providedIn: 'root' })
export class BlacklistService {
    private blacklistedArtistKeys: Set<string> = new Set<string>();
    private blacklistedTrackPaths: Set<string> = new Set<string>();
    private cachesLoaded: boolean = false;

    private blacklistChanged: Subject<void> = new Subject<void>();
    public blacklistChanged$: Observable<void> = this.blacklistChanged.asObservable();

    public constructor(
        private repository: ReleaseCalendarRepositoryBase,
        private trackService: TrackServiceBase,
        private logger: Logger,
    ) {}

    // Loaded lazily (on first use) rather than in the constructor, so it always runs after the database has been migrated.
    private ensureCachesLoaded(): void {
        if (this.cachesLoaded) {
            return;
        }

        this.cachesLoaded = true;

        try {
            this.blacklistedArtistKeys = new Set<string>(
                this.repository
                    .getAllArtistBlacklistOverrides()
                    .filter((b) => b.isBlacklisted === 1)
                    .map((b) => b.nameKey),
            );

            this.blacklistedTrackPaths = new Set<string>(this.trackService.getBlacklistedTracks().tracks.map((t) => t.path));
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load blacklist', 'BlacklistService', 'ensureCachesLoaded');
            this.blacklistedArtistKeys = new Set<string>();
            this.blacklistedTrackPaths = new Set<string>();
        }
    }

    public isBlacklisted(track: TrackModel | undefined): boolean {
        if (track == undefined) {
            return false;
        }

        if (track.isBlacklisted) {
            return true;
        }

        this.ensureCachesLoaded();

        if (this.blacklistedTrackPaths.has(track.path)) {
            return true;
        }

        // Primary artist only: block when the track's main artist is blacklisted.
        return this.blacklistedArtistKeys.has(ReleaseNameKey.fromArtistName(track.rawFirstArtist));
    }

    public filterOutBlacklisted(tracks: TrackModel[]): TrackModel[] {
        if (tracks == undefined) {
            return [];
        }

        return tracks.filter((t) => !this.isBlacklisted(t));
    }

    // Artists

    public isArtistBlacklisted(name: string): boolean {
        this.ensureCachesLoaded();

        return this.blacklistedArtistKeys.has(ReleaseNameKey.fromArtistName(name));
    }

    public getBlacklistedArtists(): BlacklistedArtistEntry[] {
        return this.repository
            .getAllArtistBlacklistOverrides()
            .filter((b) => b.isBlacklisted === 1)
            .map((b) => ({ name: b.name, nameKey: b.nameKey }));
    }

    public blacklistArtist(name: string): void {
        const key = ReleaseNameKey.fromArtistName(name);

        if (key.length === 0) {
            return;
        }

        this.ensureCachesLoaded();
        this.repository.setArtistBlacklisted(name, key, true, Date.now());
        this.blacklistedArtistKeys.add(key);
        this.logger.info(`Blacklisted artist '${name}'`, 'BlacklistService', 'blacklistArtist');
        this.blacklistChanged.next();
    }

    public unblacklistArtist(name: string): void {
        const key = ReleaseNameKey.fromArtistName(name);

        if (key.length === 0) {
            return;
        }

        this.ensureCachesLoaded();
        this.repository.setArtistBlacklisted(name, key, false, Date.now());
        this.blacklistedArtistKeys.delete(key);
        this.logger.info(`Removed artist '${name}' from blacklist`, 'BlacklistService', 'unblacklistArtist');
        this.blacklistChanged.next();
    }

    public toggleArtist(name: string): boolean {
        if (this.isArtistBlacklisted(name)) {
            this.unblacklistArtist(name);
            return false;
        }

        this.blacklistArtist(name);
        return true;
    }

    // Tracks

    public getBlacklistedTracks(): TrackModels {
        return this.trackService.getBlacklistedTracks();
    }

    public blacklistTracks(tracks: TrackModel[]): void {
        if (tracks == undefined || tracks.length === 0) {
            return;
        }

        this.ensureCachesLoaded();

        for (const track of tracks) {
            this.trackService.saveTrackBlacklist(track, true);
            this.blacklistedTrackPaths.add(track.path);
        }

        this.logger.info(`Blacklisted ${tracks.length} track(s)`, 'BlacklistService', 'blacklistTracks');
        this.blacklistChanged.next();
    }

    public unblacklistTracks(tracks: TrackModel[]): void {
        if (tracks == undefined || tracks.length === 0) {
            return;
        }

        this.ensureCachesLoaded();

        for (const track of tracks) {
            this.trackService.saveTrackBlacklist(track, false);
            this.blacklistedTrackPaths.delete(track.path);
        }

        this.logger.info(`Removed ${tracks.length} track(s) from blacklist`, 'BlacklistService', 'unblacklistTracks');
        this.blacklistChanged.next();
    }
}
