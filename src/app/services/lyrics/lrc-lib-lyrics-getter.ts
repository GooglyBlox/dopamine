import { Injectable } from '@angular/core';
import { TrackModel } from '../track/track-model';
import { ILyricsGetter } from './i-lyrics-getter';
import { LyricsModel } from './lyrics-model';
import { LyricsSourceType } from '../../common/api/lyrics/lyrics-source-type';
import { LrcLibApi } from '../../common/api/lyrics/lrc-lib.api';
import { LrcLibMatch, LrcLibMatcher } from './lrc-lib-matcher';
import { LrcParser, ParsedLrc } from './lrc-parser';
import { Logger } from '../../common/logger';
import { StringUtils } from '../../common/utils/string-utils';

@Injectable()
export class LrcLibLyricsGetter implements ILyricsGetter {
    public constructor(
        private api: LrcLibApi,
        private logger: Logger,
    ) {}

    public async getLyricsAsync(track: TrackModel): Promise<LyricsModel> {
        if (StringUtils.isNullOrWhiteSpace(track.rawFirstArtist) || StringUtils.isNullOrWhiteSpace(track.rawTitle)) {
            return LyricsModel.empty(track);
        }

        const matcher: LrcLibMatcher = new LrcLibMatcher(this.api);

        let match: LrcLibMatch | undefined;

        try {
            match = await matcher.findMatchAsync({
                artist: track.rawFirstArtist,
                title: track.rawTitle,
                album: track.rawAlbumTitle,
                durationSeconds: Math.max(0, track.durationInMilliseconds / 1000),
            });
        } catch (e: unknown) {
            this.logger.error(e, 'Could not get lyrics from LRCLIB', 'LrcLibLyricsGetter', 'getLyricsAsync');
            return LyricsModel.empty(track);
        }

        if (match == undefined || !match.hit.hasUsableLyrics) {
            return LyricsModel.empty(track);
        }

        if (match.hit.synced) {
            const parsed: ParsedLrc = LrcParser.parseString(match.hit.synced);

            if (parsed.textLines.length > 0 && !StringUtils.isNullOrWhiteSpace(parsed.plainText)) {
                return LyricsModel.timed(
                    track,
                    this.api.sourceName,
                    LyricsSourceType.online,
                    parsed.plainText,
                    parsed.textLines,
                    parsed.startTimeStamps,
                );
            }
        }

        if (match.hit.plain && !StringUtils.isNullOrWhiteSpace(match.hit.plain)) {
            return LyricsModel.plain(track, this.api.sourceName, LyricsSourceType.online, match.hit.plain);
        }

        return LyricsModel.empty(track);
    }
}
