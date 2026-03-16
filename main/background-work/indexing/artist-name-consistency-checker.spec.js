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

// Mock fs-extra for file renaming tests
jest.mock('fs-extra', () => ({
    existsSync: jest.fn(() => false),
    renameSync: jest.fn(),
}));

const fs = require('fs-extra');

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

        jest.clearAllMocks();
        fs.existsSync.mockReturnValue(false);
    });

    function createSut() {
        return new ArtistNameConsistencyChecker(trackRepositoryMock, albumKeyGeneratorMock, loggerMock);
    }

    function createTrackWithArtists(trackPath, artists, albumArtists) {
        const track = new Track(trackPath);
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
            const track1 = createTrackWithArtists('/music/1.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/2.mp3', ';SEBii;', '');
            const track3 = createTrackWithArtists('/music/3.mp3', ';SEBii;', '');
            const existingBad = createTrackWithArtists('/music/4.mp3', ';sebii;', '');
            const newTrack = createTrackWithArtists('/music/5.mp3', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, track3, existingBad, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

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

            expect(trackRepositoryMock.updateTrack).toHaveBeenCalledWith(
                expect.objectContaining({ artists: ';SEBii;;Consistent Artist;' }),
            );
        });
    });

    describe('file renaming', () => {
        it('should rename file when primary artist name appears in "Artist - Title" format', () => {
            const track1 = createTrackWithArtists('/music/SEBii - Other Song.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/SEBii - Another Song.mp3', ';SEBii;', '');
            const newTrack = createTrackWithArtists('/music/Sebii - Play Poker.flac', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/Sebii - Play Poker.flac',
                expect.stringContaining('SEBii - Play Poker.flac'),
            );
        });

        it('should rename file when featured artist name appears in "(feat. Artist)" format', () => {
            const track1 = createTrackWithArtists('/music/SomeArtist - Song1.mp3', ';SomeArtist;;glaive;', '');
            const track2 = createTrackWithArtists('/music/SomeArtist - Song2.mp3', ';SomeArtist;;glaive;', '');
            const newTrack = createTrackWithArtists('/music/Lovesickxo - Mixed Signals (feat. Glaive).mp3', ';Lovesickxo;;Glaive;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/Lovesickxo - Mixed Signals (feat. Glaive).mp3',
                expect.stringContaining('Lovesickxo - Mixed Signals (feat. glaive).mp3'),
            );
        });

        it('should not rename file if artist name is not in the filename', () => {
            const track1 = createTrackWithArtists('/music/01 - Play Poker.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/02 - Other Song.mp3', ';SEBii;', '');
            const newTrack = createTrackWithArtists('/music/03 - New Song.mp3', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).not.toHaveBeenCalled();
        });

        it('should not rename file if a genuinely different target file already exists', () => {
            // Simulate a scenario where the target path already exists as a different file.
            // e.g., renaming "Sebii - Song3.mp3" to "SEBii - Song3.mp3" but a completely
            // different file at that exact path already exists. On case-sensitive filesystems,
            // these would be two distinct files.
            const track1 = createTrackWithArtists('/music/SEBii - Song.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/SEBii - Song2.mp3', ';SEBii;', '');
            const newTrack = createTrackWithArtists('/music/Sebii - Song3.mp3', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            // existsSync returns true AND paths differ in more than case (simulated)
            fs.existsSync.mockReturnValue(true);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // On this test, paths differ only in case ("/music/Sebii" vs "/music/SEBii"),
            // so it IS a case-only rename and SHOULD be allowed through
            expect(fs.renameSync).toHaveBeenCalled();
        });

        it('should not rename file if target path exists and is a genuinely different file', () => {
            // Artist "OldName" -> "NewName" where the paths differ in more than just case
            const track1 = createTrackWithArtists('/music/Artist - Song.mp3', ';Artist;', '');
            const track2 = createTrackWithArtists('/music/Artist - Song2.mp3', ';Artist;', '');
            const newTrack = createTrackWithArtists('/music/artist - Song3.mp3', ';artist;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            // Case-only rename: existsSync true but same file — should still rename
            fs.existsSync.mockReturnValue(true);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // Paths differ only in case, so rename is allowed
            expect(fs.renameSync).toHaveBeenCalled();
        });

        it('should update track path and fileName in database after rename', () => {
            const track1 = createTrackWithArtists('/music/SEBii - Song.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/SEBii - Song2.mp3', ';SEBii;', '');
            const newTrack = createTrackWithArtists('/music/Sebii - Play Poker.flac', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(trackRepositoryMock.updateTrack).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: expect.stringContaining('SEBii - Play Poker.flac'),
                    fileName: 'SEBii - Play Poker.flac',
                }),
            );
        });

        it('should also rename existing tracks with inconsistent artist names in filename', () => {
            const track1 = createTrackWithArtists('/music/SEBii - Song1.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/SEBii - Song2.mp3', ';SEBii;', '');
            const existingBad = createTrackWithArtists('/music/sebii - Song3.mp3', ';sebii;', '');
            const newTrack = createTrackWithArtists('/music/Sebii - Song4.flac', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, existingBad, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledTimes(2);
            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/sebii - Song3.mp3',
                expect.stringContaining('SEBii - Song3.mp3'),
            );
            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/Sebii - Song4.flac',
                expect.stringContaining('SEBii - Song4.flac'),
            );
        });

        it('should handle multiple artist names in the same filename', () => {
            const track1 = createTrackWithArtists('/music/SEBii - Song.mp3', ';SEBii;;Delto;', '');
            const track2 = createTrackWithArtists('/music/SEBii - Song2.mp3', ';SEBii;;Delto;', '');
            const newTrack = createTrackWithArtists('/music/Sebii - Social (feat. delto).flac', ';Sebii;;delto;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/Sebii - Social (feat. delto).flac',
                expect.stringContaining('SEBii - Social (feat. Delto).flac'),
            );
        });
    });

    describe('file renaming edge cases', () => {
        it('should NOT replace artist name when it appears as part of the song title', () => {
            // "funeral" is an artist, but here "funeral" appears in the title of a different artist's song
            const track1 = createTrackWithArtists('/music/funeral - army.flac', ';funeral;', '');
            const track2 = createTrackWithArtists('/music/funeral - ur in my head.flac', ';funeral;', '');
            // This track's title contains "funeral" but by a different artist
            const newTrack = createTrackWithArtists('/music/OtherArtist - funeral freestyle.mp3', ';OtherArtist;;Funeral;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // "funeral" should NOT be changed in the title portion "funeral freestyle"
            expect(fs.renameSync).not.toHaveBeenCalled();
        });

        it('should NOT replace artist name when it is a substring of another word in the artist part', () => {
            // Artist "Red" being corrected, but "Redneck" is in the filename
            const track1 = createTrackWithArtists('/music/RED - Song1.mp3', ';RED;', '');
            const track2 = createTrackWithArtists('/music/RED - Song2.mp3', ';RED;', '');
            const newTrack = createTrackWithArtists('/music/Redneck - Country Song.mp3', ';Redneck;;Red;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // Should NOT rename because "Red" doesn't appear as a whole word in artist part "Redneck"
            // The metadata gets fixed but the filename should stay as-is
            expect(fs.renameSync).not.toHaveBeenCalled();
        });

        it('should handle artist name appearing in both artist part and feat section correctly', () => {
            // "funeral" is featured AND in the primary artist — fix both positions
            const track1 = createTrackWithArtists('/music/funeral - Song1.mp3', ';funeral;', '');
            const track2 = createTrackWithArtists('/music/funeral - Song2.mp3', ';funeral;', '');
            const newTrack = createTrackWithArtists('/music/4cf - WTF (feat. Funeral).flac', ';4cf;;Funeral;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // Only the feat section should be changed, not the title
            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/4cf - WTF (feat. Funeral).flac',
                expect.stringContaining('4cf - WTF (feat. funeral).flac'),
            );
        });

        it('should handle FEAT in all caps', () => {
            const track1 = createTrackWithArtists('/music/SUMMRS - Song1.mp3', ';SUMMRS;', '');
            const track2 = createTrackWithArtists('/music/SUMMRS - Song2.mp3', ';SUMMRS;', '');
            const newTrack = createTrackWithArtists('/music/Yeat - GO2WORK (FEAT. Summrs).ogg', ';Yeat;;Summrs;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/Yeat - GO2WORK (FEAT. Summrs).ogg',
                expect.stringContaining('Yeat - GO2WORK (FEAT. SUMMRS).ogg'),
            );
        });

        it('should handle [with Artist] bracket pattern', () => {
            const track1 = createTrackWithArtists('/music/Armani White - Song1.mp3', ';Armani White;', '');
            const track2 = createTrackWithArtists('/music/Armani White - Song2.mp3', ';Armani White;', '');
            const newTrack = createTrackWithArtists(
                '/music/Denzel Curry - WISHLIST [with armani white].ogg',
                ';Denzel Curry;;armani white;',
                '',
            );

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/Denzel Curry - WISHLIST [with armani white].ogg',
                expect.stringContaining('Denzel Curry - WISHLIST [with Armani White].ogg'),
            );
        });

        it('should handle (with Artist) parenthetical pattern', () => {
            const track1 = createTrackWithArtists('/music/2 Chainz - Song1.mp3', ';2 Chainz;', '');
            const track2 = createTrackWithArtists('/music/2 Chainz - Song2.mp3', ';2 Chainz;', '');
            const newTrack = createTrackWithArtists(
                "/music/Denzel Curry - G'Z UP (with 2 chainz, Mike Dimes).ogg",
                ';Denzel Curry;;2 chainz;;Mike Dimes;',
                '',
            );

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                "/music/Denzel Curry - G'Z UP (with 2 chainz, Mike Dimes).ogg",
                expect.stringContaining("Denzel Curry - G'Z UP (with 2 Chainz, Mike Dimes).ogg"),
            );
        });

        it('should handle artist names with special regex characters like $', () => {
            const track1 = createTrackWithArtists('/music/Joey Bada$ - Song1.mp3', ';Joey Bada$;', '');
            const track2 = createTrackWithArtists('/music/Joey Bada$ - Song2.mp3', ';Joey Bada$;', '');
            const newTrack = createTrackWithArtists('/music/joey bada$ - New Song.mp3', ';joey bada$;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/joey bada$ - New Song.mp3',
                expect.stringContaining('Joey Bada$ - New Song.mp3'),
            );
        });

        it('should handle artist names with exclamation marks', () => {
            const track1 = createTrackWithArtists('/music/Autumn! - Song1.flac', ';Autumn!;', '');
            const track2 = createTrackWithArtists('/music/Autumn! - Song2.flac', ';Autumn!;', '');
            const newTrack = createTrackWithArtists('/music/autumn! - I Am The Goat.flac', ';autumn!;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/autumn! - I Am The Goat.flac',
                expect.stringContaining('Autumn! - I Am The Goat.flac'),
            );
        });

        it('should NOT replace artist name that is a substring of another artist in the primary position', () => {
            // "Kid" is an artist name, but shouldn't match inside "EsDeeKid" or "BJ The Chicago Kid"
            const track1 = createTrackWithArtists('/music/Kid - Song1.mp3', ';Kid;', '');
            const track2 = createTrackWithArtists('/music/Kid - Song2.mp3', ';Kid;', '');
            const newTrack = createTrackWithArtists('/music/EsDeeKid - Rebel.flac', ';EsDeeKid;;kid;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // "kid" metadata gets fixed to "Kid", but the filename "EsDeeKid" should NOT be touched
            expect(fs.renameSync).not.toHaveBeenCalled();
        });

        it('should NOT touch non-feat parentheticals in the title', () => {
            // "(dante\'s inferno)" is part of the title, not a feat section
            const track1 = createTrackWithArtists('/music/Dante - Song1.mp3', ';Dante;', '');
            const track2 = createTrackWithArtists('/music/Dante - Song2.mp3', ';Dante;', '');
            const newTrack = createTrackWithArtists(
                "/music/siouxxie - masquerade II (dante's inferno).flac",
                ';siouxxie;;dante;',
                '',
            );

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // "dante" in "(dante's inferno)" should NOT be changed — it's title content, not a feat section
            expect(fs.renameSync).not.toHaveBeenCalled();
        });

        it('should NOT rename file when filename has no " - " separator', () => {
            const track1 = createTrackWithArtists('/music/funeral - Song1.mp3', ';funeral;', '');
            const track2 = createTrackWithArtists('/music/funeral - Song2.mp3', ';funeral;', '');
            // No " - " separator — not in "Artist - Title" format
            const newTrack = createTrackWithArtists('/music/Funeral forever.mp3', ';Funeral;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // Metadata still gets fixed, but filename is not touched
            expect(fs.renameSync).not.toHaveBeenCalled();
            expect(trackRepositoryMock.updateTrack).toHaveBeenCalled();
        });

        it('should handle multiple featured artists separated by commas', () => {
            const track1 = createTrackWithArtists('/music/21 Savage - Song1.mp3', ';21 Savage;', '');
            const track2 = createTrackWithArtists('/music/21 Savage - Song2.mp3', ';21 Savage;', '');
            const newTrack = createTrackWithArtists(
                '/music/Childish Gambino - Psilocybae (feat. 21 savage, Ink & Kadhja Bonet).ogg',
                ';Childish Gambino;;21 savage;;Ink;;Kadhja Bonet;',
                '',
            );

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/Childish Gambino - Psilocybae (feat. 21 savage, Ink & Kadhja Bonet).ogg',
                expect.stringContaining(
                    'Childish Gambino - Psilocybae (feat. 21 Savage, Ink & Kadhja Bonet).ogg',
                ),
            );
        });

        it('should handle track number prefix in artist part like "01. Artist - Title"', () => {
            const track1 = createTrackWithArtists('/music/SEBii - Song1.mp3', ';SEBii;', '');
            const track2 = createTrackWithArtists('/music/SEBii - Song2.mp3', ';SEBii;', '');
            const newTrack = createTrackWithArtists('/music/05. Sebii - Play Poker.flac', ';Sebii;', '');

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/05. Sebii - Play Poker.flac',
                expect.stringContaining('05. SEBii - Play Poker.flac'),
            );
        });

        it('should handle artist name repeated in album portion of filename without corrupting it', () => {
            // "Dante Red - Dante Red Complete Works (Bootleg) - 03 himynameisdante.flac"
            // "Dante Red" appears as artist and in album title — only fix in artist position (before first " - ")
            const track1 = createTrackWithArtists('/music/Dante Red - Song1.mp3', ';Dante Red;', '');
            const track2 = createTrackWithArtists('/music/Dante Red - Song2.mp3', ';Dante Red;', '');
            const newTrack = createTrackWithArtists(
                '/music/dante red - Dante Red Complete Works (Bootleg) - 03 himynameisdante.flac',
                ';dante red;',
                '',
            );

            trackRepositoryMock.getAllTracks.mockReturnValue([track1, track2, newTrack]);

            const sut = createSut();
            sut.checkAndFixConsistency([newTrack]);

            // Only the artist part before first " - " should change, not the album name in the title
            expect(fs.renameSync).toHaveBeenCalledWith(
                '/music/dante red - Dante Red Complete Works (Bootleg) - 03 himynameisdante.flac',
                expect.stringContaining(
                    'Dante Red - Dante Red Complete Works (Bootleg) - 03 himynameisdante.flac',
                ),
            );
        });
    });
});
