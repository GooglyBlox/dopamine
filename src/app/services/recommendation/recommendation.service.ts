/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@angular/core';
import { TrackModel } from '../track/track-model';
import { TrackServiceBase } from '../track/track.service.base';
import { PlaybackService } from '../playback/playback.service';
import { Logger } from '../../common/logger';
import { Shuffler } from '../../common/shuffler';

export interface RecommendationLane {
    id: string;
    titleKey: string;
    descriptionKey: string;
    icon: string;
    tracks: TrackModel[];
}

@Injectable({ providedIn: 'root' })
export class RecommendationService {
    public constructor(
        private trackService: TrackServiceBase,
        private playbackService: PlaybackService,
        private shuffler: Shuffler,
        private logger: Logger,
    ) {}

    public generateAllRecommendations(): RecommendationLane[] {
        const allTracks = this.trackService.getVisibleTracks().tracks;
        if (allTracks.length === 0) {
            return [];
        }

        const lanes: RecommendationLane[] = [];
        const now = Date.now();

        const freshFinds = this.getFreshFinds(allTracks);
        if (freshFinds.length > 0) {
            lanes.push({
                id: 'fresh-finds',
                titleKey: 'recommendations-fresh-finds',
                descriptionKey: 'recommendations-fresh-finds-description',
                icon: 'las la-seedling',
                tracks: freshFinds,
            });
        }

        const recentlyPlayedMix = this.getRecentlyPlayedMix(allTracks);
        if (recentlyPlayedMix.length > 0) {
            lanes.push({
                id: 'recently-played-mix',
                titleKey: 'recommendations-recently-played-mix',
                descriptionKey: 'recommendations-recently-played-mix-description',
                icon: 'las la-history',
                tracks: recentlyPlayedMix,
            });
        }

        const deepCuts = this.getDeepCuts(allTracks);
        if (deepCuts.length > 0) {
            lanes.push({
                id: 'deep-cuts',
                titleKey: 'recommendations-deep-cuts',
                descriptionKey: 'recommendations-deep-cuts-description',
                icon: 'las la-gem',
                tracks: deepCuts,
            });
        }

        const rediscover = this.getRediscover(allTracks, now);
        if (rediscover.length > 0) {
            lanes.push({
                id: 'rediscover',
                titleKey: 'recommendations-rediscover',
                descriptionKey: 'recommendations-rediscover-description',
                icon: 'las la-undo-alt',
                tracks: rediscover,
            });
        }

        const lovedAndRated = this.getLovedAndRated(allTracks);
        if (lovedAndRated.length > 0) {
            lanes.push({
                id: 'loved-and-rated',
                titleKey: 'recommendations-loved-and-rated',
                descriptionKey: 'recommendations-loved-and-rated-description',
                icon: 'las la-heart',
                tracks: lovedAndRated,
            });
        }

        const skipFreeZone = this.getSkipFreeZone(allTracks);
        if (skipFreeZone.length > 0) {
            lanes.push({
                id: 'skip-free-zone',
                titleKey: 'recommendations-skip-free-zone',
                descriptionKey: 'recommendations-skip-free-zone-description',
                icon: 'las la-check-circle',
                tracks: skipFreeZone,
            });
        }

        const hiddenGems = this.getHiddenGems(allTracks, now);
        if (hiddenGems.length > 0) {
            lanes.push({
                id: 'hidden-gems',
                titleKey: 'recommendations-hidden-gems',
                descriptionKey: 'recommendations-hidden-gems-description',
                icon: 'las la-star',
                tracks: hiddenGems,
            });
        }

        const genreExplorer = this.getGenreExplorer(allTracks);
        if (genreExplorer.length > 0) {
            lanes.push({
                id: 'genre-explorer',
                titleKey: 'recommendations-genre-explorer',
                descriptionKey: 'recommendations-genre-explorer-description',
                icon: 'las la-compass',
                tracks: genreExplorer,
            });
        }

        const tempoMatch = this.getTempoMatch(allTracks);
        if (tempoMatch.length > 0) {
            lanes.push({
                id: 'tempo-match',
                titleKey: 'recommendations-tempo-match',
                descriptionKey: 'recommendations-tempo-match-description',
                icon: 'las la-tachometer-alt',
                tracks: tempoMatch,
            });
        }

        const artistDna = this.getArtistDna(allTracks);
        if (artistDna.length > 0) {
            lanes.push({
                id: 'artist-dna',
                titleKey: 'recommendations-artist-dna',
                descriptionKey: 'recommendations-artist-dna-description',
                icon: 'las la-dna',
                tracks: artistDna,
            });
        }

        return lanes;
    }

    /**
     * Recently added tracks the user hasn't played yet.
     */
    private getFreshFinds(allTracks: TrackModel[]): TrackModel[] {
        const unplayed = allTracks.filter((t) => t.playCount === 0 && t.dateAdded > 0);
        const sorted = unplayed.sort((a, b) => b.dateAdded - a.dateAdded);
        return sorted.slice(0, 25);
    }

    /**
     * Tracks from artists the user recently listened to, but the tracks themselves are unplayed.
     */
    private getRecentlyPlayedMix(allTracks: TrackModel[]): TrackModel[] {
        const played = allTracks.filter((t) => t.dateLastPlayed > 0);
        const recentlyPlayed = played.sort((a, b) => b.dateLastPlayed - a.dateLastPlayed).slice(0, 50);

        const recentArtists = new Set<string>();
        for (const track of recentlyPlayed) {
            for (const artist of this.getTrackArtistsList(track)) {
                recentArtists.add(artist.toLowerCase());
            }
        }

        const unplayedByRecentArtists = allTracks.filter((t) => {
            if (t.playCount > 0) {
                return false;
            }
            const artists = this.getTrackArtistsList(t);
            return artists.some((a) => recentArtists.has(a.toLowerCase()));
        });

        this.shuffler.shuffle(unplayedByRecentArtists);
        return unplayedByRecentArtists.slice(0, 25);
    }

    /**
     * Lesser-played tracks from the user's most-played artists.
     */
    private getDeepCuts(allTracks: TrackModel[]): TrackModel[] {
        const artistPlayCounts = new Map<string, number>();
        for (const track of allTracks) {
            for (const artist of this.getTrackArtistsList(track)) {
                const key = artist.toLowerCase();
                artistPlayCounts.set(key, (artistPlayCounts.get(key) ?? 0) + track.playCount);
            }
        }

        const topArtists = [...artistPlayCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map((e) => e[0]);

        if (topArtists.length === 0) {
            return [];
        }

        const topArtistSet = new Set(topArtists);
        const deepCuts = allTracks.filter((t) => {
            if (t.playCount > 2) {
                return false;
            }
            const artists = this.getTrackArtistsList(t);
            return artists.some((a) => topArtistSet.has(a.toLowerCase()));
        });

        deepCuts.sort((a, b) => a.playCount - b.playCount);
        return deepCuts.slice(0, 25);
    }

    /**
     * Tracks that were once favorites but haven't been played in a while.
     */
    private getRediscover(allTracks: TrackModel[], now: number): TrackModel[] {
        const thirtyDaysInTicks = 30 * 24 * 60 * 60 * 10000000;
        const thresholdTicks = this.dateToTicks(new Date(now)) - thirtyDaysInTicks;

        const forgotten = allTracks.filter((t) => t.playCount >= 3 && t.dateLastPlayed > 0 && t.dateLastPlayed < thresholdTicks);

        forgotten.sort((a, b) => {
            const scoreA = a.playCount * (thresholdTicks - a.dateLastPlayed);
            const scoreB = b.playCount * (thresholdTicks - b.dateLastPlayed);
            return scoreB - scoreA;
        });

        return forgotten.slice(0, 25);
    }

    /**
     * Smart mix of loved and highly-rated tracks.
     */
    private getLovedAndRated(allTracks: TrackModel[]): TrackModel[] {
        const loved = allTracks.filter((t) => t.love > 0 || t.rating >= 4);
        this.shuffler.shuffle(loved);
        return loved.slice(0, 25);
    }

    /**
     * Tracks with the best play-to-skip ratio.
     */
    private getSkipFreeZone(allTracks: TrackModel[]): TrackModel[] {
        const played = allTracks.filter((t) => t.playCount >= 2);
        if (played.length === 0) {
            return [];
        }

        played.sort((a, b) => {
            const ratioA = a.skipCount / Math.max(a.playCount, 1);
            const ratioB = b.skipCount / Math.max(b.playCount, 1);
            if (ratioA !== ratioB) {
                return ratioA - ratioB;
            }
            return b.playCount - a.playCount;
        });

        return played.slice(0, 25);
    }

    /**
     * Tracks that have been in the library a while but never played.
     */
    private getHiddenGems(allTracks: TrackModel[], now: number): TrackModel[] {
        const thirtyDaysInTicks = 30 * 24 * 60 * 60 * 10000000;
        const thresholdTicks = this.dateToTicks(new Date(now)) - thirtyDaysInTicks;

        const gems = allTracks.filter((t) => t.playCount === 0 && t.dateAdded > 0 && t.dateAdded < thresholdTicks);

        this.shuffler.shuffle(gems);
        return gems.slice(0, 25);
    }

    /**
     * Tracks from the user's least-listened genres, featuring known artists.
     */
    private getGenreExplorer(allTracks: TrackModel[]): TrackModel[] {
        const genrePlayCounts = new Map<string, number>();
        const knownArtists = new Set<string>();

        for (const track of allTracks) {
            if (track.playCount > 0) {
                for (const artist of this.getTrackArtistsList(track)) {
                    knownArtists.add(artist.toLowerCase());
                }
            }
            for (const genre of this.getTrackGenresList(track)) {
                const key = genre.toLowerCase();
                genrePlayCounts.set(key, (genrePlayCounts.get(key) ?? 0) + track.playCount);
            }
        }

        if (genrePlayCounts.size < 2) {
            return [];
        }

        const sortedGenres = [...genrePlayCounts.entries()].sort((a, b) => a[1] - b[1]);
        const leastPlayedGenres = new Set(sortedGenres.slice(0, Math.max(2, Math.floor(sortedGenres.length * 0.3))).map((e) => e[0]));

        const explorerTracks = allTracks.filter((t) => {
            const genres = this.getTrackGenresList(t);
            return genres.some((g) => leastPlayedGenres.has(g.toLowerCase()));
        });

        this.shuffler.shuffle(explorerTracks);
        return explorerTracks.slice(0, 25);
    }

    /**
     * Tracks with similar BPM to the currently playing track.
     */
    private getTempoMatch(allTracks: TrackModel[]): TrackModel[] {
        const currentTrack = this.playbackService.currentTrack;
        let referenceBpm = 0;

        if (currentTrack) {
            referenceBpm = this.getTrackBpm(currentTrack);
        }

        if (referenceBpm === 0) {
            const played = allTracks.filter((t) => t.playCount > 0);
            if (played.length === 0) {
                return [];
            }
            played.sort((a, b) => b.dateLastPlayed - a.dateLastPlayed);
            for (const t of played.slice(0, 20)) {
                const bpm = this.getTrackBpm(t);
                if (bpm > 0) {
                    referenceBpm = bpm;
                    break;
                }
            }
        }

        if (referenceBpm === 0) {
            return [];
        }

        const bpmRange = 15;
        const matched = allTracks.filter((t) => {
            const bpm = this.getTrackBpm(t);
            return bpm > 0 && Math.abs(bpm - referenceBpm) <= bpmRange && t !== currentTrack;
        });

        matched.sort((a, b) => {
            const diffA = Math.abs(this.getTrackBpm(a) - referenceBpm);
            const diffB = Math.abs(this.getTrackBpm(b) - referenceBpm);
            return diffA - diffB;
        });

        return matched.slice(0, 25);
    }

    /**
     * Cross-pollination: tracks from artists who share genres with the user's favorites.
     */
    private getArtistDna(allTracks: TrackModel[]): TrackModel[] {
        const artistPlayCounts = new Map<string, number>();
        const artistGenres = new Map<string, Set<string>>();

        for (const track of allTracks) {
            const artists = this.getTrackArtistsList(track);
            const genres = this.getTrackGenresList(track);

            for (const artist of artists) {
                const key = artist.toLowerCase();
                artistPlayCounts.set(key, (artistPlayCounts.get(key) ?? 0) + track.playCount);

                if (!artistGenres.has(key)) {
                    artistGenres.set(key, new Set());
                }
                for (const genre of genres) {
                    artistGenres.get(key)!.add(genre.toLowerCase());
                }
            }
        }

        const topArtists = [...artistPlayCounts.entries()]
            .filter((e) => e[1] > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map((e) => e[0]);

        if (topArtists.length === 0) {
            return [];
        }

        const topArtistGenres = new Set<string>();
        const topArtistSet = new Set(topArtists);
        for (const artist of topArtists) {
            const genres = artistGenres.get(artist);
            if (genres) {
                for (const genre of genres) {
                    topArtistGenres.add(genre);
                }
            }
        }

        const crossTracks = allTracks.filter((t) => {
            const trackArtists = this.getTrackArtistsList(t);
            const isTopArtist = trackArtists.some((a) => topArtistSet.has(a.toLowerCase()));
            if (isTopArtist) {
                return false;
            }

            const trackGenres = this.getTrackGenresList(t);
            return trackGenres.some((g) => topArtistGenres.has(g.toLowerCase()));
        });

        crossTracks.sort((a, b) => b.playCount - a.playCount);

        const seen = new Set<string>();
        const deduped: TrackModel[] = [];
        for (const t of crossTracks) {
            const key = `${t.title.toLowerCase()}-${t.artists.toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(t);
            }
        }

        return deduped.slice(0, 25);
    }

    private getTrackArtistsList(track: TrackModel): string[] {
        const raw: string[] = track.rawArtists;
        if (raw.length > 0) {
            return raw;
        }
        const artistsStr: string = track.artists;
        if (artistsStr != null && artistsStr.length > 0) {
            return [artistsStr];
        }
        return [];
    }

    private getTrackGenresList(track: TrackModel): string[] {
        return track.rawGenres;
    }

    private getTrackBpm(track: TrackModel): number {
        return track.beatsPerMinute;
    }

    private dateToTicks(date: Date): number {
        return date.getTime() * 10000 + 621355968000000000;
    }
}
