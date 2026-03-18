import * as fs from 'fs-extra';
import * as path from 'path';
import { Injectable } from '@angular/core';
import { TrackRepositoryBase } from '../../data/repositories/track-repository.base';
import { Track } from '../../data/entities/track';
import { TrackModel } from '../track/track-model';
import { TrackModelFactory } from '../track/track-model-factory';
import { SettingsBase } from '../../common/settings/settings.base';
import { DuplicateGroup } from './duplicate-group';
import { FileAccessBase } from '../../common/io/file-access.base';
import { Logger } from '../../common/logger';

@Injectable()
export class DuplicateDetectionService {
    private static readonly durationToleranceMs: number = 2000;

    public constructor(
        private trackRepository: TrackRepositoryBase,
        private trackModelFactory: TrackModelFactory,
        private settings: SettingsBase,
        private fileAccess: FileAccessBase,
        private logger: Logger,
    ) {}

    public detectDuplicates(): DuplicateGroup[] {
        const tracks: Track[] | undefined = this.trackRepository.getVisibleTracks();

        if (!tracks || tracks.length === 0) {
            return [];
        }

        // Remove stale DB entries whose stored path doesn't match the real
        // on-disk casing. On Windows, fs.existsSync is case-insensitive, so
        // "D:\MUSIC\Asteria\file.flac" resolves even when the folder is now
        // "asteria". We use fs.realpathSync.native to get the true casing and
        // delete entries that no longer match.
        const staleTracks: Track[] = [];
        const liveTracks: Track[] = [];

        for (const t of tracks) {
            if (this.isStaleTrack(t)) {
                staleTracks.push(t);
            } else {
                liveTracks.push(t);
            }
        }

        if (staleTracks.length > 0) {
            this.logger.info(
                `Removing ${staleTracks.length} stale track(s) with missing or case-mismatched paths from database`,
                'DuplicateDetectionService',
                'detectDuplicates',
            );
            this.trackRepository.deleteTracks(staleTracks.map((t) => t.trackId));
        }

        const trackModels: TrackModel[] = liveTracks.map((t) => this.trackModelFactory.createFromTrack(t, this.settings.albumKeyIndex));

        // Group by normalized title + artists, then split by duration tolerance
        const roughGroups = new Map<string, TrackModel[]>();

        for (const track of trackModels) {
            const key = this.createGroupKey(track);
            if (!roughGroups.has(key)) {
                roughGroups.set(key, []);
            }
            roughGroups.get(key)!.push(track);
        }

        const duplicateGroups: DuplicateGroup[] = [];

        for (const [, groupTracks] of roughGroups) {
            if (groupTracks.length < 2) {
                continue;
            }

            // Further group by duration with tolerance
            const durationGroups = this.groupByDurationTolerance(groupTracks);

            for (const dGroup of durationGroups) {
                if (dGroup.length >= 2) {
                    duplicateGroups.push(new DuplicateGroup(dGroup[0].title, dGroup[0].artists, dGroup));
                }
            }
        }

        return duplicateGroups;
    }

    private createGroupKey(track: TrackModel): string {
        const title = (track.rawTitle || track.fileName).toLowerCase().trim();
        const artists = track.artists.toLowerCase().trim();
        return `${title}|||${artists}`;
    }

    /**
     * A track is stale if its file is gone, or if the stored path differs from
     * the real on-disk path (e.g. a parent folder was renamed with a case change).
     */
    private isStaleTrack(track: Track): boolean {
        if (!this.fileAccess.pathExists(track.path)) {
            return true;
        }

        try {
            // fs.realpathSync.native returns the true on-disk casing on Windows
            const realPath = fs.realpathSync.native(track.path);
            // Normalize both to the same separator style before comparing
            const normalizedStored = path.normalize(track.path);
            const normalizedReal = path.normalize(realPath);
            return normalizedStored !== normalizedReal;
        } catch {
            return true;
        }
    }

    private groupByDurationTolerance(tracks: TrackModel[]): TrackModel[][] {
        const sorted = [...tracks].sort((a, b) => a.durationInMilliseconds - b.durationInMilliseconds);
        const groups: TrackModel[][] = [];
        let currentGroup: TrackModel[] = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            const diff = Math.abs(sorted[i].durationInMilliseconds - sorted[i - 1].durationInMilliseconds);
            if (diff <= DuplicateDetectionService.durationToleranceMs) {
                currentGroup.push(sorted[i]);
            } else {
                groups.push(currentGroup);
                currentGroup = [sorted[i]];
            }
        }

        groups.push(currentGroup);
        return groups;
    }
}
