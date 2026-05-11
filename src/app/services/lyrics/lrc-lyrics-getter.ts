import { Injectable } from '@angular/core';
import { TrackModel } from '../track/track-model';
import { ILyricsGetter } from './i-lyrics-getter';
import { LyricsModel } from './lyrics-model';
import { LyricsSourceType } from '../../common/api/lyrics/lyrics-source-type';
import { StringUtils } from '../../common/utils/string-utils';
import { FileAccessBase } from '../../common/io/file-access.base';
import { LrcParser, ParsedLrc } from './lrc-parser';

@Injectable()
export class LrcLyricsGetter implements ILyricsGetter {
    public constructor(private fileAccess: FileAccessBase) {}

    public async getLyricsAsync(track: TrackModel): Promise<LyricsModel> {
        const lrcFilePath: string = this.getLrcFilePath(track);

        if (StringUtils.isNullOrWhiteSpace(lrcFilePath)) {
            return LyricsModel.empty(track);
        }

        const lines: string[] = await this.fileAccess.readLinesAsync(lrcFilePath);
        const parsed: ParsedLrc = LrcParser.parse(lines);

        if (StringUtils.isNullOrWhiteSpace(parsed.plainText)) {
            return LyricsModel.empty(track);
        }

        return LyricsModel.timed(
            track,
            '',
            LyricsSourceType.lrc,
            parsed.plainText,
            parsed.textLines,
            parsed.startTimeStamps,
        );
    }

    private getLrcFilePath(track: TrackModel): string {
        const trackPathWithoutExtension: string = this.fileAccess.getPathWithoutExtension(track.path);
        let possibleLrcFilePath: string = `${trackPathWithoutExtension}.lrc`;

        if (this.fileAccess.pathExists(possibleLrcFilePath)) {
            return possibleLrcFilePath;
        }

        possibleLrcFilePath = `${trackPathWithoutExtension}.Lrc`;

        if (this.fileAccess.pathExists(possibleLrcFilePath)) {
            return possibleLrcFilePath;
        }

        possibleLrcFilePath = `${trackPathWithoutExtension}.LRC`;

        if (this.fileAccess.pathExists(possibleLrcFilePath)) {
            return possibleLrcFilePath;
        }

        return '';
    }
}
