import { IMock, It, Mock, Times } from 'typemoq';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { DuplicateGroup } from './duplicate-group';
import { Track } from '../../data/entities/track';
import { TrackModel } from '../track/track-model';
import { TrackModelFactory } from '../track/track-model-factory';
import { TrackRepositoryBase } from '../../data/repositories/track-repository.base';
import { SettingsBase } from '../../common/settings/settings.base';
import { FileAccessBase } from '../../common/io/file-access.base';
import { Logger } from '../../common/logger';
import { DateTime } from '../../common/date-time';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { DataDelimiter } from '../../data/data-delimiter';

jest.mock('fs-extra', () => ({
    realpathSync: {
        // Every path in these tests is considered to be on disk exactly as stored.
        native: (p: string) => p,
    },
}));

describe('DuplicateDetectionService', () => {
    let trackRepositoryMock: IMock<TrackRepositoryBase>;
    let trackModelFactoryMock: IMock<TrackModelFactory>;
    let settingsMock: IMock<SettingsBase>;
    let fileAccessMock: IMock<FileAccessBase>;
    let loggerMock: IMock<Logger>;
    let dateTimeMock: IMock<DateTime>;
    let translatorServiceMock: IMock<TranslatorServiceBase>;

    let trackId: number;

    function createTrack(
        title: string,
        artists: string,
        albumTitle: string,
        albumArtists: string,
        durationInMilliseconds: number,
        path: string,
    ): Track {
        const track: Track = new Track(path);
        track.trackId = trackId++;
        track.trackTitle = title;
        track.artists = DataDelimiter.toDelimitedString([artists]);
        track.albumTitle = albumTitle;
        track.albumArtists = DataDelimiter.toDelimitedString([albumArtists]);
        track.duration = durationInMilliseconds;

        return track;
    }

    function createService(tracks: Track[]): DuplicateDetectionService {
        trackRepositoryMock.setup((x) => x.getVisibleTracks()).returns(() => tracks);

        for (const track of tracks) {
            fileAccessMock.setup((x) => x.pathExists(track.path)).returns(() => true);
            trackModelFactoryMock
                .setup((x) => x.createFromTrack(track, It.isAnyString()))
                .returns(() => new TrackModel(track, dateTimeMock.object, translatorServiceMock.object, ''));
        }

        return new DuplicateDetectionService(
            trackRepositoryMock.object,
            trackModelFactoryMock.object,
            settingsMock.object,
            fileAccessMock.object,
            loggerMock.object,
        );
    }

    beforeEach(() => {
        trackId = 1;
        trackRepositoryMock = Mock.ofType<TrackRepositoryBase>();
        trackModelFactoryMock = Mock.ofType<TrackModelFactory>();
        settingsMock = Mock.ofType<SettingsBase>();
        fileAccessMock = Mock.ofType<FileAccessBase>();
        loggerMock = Mock.ofType<Logger>();
        dateTimeMock = Mock.ofType<DateTime>();
        translatorServiceMock = Mock.ofType<TranslatorServiceBase>();

        settingsMock.setup((x) => x.albumKeyIndex).returns(() => '');
        translatorServiceMock.setup((x) => x.get(It.isAnyString())).returns(() => 'Unknown');
    });

    describe('detectDuplicates', () => {
        it('should not report the same song on two different albums as a duplicate', () => {
            // Arrange
            const studioAlbumTrack: Track = createTrack(
                'Bohemian Rhapsody',
                'Queen',
                'A Night at the Opera',
                'Queen',
                354000,
                '/music/a-night-at-the-opera/01.mp3',
            );
            const compilationTrack: Track = createTrack(
                'Bohemian Rhapsody',
                'Queen',
                'Greatest Hits',
                'Queen',
                354000,
                '/music/greatest-hits/03.mp3',
            );

            const service: DuplicateDetectionService = createService([studioAlbumTrack, compilationTrack]);

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(0);
        });

        it('should report the same song on the same album as a duplicate', () => {
            // Arrange
            const originalTrack: Track = createTrack(
                'Bohemian Rhapsody',
                'Queen',
                'A Night at the Opera',
                'Queen',
                354000,
                '/music/a-night-at-the-opera/01.mp3',
            );
            const copiedTrack: Track = createTrack(
                'Bohemian Rhapsody',
                'Queen',
                'A Night at the Opera',
                'Queen',
                354000,
                '/backup/a-night-at-the-opera/01.mp3',
            );

            const service: DuplicateDetectionService = createService([originalTrack, copiedTrack]);

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(1);
            expect(duplicateGroups[0].tracks.length).toEqual(2);
            expect(duplicateGroups[0].title).toEqual('Bohemian Rhapsody');
            expect(duplicateGroups[0].artists).toEqual('Queen');
            expect(duplicateGroups[0].album).toEqual('A Night at the Opera');
        });

        it('should not report the same song on albums that differ only by album artist as a duplicate', () => {
            // Arrange
            const ownAlbumTrack: Track = createTrack('Hurt', 'Nine Inch Nails', 'Greatest Hits', 'Nine Inch Nails', 373000, '/music/a.mp3');
            const otherAlbumTrack: Track = createTrack('Hurt', 'Nine Inch Nails', 'Greatest Hits', 'Johnny Cash', 373000, '/music/b.mp3');

            const service: DuplicateDetectionService = createService([ownAlbumTrack, otherAlbumTrack]);

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(0);
        });

        it('should report copies without album metadata as duplicates', () => {
            // Arrange
            const firstTrack: Track = createTrack('Some Song', 'Some Artist', '', '', 200000, '/music/some-song.mp3');
            const secondTrack: Track = createTrack('Some Song', 'Some Artist', '', '', 200000, '/downloads/some-song.mp3');

            const service: DuplicateDetectionService = createService([firstTrack, secondTrack]);

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(1);
            expect(duplicateGroups[0].tracks.length).toEqual(2);
            expect(duplicateGroups[0].album).toEqual('');
        });

        it('should not report tracks on the same album whose durations differ beyond the tolerance as duplicates', () => {
            // Arrange
            const shortTrack: Track = createTrack('Intro', 'Some Artist', 'Some Album', 'Some Artist', 60000, '/music/intro-short.mp3');
            const longTrack: Track = createTrack('Intro', 'Some Artist', 'Some Album', 'Some Artist', 120000, '/music/intro-long.mp3');

            const service: DuplicateDetectionService = createService([shortTrack, longTrack]);

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(0);
        });

        it('should group duplicates per album when a song occurs twice on two different albums', () => {
            // Arrange
            const studio1: Track = createTrack('Creep', 'Radiohead', 'Pablo Honey', 'Radiohead', 238000, '/music/pablo-honey/02.mp3');
            const studio2: Track = createTrack('Creep', 'Radiohead', 'Pablo Honey', 'Radiohead', 238000, '/backup/pablo-honey/02.mp3');
            const compilation1: Track = createTrack('Creep', 'Radiohead', 'Best Of', 'Radiohead', 238000, '/music/best-of/01.mp3');
            const compilation2: Track = createTrack('Creep', 'Radiohead', 'Best Of', 'Radiohead', 238000, '/backup/best-of/01.mp3');

            const service: DuplicateDetectionService = createService([studio1, compilation1, studio2, compilation2]);

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(2);

            const albums: string[] = duplicateGroups.map((x) => x.album).sort();
            expect(albums).toEqual(['Best Of', 'Pablo Honey']);

            for (const duplicateGroup of duplicateGroups) {
                expect(duplicateGroup.tracks.length).toEqual(2);
            }
        });

        it('should ignore album title casing and surrounding whitespace when comparing albums', () => {
            // Arrange
            const firstTrack: Track = createTrack('Song', 'Artist', 'The Album', 'Artist', 180000, '/music/a.mp3');
            const secondTrack: Track = createTrack('Song', 'Artist', ' the album ', 'Artist', 180000, '/music/b.mp3');

            const service: DuplicateDetectionService = createService([firstTrack, secondTrack]);

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(1);
            expect(duplicateGroups[0].tracks.length).toEqual(2);
        });

        it('should return no duplicate groups if there are no tracks', () => {
            // Arrange
            const service: DuplicateDetectionService = createService([]);

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(0);
        });

        it('should delete tracks whose file no longer exists and not report them as duplicates', () => {
            // Arrange
            const existingTrack: Track = createTrack('Song', 'Artist', 'Album', 'Artist', 180000, '/music/a.mp3');
            const missingTrack: Track = createTrack('Song', 'Artist', 'Album', 'Artist', 180000, '/music/gone.mp3');

            trackRepositoryMock.setup((x) => x.getVisibleTracks()).returns(() => [existingTrack, missingTrack]);
            fileAccessMock.setup((x) => x.pathExists(existingTrack.path)).returns(() => true);
            fileAccessMock.setup((x) => x.pathExists(missingTrack.path)).returns(() => false);
            trackModelFactoryMock
                .setup((x) => x.createFromTrack(existingTrack, It.isAnyString()))
                .returns(() => new TrackModel(existingTrack, dateTimeMock.object, translatorServiceMock.object, ''));

            const service: DuplicateDetectionService = new DuplicateDetectionService(
                trackRepositoryMock.object,
                trackModelFactoryMock.object,
                settingsMock.object,
                fileAccessMock.object,
                loggerMock.object,
            );

            // Act
            const duplicateGroups: DuplicateGroup[] = service.detectDuplicates();

            // Assert
            expect(duplicateGroups.length).toEqual(0);
            trackRepositoryMock.verify((x) => x.deleteTracks([missingTrack.trackId]), Times.once());
        });
    });
});
