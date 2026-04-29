/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Logger } from '../../common/logger';
import { SettingsBase } from '../../common/settings/settings.base';
import { MusicBrainzApi } from '../../common/api/musicbrainz/musicbrainz.api';
import { ReleaseCalendarRepositoryBase } from '../../data/repositories/release-calendar-repository.base';
import { MbArtist, MbArtistResolutionStatus, MbArtistSyncStatus } from '../../data/entities/mb-artist';
import { ReleaseGroup } from '../../data/entities/release-group';
import { FollowedArtistsService } from './followed-artists.service';
import { ReleaseDateUtils } from './release-date-utils';
import { ReleaseCoverCache } from './release-cover-cache';
import { MbArtistCandidate } from '../../common/api/musicbrainz/musicbrainz-types';

export interface ReleaseCalendarEntry {
    mbid: string;
    artistMbid: string;
    artistName: string;
    title: string;
    primaryType?: string;
    secondaryTypes: string[];
    firstReleaseDate?: string;
    releaseDateValue: number;
    isUpcoming: boolean;
    isToday: boolean;
    daysFromToday: number;
    coverImageUrl?: string;
    coverArtHint: boolean;
    coverArtChecked: boolean;
    isSelected: boolean;
}

export interface ReleaseSyncProgress {
    isRunning: boolean;
    phase: 'idle' | 'syncing';
    processed: number;
    total: number;
    artistName?: string;
}

export interface FollowedArtistDetail {
    name: string;
    nameKey: string;
    mbid?: string;
    mbName?: string;
    mbDisambiguation?: string;
    mbType?: string;
    mbCountry?: string;
    resolutionStatus: number;
    lastSyncedAt: number;
    syncStatus: number;
}

@Injectable({ providedIn: 'root' })
export class ReleaseCalendarService {
    private syncing: boolean = false;
    private cancelRequested: boolean = false;

    private progressSubject: Subject<ReleaseSyncProgress> = new Subject<ReleaseSyncProgress>();
    public progress$: Observable<ReleaseSyncProgress> = this.progressSubject.asObservable();

    private updatedSubject: Subject<void> = new Subject<void>();
    public updated$: Observable<void> = this.updatedSubject.asObservable();

    public constructor(
        private repository: ReleaseCalendarRepositoryBase,
        private musicBrainzApi: MusicBrainzApi,
        private followedArtistsService: FollowedArtistsService,
        private coverCache: ReleaseCoverCache,
        private settings: SettingsBase,
        private logger: Logger,
    ) {}

    public get isSyncing(): boolean {
        return this.syncing;
    }

    public requestCancel(): void {
        this.cancelRequested = true;
    }

    public getEntries(): ReleaseCalendarEntry[] {
        const followed = this.followedArtistsService.getFollowedArtists();
        if (followed.length === 0) {
            return [];
        }

        const followedKeys = new Set(followed.map((f) => f.nameKey));

        const allMbArtists = this.repository.getAllMbArtists();
        const resolvedForFollowed = allMbArtists.filter(
            (a) =>
                followedKeys.has(a.nameKey) &&
                a.resolutionStatus === MbArtistResolutionStatus.resolved &&
                a.mbid != undefined &&
                a.mbid.length > 0,
        );
        const mbidToName = new Map<string, string>();
        for (const a of resolvedForFollowed) {
            if (a.mbid != undefined && a.mbid.length > 0) {
                mbidToName.set(a.mbid, a.name);
            }
        }

        const mbids = Array.from(mbidToName.keys());
        if (mbids.length === 0) {
            return [];
        }

        const groups = this.repository.getReleaseGroupsForArtists(mbids);
        const lookbackCutoff = ReleaseDateUtils.daysFromTodaySortValue(-this.settings.releaseCalendarLookbackDays);
        const lookaheadCutoff = ReleaseDateUtils.daysFromTodaySortValue(this.settings.releaseCalendarLookaheadDays);
        const todayValue = ReleaseDateUtils.todaySortValue();

        const filtered = groups.filter((g) => {
            if (g.releaseDateValue === 0) {
                return false;
            }
            return g.releaseDateValue >= lookbackCutoff && g.releaseDateValue <= lookaheadCutoff;
        });

        return filtered
            .map((g) => {
                const localPath =
                    g.localCoverPath != undefined && g.localCoverPath.length > 0 ? g.localCoverPath : undefined;
                const isUpcoming = g.releaseDateValue > todayValue;
                const isToday = g.releaseDateValue === todayValue;
                const daysFromToday = this.daysBetween(todayValue, g.releaseDateValue);
                return {
                    mbid: g.mbid,
                    artistMbid: g.artistMbid,
                    artistName: g.artistName,
                    title: g.title,
                    primaryType: g.primaryType,
                    secondaryTypes: this.splitSecondaryTypes(g.secondaryTypes),
                    firstReleaseDate: g.firstReleaseDate,
                    releaseDateValue: g.releaseDateValue,
                    isUpcoming,
                    isToday,
                    daysFromToday,
                    coverImageUrl: localPath,
                    coverArtHint: g.hasCoverArt === 1,
                    coverArtChecked: g.coverArtCheckedAt > 0,
                    isSelected: false,
                };
            })
            .sort((a, b) => b.releaseDateValue - a.releaseDateValue);
    }

    public bindArtistToMbid(name: string, nameKey: string, candidate: MbArtistCandidate): void {
        this.repository.upsertMbArtist(name, nameKey);
        this.repository.setMbArtistResolutionWithInfo(
            nameKey,
            candidate.mbid,
            {
                mbName: candidate.name,
                mbDisambiguation: candidate.disambiguation,
                mbType: candidate.type,
                mbCountry: candidate.country,
            },
            Date.now(),
        );
        this.repository.resetMbArtistSyncForRebind(nameKey);
        this.repository.deleteReleaseGroupsForArtist(candidate.mbid);
    }

    public getFollowedDetails(): FollowedArtistDetail[] {
        const followed = this.followedArtistsService.getFollowedArtists();
        const allMb = this.repository.getAllMbArtists();
        const byKey = new Map<string, MbArtist>();
        for (const m of allMb) {
            byKey.set(m.nameKey, m);
        }
        return followed.map((f) => {
            const m = byKey.get(f.nameKey);
            return {
                name: f.name,
                nameKey: f.nameKey,
                mbid: m?.mbid,
                mbName: m?.mbName,
                mbDisambiguation: m?.mbDisambiguation,
                mbType: m?.mbType,
                mbCountry: m?.mbCountry,
                resolutionStatus: m?.resolutionStatus ?? MbArtistResolutionStatus.unresolved,
                lastSyncedAt: m?.lastSyncedAt ?? 0,
                syncStatus: m?.syncStatus ?? MbArtistSyncStatus.idle,
            };
        });
    }

    public async syncFollowedArtistsAsync(force: boolean = false): Promise<void> {
        if (this.syncing) {
            return;
        }
        this.syncing = true;
        this.cancelRequested = false;

        try {
            const followed = this.followedArtistsService.getFollowedArtists();
            for (const f of followed) {
                this.repository.upsertMbArtist(f.name, f.nameKey);
            }

            const intervalMs = Math.max(1, this.settings.releaseCalendarSyncIntervalHours) * 60 * 60 * 1000;
            const cutoff = Date.now() - intervalMs;

            const resolved = this.repository.getResolvedMbArtists();
            const followedKeys = new Set(followed.map((f) => f.nameKey));
            const stale = resolved.filter((a) => followedKeys.has(a.nameKey) && (force || a.lastSyncedAt < cutoff));

            this.emitProgress({
                isRunning: true,
                phase: 'syncing',
                processed: 0,
                total: stale.length,
            });

            let processed = 0;
            for (const artist of stale) {
                if (this.cancelRequested) {
                    break;
                }
                this.emitProgress({
                    isRunning: true,
                    phase: 'syncing',
                    processed: processed,
                    total: stale.length,
                    artistName: artist.name,
                });

                try {
                    if (artist.mbid == undefined || artist.mbid.length === 0) {
                        continue;
                    }
                    const remoteGroups = await this.musicBrainzApi.getReleaseGroupsForArtist(artist.mbid);
                    for (const remote of remoteGroups) {
                        const rg = new ReleaseGroup();
                        rg.mbid = remote.id;
                        rg.artistMbid = artist.mbid;
                        rg.artistName = artist.name;
                        rg.title = remote.title;
                        rg.primaryType = remote.primaryType;
                        rg.secondaryTypes = remote.secondaryTypes.join(';');
                        rg.firstReleaseDate = remote.firstReleaseDate;
                        rg.releaseDateValue = ReleaseDateUtils.toSortValue(remote.firstReleaseDate);
                        rg.hasCoverArt = remote.hasCoverArt ? 1 : 0;
                        rg.coverArtCheckedAt = 0;
                        rg.localCoverPath = undefined;
                        rg.lastSyncedAt = Date.now();
                        rg.hidden = 0;
                        this.repository.upsertReleaseGroup(rg);
                    }
                    this.repository.setMbArtistSyncStatus(artist.nameKey, MbArtistSyncStatus.synced, Date.now(), undefined);
                } catch (e) {
                    this.logger.error(e, `Failed to sync artist ${artist.name}`, 'ReleaseCalendarService', 'syncFollowedArtistsAsync');
                    this.repository.setMbArtistSyncStatus(artist.nameKey, MbArtistSyncStatus.failed, Date.now(), 'sync-failed');
                }

                processed++;
            }

            this.settings.releaseCalendarLastFullSyncAt = Date.now();
            this.updatedSubject.next();
        } finally {
            this.syncing = false;
            this.cancelRequested = false;
            this.emitProgress({ isRunning: false, phase: 'idle', processed: 0, total: 0 });
        }
    }

    public async ensureCoverAsync(mbid: string, artistName?: string, albumTitle?: string): Promise<string | undefined> {
        const result = await this.coverCache.ensureCoverAsync(mbid, artistName, albumTitle);
        if (result.localPath != undefined && result.localPath.length > 0) {
            this.repository.setReleaseGroupCoverArt(mbid, 1, result.localPath, Date.now());
            return result.localPath;
        }
        if (result.notFound) {
            this.repository.setReleaseGroupCoverArt(mbid, 0, undefined, Date.now());
        }
        return undefined;
    }

    public async setManualCoverAsync(mbid: string, imageUrl: string): Promise<string | undefined> {
        const localPath = await this.coverCache.saveExternalCoverAsync(mbid, imageUrl);
        if (localPath != undefined && localPath.length > 0) {
            this.repository.setReleaseGroupCoverArt(mbid, 1, localPath, Date.now());
            this.updatedSubject.next();
            return localPath;
        }
        return undefined;
    }

    public async pickCoverFromMusichoardersAsync(
        entry: ReleaseCalendarEntry,
    ): Promise<string | undefined> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const electron: typeof import('electron') = window.require('electron');
            const result: { bigCoverUrl: string } | undefined = await electron.ipcRenderer.invoke(
                'release-calendar:pick-cover',
                { artist: entry.artistName, album: entry.title },
            );
            if (result == undefined || result.bigCoverUrl.length === 0) {
                return undefined;
            }
            return await this.setManualCoverAsync(entry.mbid, result.bigCoverUrl);
        } catch (e) {
            this.logger.error(e, 'Failed to pick cover from musichoarders', 'ReleaseCalendarService', 'pickCoverFromMusichoardersAsync');
            return undefined;
        }
    }

    public async resolveCoversForVisibleEntriesAsync(entries: ReleaseCalendarEntry[]): Promise<void> {
        const candidates = entries.filter(
            (e) => (e.coverImageUrl == undefined || e.coverImageUrl.length === 0) && !e.coverArtChecked,
        );
        for (const entry of candidates) {
            try {
                const url = await this.ensureCoverAsync(entry.mbid, entry.artistName, entry.title);
                if (url != undefined && url.length > 0) {
                    entry.coverImageUrl = url;
                    entry.coverArtChecked = true;
                } else {
                    entry.coverArtChecked = true;
                }
            } catch (e) {
                this.logger.error(
                    e,
                    `Failed to ensure cover for ${entry.mbid}`,
                    'ReleaseCalendarService',
                    'resolveCoversForVisibleEntriesAsync',
                );
            }
        }
    }

    public hideRelease(mbid: string): void {
        this.repository.setReleaseGroupHidden(mbid, true);
        this.updatedSubject.next();
    }

    public unhideRelease(mbid: string): void {
        this.repository.setReleaseGroupHidden(mbid, false);
        this.updatedSubject.next();
    }

    private emitProgress(p: ReleaseSyncProgress): void {
        this.progressSubject.next(p);
    }

    private splitSecondaryTypes(serialized: string | undefined): string[] {
        if (serialized == undefined || serialized.length === 0) {
            return [];
        }
        return serialized.split(';').filter((s) => s.length > 0);
    }

    private daysBetween(from: number, to: number): number {
        const fromDate = this.fromSortValue(from);
        const toDate = this.fromSortValue(to);
        if (fromDate == undefined || toDate == undefined) {
            return 0;
        }
        const ms = toDate.getTime() - fromDate.getTime();
        return Math.round(ms / (1000 * 60 * 60 * 24));
    }

    private fromSortValue(value: number): Date | undefined {
        if (value === 0) {
            return undefined;
        }
        const year = Math.floor(value / 10000);
        const month = Math.floor((value % 10000) / 100);
        const day = value % 100;
        return new Date(Date.UTC(year, month - 1, day));
    }
}
