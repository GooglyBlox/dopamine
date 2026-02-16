import { Injectable } from '@angular/core';
import { TrackRepositoryBase } from '../../data/repositories/track-repository.base';
import { Track } from '../../data/entities/track';
import { TrackModel } from '../track/track-model';
import { TrackModelFactory } from '../track/track-model-factory';
import { SettingsBase } from '../../common/settings/settings.base';
import { DuplicateGroup } from './duplicate-group';

@Injectable()
export class DuplicateDetectionService {
    private static readonly durationToleranceMs: number = 2000;

    public constructor(
        private trackRepository: TrackRepositoryBase,
        private trackModelFactory: TrackModelFactory,
        private settings: SettingsBase,
    ) {}

    public detectDuplicates(): DuplicateGroup[] {
        const tracks: Track[] | undefined = this.trackRepository.getVisibleTracks();

        if (!tracks || tracks.length === 0) {
            return [];
        }

        const trackModels: TrackModel[] = tracks.map((t) => this.trackModelFactory.createFromTrack(t, this.settings.albumKeyIndex));

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
