import { MbArtistCandidate } from '../../common/api/musicbrainz/musicbrainz-types';

export class ArtistMbidPickerData {
    public constructor(
        public artistName: string,
        public candidates: MbArtistCandidate[],
    ) {}
}
