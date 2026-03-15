const { File } = require('@digimezzo/node-taglib-sharp');
const { DataDelimiter } = require('./data-delimiter');

class ArtistNameConsistencyChecker {
    constructor(trackRepository, albumKeyGenerator, logger) {
        this.trackRepository = trackRepository;
        this.albumKeyGenerator = albumKeyGenerator;
        this.logger = logger;
    }

    /**
     * Checks artist name capitalization consistency for the given tracks against
     * all tracks in the database. Fixes any inconsistencies in both the database
     * and the actual file metadata.
     * @param {Array} triggeringTracks - The newly added or updated tracks that triggered the check
     */
    checkAndFixConsistency(triggeringTracks) {
        if (!triggeringTracks || triggeringTracks.length === 0) {
            return;
        }

        try {
            // 1. Collect all unique artist names (case-insensitive) from triggering tracks
            const artistNamesToCheck = this.#collectArtistNames(triggeringTracks);

            if (artistNamesToCheck.size === 0) {
                return;
            }

            // 2. Get all tracks from the database
            const allTracks = this.trackRepository.getAllTracks() ?? [];

            // 3. For each artist, determine the canonical capitalization
            const canonicalNames = this.#determineCanonicalNames(artistNamesToCheck, allTracks);

            if (canonicalNames.size === 0) {
                return;
            }

            // 4. Find and fix all tracks with inconsistent artist names
            this.#fixInconsistentTracks(canonicalNames, allTracks);
        } catch (e) {
            this.logger.error(
                e,
                'A problem occurred while checking artist name consistency',
                'ArtistNameConsistencyChecker',
                'checkAndFixConsistency',
            );
        }
    }

    /**
     * Collects unique artist names (lowercased for deduplication) from the given tracks.
     * Returns a Set of lowercased artist names to check.
     */
    #collectArtistNames(tracks) {
        const artistNames = new Set();

        for (const track of tracks) {
            const artists = this.#parseDelimitedString(track.artists);
            const albumArtists = this.#parseDelimitedString(track.albumArtists);

            for (const artist of [...artists, ...albumArtists]) {
                if (artist.length > 0) {
                    artistNames.add(artist.toLowerCase());
                }
            }
        }

        return artistNames;
    }

    /**
     * For each artist name to check, counts all capitalization variants across all tracks.
     * Returns a Map from lowercased name to the canonical (most common) capitalization.
     * Only includes entries where there are actual inconsistencies.
     */
    #determineCanonicalNames(artistNamesToCheck, allTracks) {
        // Map: lowercased artist name -> Map of (exact capitalization -> count)
        const variantCounts = new Map();

        for (const track of allTracks) {
            const artists = this.#parseDelimitedString(track.artists);
            const albumArtists = this.#parseDelimitedString(track.albumArtists);

            for (const artist of [...artists, ...albumArtists]) {
                const lower = artist.toLowerCase();

                if (!artistNamesToCheck.has(lower)) {
                    continue;
                }

                if (!variantCounts.has(lower)) {
                    variantCounts.set(lower, new Map());
                }

                const counts = variantCounts.get(lower);
                counts.set(artist, (counts.get(artist) || 0) + 1);
            }
        }

        // Pick the most common variant for each artist
        const canonicalNames = new Map();

        for (const [lower, counts] of variantCounts) {
            if (counts.size <= 1) {
                // No inconsistency for this artist
                continue;
            }

            let bestVariant = '';
            let bestCount = 0;

            for (const [variant, count] of counts) {
                if (count > bestCount) {
                    bestCount = count;
                    bestVariant = variant;
                }
            }

            canonicalNames.set(lower, bestVariant);

            const variants = Array.from(counts.entries())
                .map(([v, c]) => `"${v}" (${c})`)
                .join(', ');
            this.logger.info(
                `Artist name inconsistency detected: ${variants}. Using canonical name: "${bestVariant}"`,
                'ArtistNameConsistencyChecker',
                'determineCanonicalNames',
            );
        }

        return canonicalNames;
    }

    /**
     * Finds all tracks with inconsistent artist names and fixes them
     * in both the database and the actual audio file metadata.
     */
    #fixInconsistentTracks(canonicalNames, allTracks) {
        for (const track of allTracks) {
            const artists = this.#parseDelimitedString(track.artists);
            const albumArtists = this.#parseDelimitedString(track.albumArtists);

            const fixedArtists = this.#fixArtistArray(artists, canonicalNames);
            const fixedAlbumArtists = this.#fixArtistArray(albumArtists, canonicalNames);

            const artistsChanged = fixedArtists.changed;
            const albumArtistsChanged = fixedAlbumArtists.changed;

            if (!artistsChanged && !albumArtistsChanged) {
                continue;
            }

            try {
                // Update the actual file metadata
                this.#updateFileMetadata(track.path, fixedArtists.names, fixedAlbumArtists.names, artistsChanged, albumArtistsChanged);

                // Update the database record
                if (artistsChanged) {
                    track.artists = DataDelimiter.toDelimitedString(fixedArtists.names);
                }

                if (albumArtistsChanged) {
                    track.albumArtists = DataDelimiter.toDelimitedString(fixedAlbumArtists.names);
                    // Recalculate albumKey since it depends on album artists
                    track.albumKey = this.albumKeyGenerator.generateAlbumKey(
                        track.albumTitle,
                        fixedAlbumArtists.names,
                    );
                }

                this.trackRepository.updateTrack(track);

                const changes = [];
                if (artistsChanged) changes.push(`artists: "${fixedArtists.names.join(', ')}"`);
                if (albumArtistsChanged) changes.push(`albumArtists: "${fixedAlbumArtists.names.join(', ')}"`);

                this.logger.info(
                    `Fixed artist name consistency for "${track.path}": ${changes.join(', ')}`,
                    'ArtistNameConsistencyChecker',
                    'fixInconsistentTracks',
                );
            } catch (e) {
                this.logger.error(
                    e,
                    `Failed to fix artist name consistency for "${track.path}"`,
                    'ArtistNameConsistencyChecker',
                    'fixInconsistentTracks',
                );
            }
        }
    }

    /**
     * Takes an array of artist names and replaces any that have a canonical form.
     * Returns { names: string[], changed: boolean }
     */
    #fixArtistArray(artists, canonicalNames) {
        let changed = false;
        const fixed = artists.map((artist) => {
            const lower = artist.toLowerCase();
            const canonical = canonicalNames.get(lower);

            if (canonical && canonical !== artist) {
                changed = true;
                return canonical;
            }

            return artist;
        });

        return { names: fixed, changed };
    }

    /**
     * Updates the artist and/or album artist tags in the actual audio file.
     */
    #updateFileMetadata(filePath, artists, albumArtists, updateArtists, updateAlbumArtists) {
        const tagLibFile = File.createFromPath(filePath);

        try {
            if (updateArtists) {
                tagLibFile.tag.performers = artists;
            }

            if (updateAlbumArtists) {
                tagLibFile.tag.albumArtists = albumArtists;
            }

            tagLibFile.save();
        } finally {
            tagLibFile.dispose();
        }
    }

    /**
     * Parses a delimited string like ";Artist1;;Artist2;" into ["Artist1", "Artist2"]
     */
    #parseDelimitedString(delimitedString) {
        if (!delimitedString) {
            return [];
        }

        return delimitedString
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }
}

exports.ArtistNameConsistencyChecker = ArtistNameConsistencyChecker;
