import { TrackModel } from '../track/track-model';

export class DuplicateGroup {
    public constructor(
        public title: string,
        public artists: string,
        public album: string,
        public tracks: TrackModel[],
    ) {}
}
