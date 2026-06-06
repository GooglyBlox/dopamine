import { SpotifyPlaylistSummary, SpotifyPlaylistTrack } from '../../common/api/spotify/spotify-types';
import { MatchedTrack } from './spotify-track-matcher';

export interface EnrichedMatchedTrack extends MatchedTrack {
    localCoverArtUrl?: string;
    localDurationMs?: number;
}

export interface SpotifyPlaylistViewModel {
    summary: SpotifyPlaylistSummary;
    isAlgorithmic: boolean;
    isImported: boolean;
    isPasted: boolean;
}

export interface PastedTrack {
    artists: string[];
    title: string;
    albumName?: string;
}

export interface PastedPlaylistEntry {
    id: string;
    name: string;
    tracks: PastedTrack[];
    createdAt: number;
    coverArtUrl?: string;
}

export interface SpotifyPlaylistDetail {
    summary: SpotifyPlaylistSummary;
    tracks: EnrichedMatchedTrack[];
    presentCount: number;
    missingCount: number;
}

export type { SpotifyPlaylistTrack };
