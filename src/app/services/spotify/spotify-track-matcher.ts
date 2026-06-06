import { Injectable } from '@angular/core';
import { Constants } from '../../common/application/constants';
import { Track } from '../../data/entities/track';
import { TrackRepositoryBase } from '../../data/repositories/track-repository.base';
import { SpotifyPlaylistTrack } from '../../common/api/spotify/spotify-types';

export interface MatchedTrack {
    spotifyTrack: SpotifyPlaylistTrack;
    matchedLocalTrack?: Track;
    matchQuality: 'isrc' | 'title-artist-duration' | 'title-artist' | 'none';
}

interface LocalTrackIndex {
    byIsrc: Map<string, Track>;
    byTitleArtist: Map<string, Track[]>;
}

// Patterns applied to the raw title string before base normalization.
// All matches are stripped wherever they occur (the `g` flag) so feat./with markers
// don't have to be at the end of the title.
const TITLE_STRIP_PATTERNS: RegExp[] = [
    // (feat. X), (ft X), (featuring X), (with X), (w/ X) — parenthesized
    /\s*\(\s*(feat\.?|ft\.?|featuring|with|w\/)\b[^)]*\)/gi,
    // [feat. X] etc. — bracketed
    /\s*\[\s*(feat\.?|ft\.?|featuring|with|w\/)\b[^\]]*\]/gi,
    // " - feat. X" / " — ft X" — dashed trailing
    /\s+[-–—]\s+(feat\.?|ft\.?|featuring)\b[^-–—]*$/i,
    // " feat. X" / " ft X" / " featuring X" — trailing without parens
    /\s+(feat\.?|ft\.?|featuring)\b.*$/i,
];

// End-anchored patterns for version/edition tags. Applied after the strip patterns.
const TITLE_SUFFIX_PATTERNS: RegExp[] = [
    /\s*[-–]\s*remaster(ed)?(\s+\d{2,4})?$/i,
    /\s*[-–]\s*(\d{4}\s+)?remaster(ed)?$/i,
    /\s*\(\s*remaster(ed)?[^)]*\)$/i,
    /\s*\[remaster(ed)?[^\]]*\]$/i,
    /\s*\(\s*\d{4}\s+(re-)?recorded[^)]*\)$/i,
    /\s*\(\s*(deluxe|expanded|bonus|anniversary|edition)[^)]*\)$/i,
];

@Injectable({ providedIn: 'root' })
export class SpotifyTrackMatcher {
    public constructor(private trackRepository: TrackRepositoryBase) {}

    public buildIndex(): LocalTrackIndex {
        const tracks = this.trackRepository.getVisibleTracks() ?? [];
        const byIsrc = new Map<string, Track>();
        const byTitleArtist = new Map<string, Track[]>();

        for (const track of tracks) {
            const title = SpotifyTrackMatcher.normalizeTitle(track.trackTitle ?? '');
            const localArtists = SpotifyTrackMatcher.splitDelimited(track.artists);
            const albumArtists = SpotifyTrackMatcher.splitDelimited(track.albumArtists);
            const artistPool = new Set<string>([...localArtists, ...albumArtists]);

            for (const artist of artistPool) {
                const key = SpotifyTrackMatcher.makeKey(title, artist);
                if (key.length === 0) continue;
                const existing = byTitleArtist.get(key);
                if (existing) {
                    existing.push(track);
                } else {
                    byTitleArtist.set(key, [track]);
                }
            }
        }

        return { byIsrc, byTitleArtist };
    }

    public match(spotifyTrack: SpotifyPlaylistTrack, index: LocalTrackIndex): MatchedTrack {
        if (spotifyTrack.isrc && spotifyTrack.isrc.length > 0) {
            const isrcHit = index.byIsrc.get(spotifyTrack.isrc.toUpperCase());
            if (isrcHit != undefined) {
                return { spotifyTrack, matchedLocalTrack: isrcHit, matchQuality: 'isrc' };
            }
        }

        const title = SpotifyTrackMatcher.normalizeTitle(spotifyTrack.name);
        if (title.length === 0) {
            return { spotifyTrack, matchQuality: 'none' };
        }

        const candidates: Track[] = [];
        const seen = new Set<number>();
        for (const artist of spotifyTrack.artists) {
            const key = SpotifyTrackMatcher.makeKey(title, artist);
            if (key.length === 0) continue;
            const hits = index.byTitleArtist.get(key);
            if (hits == undefined) continue;
            for (const hit of hits) {
                if (!seen.has(hit.trackId)) {
                    seen.add(hit.trackId);
                    candidates.push(hit);
                }
            }
        }

        if (candidates.length === 0) {
            return { spotifyTrack, matchQuality: 'none' };
        }

        if (candidates.length === 1) {
            return {
                spotifyTrack,
                matchedLocalTrack: candidates[0],
                matchQuality: this.qualityFromDuration(spotifyTrack.durationMs, candidates[0].duration),
            };
        }

        const targetDuration = spotifyTrack.durationMs;
        let best: Track | undefined;
        let bestDelta = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
            const dur = candidate.duration ?? 0;
            const delta = Math.abs(dur - targetDuration);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = candidate;
            }
        }
        const quality = bestDelta <= 2500 ? 'title-artist-duration' : 'title-artist';
        return { spotifyTrack, matchedLocalTrack: best, matchQuality: quality };
    }

    private qualityFromDuration(
        spotifyMs: number,
        localMs: number | undefined,
    ): MatchedTrack['matchQuality'] {
        if (localMs == undefined || spotifyMs <= 0) return 'title-artist';
        return Math.abs(localMs - spotifyMs) <= 2500 ? 'title-artist-duration' : 'title-artist';
    }

    private static splitDelimited(value: string | undefined): string[] {
        if (value == undefined || value.length === 0) return [];
        return value
            .split(Constants.columnValueDelimiter)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }

    public static makeKey(title: string, artist: string): string {
        const normalizedArtist = SpotifyTrackMatcher.normalizeArtist(artist);
        if (title.length === 0 || normalizedArtist.length === 0) return '';
        return `${normalizedArtist}${title}`;
    }

    public static normalizeTitle(raw: string): string {
        if (raw == undefined) return '';
        let value = String(raw);
        // Strip feat./ft./featuring/with annotations while parens/brackets are still present.
        for (const pattern of TITLE_STRIP_PATTERNS) {
            value = value.replace(pattern, ' ');
        }
        // Strip version/edition tags (remaster/deluxe/etc.) — now they run *before*
        // baseNormalize so the parens are still present and the patterns can match.
        for (const pattern of TITLE_SUFFIX_PATTERNS) {
            value = value.replace(pattern, ' ');
        }
        value = SpotifyTrackMatcher.baseNormalize(value);
        return SpotifyTrackMatcher.collapse(value);
    }

    public static normalizeArtist(raw: string): string {
        return SpotifyTrackMatcher.collapse(SpotifyTrackMatcher.baseNormalize(raw));
    }

    private static baseNormalize(raw: string): string {
        if (raw == undefined) return '';
        let v = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        v = v.replace(/&/g, ' and ');
        v = v.replace(/[`'"‘’“”]/g, '');
        v = v.replace(/[^a-z0-9]+/g, ' ');
        return v;
    }

    private static collapse(value: string): string {
        return value.replace(/\s+/g, ' ').trim();
    }
}
