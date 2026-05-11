import { Injectable } from '@angular/core';
import { TrackModel } from '../track/track-model';
import { ILyricsGetter } from './i-lyrics-getter';
import { IFileMetadata } from '../../common/metadata/i-file-metadata';
import { LyricsModel } from './lyrics-model';
import { LyricsSourceType } from '../../common/api/lyrics/lyrics-source-type';
import { FileMetadataFactoryBase } from '../../common/metadata/file-metadata.factory.base';
import { StringUtils } from '../../common/utils/string-utils';
import { LrcParser, ParsedLrc } from './lrc-parser';

@Injectable()
export class EmbeddedLyricsGetter implements ILyricsGetter {
    private static readonly lrcLineRegex: RegExp = /\[\d{1,3}:\d{2}[.:]\d{2,3}\]/;

    public constructor(private fileMetadataFactory: FileMetadataFactoryBase) {}

    public async getLyricsAsync(track: TrackModel): Promise<LyricsModel> {
        const fileMetadata: IFileMetadata = await this.fileMetadataFactory.createAsync(track.path);

        if (StringUtils.isNullOrWhiteSpace(fileMetadata.lyrics)) {
            return LyricsModel.empty(track);
        }

        if (EmbeddedLyricsGetter.lrcLineRegex.test(fileMetadata.lyrics)) {
            const parsed: ParsedLrc = LrcParser.parseString(fileMetadata.lyrics);

            if (parsed.textLines.length > 0 && !StringUtils.isNullOrWhiteSpace(parsed.plainText)) {
                return LyricsModel.timed(
                    track,
                    '',
                    LyricsSourceType.embedded,
                    parsed.plainText,
                    parsed.textLines,
                    parsed.startTimeStamps,
                );
            }
        }

        return LyricsModel.plain(track, '', LyricsSourceType.embedded, fileMetadata.lyrics);
    }
}
