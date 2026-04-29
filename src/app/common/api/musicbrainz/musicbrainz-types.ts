export interface MbArtistCandidate {
    mbid: string;
    name: string;
    sortName?: string;
    type?: string;
    country?: string;
    disambiguation?: string;
    beginYear?: string;
    endYear?: string;
    score: number;
}

export interface MbReleaseGroup {
    id: string;
    title: string;
    primaryType?: string;
    secondaryTypes: string[];
    firstReleaseDate?: string;
    hasCoverArt: boolean;
}
