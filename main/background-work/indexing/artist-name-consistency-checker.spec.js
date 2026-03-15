const { ArtistNameConsistencyChecker } = require('./artist-name-consistency-checker');
const { LoggerMock } = require('../mocks/logger-mock');
const { Track } = require('../data/entities/track');

// Mock for File from @digimezzo/node-taglib-sharp
jest.mock('@digimezzo/node-taglib-sharp', () => {
    const savedFiles = {};
    return {
        File: {
            createFromPath: jest.fn((path) => {
                const tag = {
                    performers: [],
                    albumArtists: [],
                };
                return {
                    tag,
                    save: jest.fn(() => {
                        savedFiles[path] = {
                            performers: [...tag.performers],
                            albumArtists: [...tag.albumArtists],
                        };
                    }),
                    dispose: jest.fn(),
                };
            }),
        },
        _savedFiles: savedFiles,
    };
});

describe('ArtistNameConsistencyChecker', () => {
    let trackRepositoryMock;
    let albumKeyGeneratorMock;
    let loggerMock;

    beforeEach(() => {
        trackRepositoryMock = {
            getAllTracks: jest.fn(() => []),
            updateTrack: jest.fn(),
        };

        albumKeyGeneratorMock = {
            generateAlbumKey: jest.fn((albumTitle, albumArtists) => {
                if (!albumTitle) return '';
                const items = [albumTitle, ...(albumArtists || []).map((x) => x.toLowerCase())];
                return ';' + items.join(';;') + ';';
            }),
        };

        loggerMock = new LoggerMock();
    });

    function createSut() {
        return new ArtistNameConsistencyChecker(trackRepositoryMock, albumKeyGeneratorMock, loggerMock);
    }

    function createTrackWithArtists(path, artists, albumArtists) {
        const track = new Track(path);
        track.artists = artists || '';
        track.albumArtists = albumArtists || '';
        track.albumTitle = 'Some Album';
        track.albumKey = '';
        return track;
    }

    describe('checkAndFixConsistency', () => {
        it('should do nothing when no tracks are provided', () => {
            const sut = createSut();
            sut.checkAndFixConsistency([]);
            expect(trackRepositoryMock.getAllTracks).not.toHaveBeenCalled();
        });

        it('should do nothing when tracks is null', () => {
            const sut = createSut();
            sut.checkAndFixConsistency(null);
            expect(trackRepositoryMock.getAllTracks).not.toHaveBeenCalled();
        });

        it('should not update tracks when all artist names are consistent', () => {
            const track1 = createTrackWithArtists('/music/1.mp3', ';SEBii;', ';SEBii;');
            const track2 = createTrackWithArtists('/music/2.mp3', ';SEBii;', ';SEBii;');
            const newTrack = createTrackWithArtists('/music/3.mp3', ';SEBii;', ';SEBii;');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(trackRepositoryMock.updateTrack).not.toHaveBeenCalled();
        });

        it('should fix artist name to match the most common capitalization', () => {
            const track1 = createTrackWithArtists('/music/1.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/2.mp3', ';SEBii;', '');
            const track3 = createTrackWithArtists('/music/3.mp3', ';SEBii;', '');
            const newTrack = createTrackWithArtists('/music/4.mp3', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, track3, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // The new track should be updated to use "SEBii"
            expect(trackRepositoryMock.updateTrack).toHaveBeenCalledWith(
                expect.objectContaining({ artists: ';SEBii;' }),
            );
        });

        it('should fix multiple artists on the same track', () => {
            const track1 = createTrackWithArtists('/music/1.mp3', ';SEBii;;Delto;', '');
            const track2 = createTrackWithArtists('/music/2.mp3', ';SEBii;;Delto;', '');
            const newTrack = createTrackWithArtists('/music/3.mp3', ';Sebii;;delto;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(trackRepositoryMock.updateTrack).toHaveBeenCalledWith(
                expect.objectContaining({ artists: ';SEBii;;Delto;' }),
            );
        });

        it('should also fix existing tracks that have inconsistent names', () => {
            // 3 tracks say "SEBii", 1 existing track says "sebii", 1 new track says "Sebii"
            const track1 = createTrackWithArtists('/music/1.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/2.mp3', ';SEBii;', '');
            const track3 = createTrackWithArtists('/music/3.mp3', ';SEBii;', '');
            const existingBad = createTrackWithArtists('/music/4.mp3', ';sebii;', '');
            const newTrack = createTrackWithArtists('/music/5.mp3', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, track3, existingBad, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // Both the existing bad track and the new track should be fixed
            expect(trackRepositoryMock.updateTrack).toHaveBeenCalledTimes(2);
        });

        it('should fix album artists as well as artists', () => {
            const track1 = createTrackWithArtists('/music/1.mp3', '', ';SEBii;');
            const track2 = createTrackWithArtists('/music/2.mp3', '', ';SEBii;');
            const newTrack = createTrackWithArtists('/music/3.mp3', '', ';Sebii;');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(trackRepositoryMock.updateTrack).toHaveBeenCalledWith(
                expect.objectContaining({ albumArtists: ';SEBii;' }),
            );
        });

        it('should recalculate albumKey when album artists are changed', () => {
            const track1 = createTrackWithArtists('/music/1.mp3', '', ';SEBii;');
            const track2 = createTrackWithArtists('/music/2.mp3', '', ';SEBii;');
            const newTrack = createTrackWithArtists('/music/3.mp3', '', ';Sebii;');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(albumKeyGeneratorMock.generateAlbumKey).toHaveBeenCalled();
        });

        it('should handle cross-field inconsistencies (artist in one field, album artist in another)', () => {
            // Artist "SEBii" appears in artists field of track1, albumArtists field of track2
            const track1 = createTrackWithArtists('/music/1.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/2.mp3', '', ';SEBii;');
            const newTrack = createTrackWithArtists('/music/3.mp3', ';Sebii;', ';Sebii;');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(trackRepositoryMock.updateTrack).toHaveBeenCalledWith(
                expect.objectContaining({
                    artists: ';SEBii;',
                    albumArtists: ';SEBii;',
                }),
            );
        });

        it('should not modify artists that have no inconsistency', () => {
            const track1 = createTrackWithArtists('/music/1.mp3', ';SEBii;;Consistent Artist;', '');
            const track2 = createTrackWithArtists('/music/2.mp3', ';SEBii;;Consistent Artist;', '');
            const newTrack = createTrackWithArtists('/music/3.mp3', ';Sebii;;Consistent Artist;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // Only the new track should be updated (SEBii fixed), but "Consistent Artist" stays the same
            expect(trackRepositoryMock.updateTrack).toHaveBeenCalledWith(
                expect.objectContaining({ artists: ';SEBii;;Consistent Artist;' }),
            );
        });
    });
});
