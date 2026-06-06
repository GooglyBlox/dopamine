export interface SpotifyPlaylistSummary {
    id: string;
    name: string;
    description: string;
    ownerId: string;
    ownerDisplayName: string;
    imageUrl?: string;
    trackCount: number;
    snapshotId: string;
}

export interface SpotifyPlaylistTrack {
    id: string;
    name: string;
    artists: string[];
    albumName: string;
    durationMs: number;
    isrc?: string;
    addedAt?: string;
    externalUrl?: string;
    albumImageUrl?: string;
    previewUrl?: string;
}

export interface SpotifyUserProfile {
    id: string;
    displayName: string;
}
