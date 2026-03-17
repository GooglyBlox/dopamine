const { File } = require('@digimezzo/node-taglib-sharp');
const { DataDelimiter } = require('./data-delimiter');
const fs = require('fs-extra');
const path = require('path');

class ArtistNameConsistencyChecker {
    constructor(trackRepository, folderRepository, albumKeyGenerator, logger) {
        this.trackRepository = trackRepository;
        this.folderRepository = folderRepository;
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

            if (artistNamesToCheck.size > 0) {
                // 2. Get all tracks from the database
                const allTracks = this.trackRepository.getAllTracks() ?? [];

                // 3. For each artist, determine the canonical capitalization
                const canonicalNames = this.#determineCanonicalNames(artistNamesToCheck, allTracks);

                // 4. Find and fix all tracks with inconsistent artist names
                if (canonicalNames.size > 0) {
                    this.#fixInconsistentTracks(canonicalNames, allTracks);
                }
            }
        } catch (e) {
            this.logger.error(
                e,
                'A problem occurred while checking artist name consistency',
                'ArtistNameConsistencyChecker',
                'checkAndFixConsistency',
            );
        }

        // 5. Organize triggering tracks into Artist/Album folder structure.
        //    Re-fetch from DB to pick up any consistency fixes applied above.
        try {
            const trackIds = new Set(triggeringTracks.map((t) => t.trackId));
            const updatedTracks = (this.trackRepository.getAllTracks() ?? []).filter((t) => trackIds.has(t.trackId));
            this.#organizeIntoArtistFolders(updatedTracks);
        } catch (e) {
            this.logger.error(
                e,
                'A problem occurred while organizing files into artist folders',
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
     * in both the database, the actual audio file metadata, and the file name.
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
                // Collect the old->canonical replacements that apply to this track
                const replacements = this.#collectReplacements(artists, fixedArtists, albumArtists, fixedAlbumArtists);

                // Fix artist names in feat/ft/with sections of the track title and album title
                const fixedTitle = this.#replaceInFeatSections(track.trackTitle || '', replacements);
                const titleChanged = fixedTitle !== (track.trackTitle || '');

                const fixedAlbumTitle = this.#replaceInFeatSections(track.albumTitle || '', replacements);
                const albumTitleChanged = fixedAlbumTitle !== (track.albumTitle || '');

                // Update the actual file metadata
                this.#updateFileMetadata(
                    track.path,
                    fixedArtists.names,
                    fixedAlbumArtists.names,
                    artistsChanged,
                    albumArtistsChanged,
                    titleChanged ? fixedTitle : undefined,
                    albumTitleChanged ? fixedAlbumTitle : undefined,
                );

                // Update the database record
                if (artistsChanged) {
                    track.artists = DataDelimiter.toDelimitedString(fixedArtists.names);
                }

                if (albumArtistsChanged) {
                    track.albumArtists = DataDelimiter.toDelimitedString(fixedAlbumArtists.names);
                }

                if (albumTitleChanged) {
                    track.albumTitle = fixedAlbumTitle;
                }

                // Recalculate albumKey if album artists or album title changed
                if (albumArtistsChanged || albumTitleChanged) {
                    track.albumKey = this.albumKeyGenerator.generateAlbumKey(
                        track.albumTitle,
                        fixedAlbumArtists.names,
                    );
                }

                if (titleChanged) {
                    track.trackTitle = fixedTitle;
                }

                // Rename the file if any artist names appear in the filename
                const originalPath = track.path;
                const newPath = this.#renameFileIfNeeded(track.path, replacements);
                const fileRenamed = newPath !== originalPath;

                if (fileRenamed) {
                    track.path = newPath;
                    track.fileName = path.basename(newPath);
                }

                this.trackRepository.updateTrack(track);

                const changes = [];
                if (artistsChanged) changes.push(`artists: "${fixedArtists.names.join(', ')}"`);
                if (albumArtistsChanged) changes.push(`albumArtists: "${fixedAlbumArtists.names.join(', ')}"`);
                if (titleChanged) changes.push(`title: "${fixedTitle}"`);
                if (albumTitleChanged) changes.push(`albumTitle: "${fixedAlbumTitle}"`);
                if (fileRenamed) changes.push(`renamed to: "${path.basename(newPath)}"`);

                this.logger.info(
                    `Fixed artist name consistency for "${originalPath}": ${changes.join(', ')}`,
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
     * Updates the artist, album artist, title, and/or album tags in the actual audio file.
     */
    #updateFileMetadata(filePath, artists, albumArtists, updateArtists, updateAlbumArtists, newTitle, newAlbumTitle) {
        const tagLibFile = File.createFromPath(filePath);

        try {
            if (updateArtists) {
                tagLibFile.tag.performers = artists;
            }

            if (updateAlbumArtists) {
                tagLibFile.tag.albumArtists = albumArtists;
            }

            if (newTitle !== undefined) {
                tagLibFile.tag.title = newTitle;
            }

            if (newAlbumTitle !== undefined) {
                tagLibFile.tag.album = newAlbumTitle;
            }

            tagLibFile.save();
        } finally {
            tagLibFile.dispose();
        }
    }

    /**
     * Collects the old->canonical name replacements for a track by comparing
     * original and fixed artist arrays.
     * Returns an array of { old: string, canonical: string } objects.
     */
    #collectReplacements(origArtists, fixedArtists, origAlbumArtists, fixedAlbumArtists) {
        const replacements = new Map(); // lowercased -> { old, canonical }

        for (let i = 0; i < origArtists.length; i++) {
            if (origArtists[i] !== fixedArtists.names[i]) {
                replacements.set(origArtists[i].toLowerCase(), {
                    old: origArtists[i],
                    canonical: fixedArtists.names[i],
                });
            }
        }

        for (let i = 0; i < origAlbumArtists.length; i++) {
            if (origAlbumArtists[i] !== fixedAlbumArtists.names[i]) {
                replacements.set(origAlbumArtists[i].toLowerCase(), {
                    old: origAlbumArtists[i],
                    canonical: fixedAlbumArtists.names[i],
                });
            }
        }

        return Array.from(replacements.values());
    }

    /**
     * Renames the file on disk if any artist names in the replacements list
     * appear in the filename. Only replaces in safe positions:
     *   1. The primary artist section (before the first " - ")
     *   2. Inside feat/ft/with parenthetical sections in the title
     * This avoids corrupting song titles that happen to contain artist names.
     * Returns the new path, or the original path if no rename was needed.
     */
    #renameFileIfNeeded(filePath, replacements) {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const baseName = path.basename(filePath, ext);

        const newBaseName = this.#replaceArtistNamesInFileName(baseName, replacements);

        if (newBaseName === baseName) {
            return filePath;
        }

        const newPath = path.join(dir, newBaseName + ext);

        // Don't rename if the target already exists (and is a genuinely different file).
        // On case-insensitive filesystems (Windows/macOS), a case-only rename like
        // "Glaive.flac" -> "glaive.flac" will report existsSync=true for the target
        // because it's the same file. We must allow those renames through.
        // Normalize both paths so separator differences (/ vs \) don't break the comparison.
        const normalizedOld = path.normalize(filePath).toLowerCase();
        const normalizedNew = path.normalize(newPath).toLowerCase();
        const isCaseOnlyRename = normalizedOld === normalizedNew;

        if (newPath !== filePath && fs.existsSync(newPath) && !isCaseOnlyRename) {
            this.logger.warn(
                `Cannot rename "${filePath}" to "${newPath}" because target already exists`,
                'ArtistNameConsistencyChecker',
                'renameFileIfNeeded',
            );
            return filePath;
        }

        fs.renameSync(filePath, newPath);

        this.logger.info(
            `Renamed file: "${path.basename(filePath)}" -> "${newBaseName}${ext}"`,
            'ArtistNameConsistencyChecker',
            'renameFileIfNeeded',
        );

        return newPath;
    }

    /**
     * Replaces artist names in a filename string, only when the filename follows
     * the "Artist - Title" format. Replacements happen in two safe positions:
     *   1. The primary artist section (before the first " - ")
     *   2. Inside feat/ft/with sections in the title (parentheses or brackets)
     * If the filename doesn't contain " - ", no renaming is attempted.
     * Returns the modified filename or the original if nothing changed.
     */
    #replaceArtistNamesInFileName(baseName, replacements) {
        const separatorIndex = baseName.indexOf(' - ');

        if (separatorIndex === -1) {
            // Not in "Artist - Title" format — don't touch it
            return baseName;
        }

        let artistPart = baseName.substring(0, separatorIndex);
        let titlePart = baseName.substring(separatorIndex); // includes " - "

        // 1. Replace in the artist part (before " - ") using whole-word matching
        for (const { old, canonical } of replacements) {
            artistPart = this.#replaceWholeWord(artistPart, old, canonical, true);
        }

        // 2. Replace inside feat/ft/with sections in the title part only
        titlePart = this.#replaceInFeatSections(titlePart, replacements);

        return artistPart + titlePart;
    }

    /**
     * Replaces a whole-word occurrence of `oldName` with `canonical` in `text`.
     * "Whole word" means the match must not be preceded/followed by a letter or digit,
     * preventing partial matches like "Red" inside "Redneck" or "Kid" inside "EsDeeKid".
     * @param {boolean} replaceAll - If true, replaces all occurrences; otherwise just the first.
     */
    #replaceWholeWord(text, oldName, canonical, replaceAll) {
        const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match the name only when it's not surrounded by word characters (letters/digits/underscore).
        // We use lookahead/lookbehind for boundaries since \b doesn't work well with special chars
        // like $ or ! that often appear in artist names (e.g. "Joey Bada$", "Autumn!").
        const flags = replaceAll ? 'gi' : 'i';
        const regex = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, flags);

        return text.replace(regex, (match) => {
            if (match !== canonical) {
                return canonical;
            }
            return match;
        });
    }

    /**
     * Finds feat/ft/with sections in the title and replaces artist names within them.
     * Matches patterns like: (feat. ...), (ft. ...), (with ...), [feat. ...], [with ...],
     * (FEAT. ...), etc. — case-insensitive.
     */
    #replaceInFeatSections(titlePart, replacements) {
        // Match (feat. ...), (ft. ...), (with ...) and square bracket equivalents
        const featRegex = /([(\[](?:feat\.?|ft\.?|with)\s)(.*?)([)\]])/gi;

        return titlePart.replace(featRegex, (fullMatch, prefix, artistContent, suffix) => {
            let fixedContent = artistContent;
            for (const { old, canonical } of replacements) {
                fixedContent = this.#replaceWholeWord(fixedContent, old, canonical, true);
            }
            return prefix + fixedContent + suffix;
        });
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

    /**
     * Organizes triggering tracks into Artist/Album folder structure within their
     * library folder. Creates artist and album directories as needed and moves files.
     * @param {Array} tracks - The tracks to organize (should be freshly fetched from DB)
     */
    #organizeIntoArtistFolders(tracks) {
        const folders = this.folderRepository.getFolders() ?? [];

        if (folders.length === 0) {
            return;
        }

        // Track which source directories had files moved out, and where they went.
        // Key: normalized source dir (lowercase), Value: destination dir
        const movedFromTo = new Map();

        for (const track of tracks) {
            try {
                const libraryFolder = this.#findLibraryFolder(track.path, folders);

                if (!libraryFolder) {
                    continue;
                }

                const albumArtists = this.#parseDelimitedString(track.albumArtists);
                const artists = this.#parseDelimitedString(track.artists);
                const primaryArtist = albumArtists[0] || artists[0];

                if (!primaryArtist) {
                    continue;
                }

                const artistFolder = this.#sanitizeFolderName(primaryArtist);
                const fileName = path.basename(track.path);

                let destination;

                if (track.albumTitle) {
                    const albumFolder = this.#sanitizeFolderName(track.albumTitle);
                    destination = path.join(libraryFolder, artistFolder, albumFolder, fileName);
                } else {
                    // Single track — place directly in artist folder
                    destination = path.join(libraryFolder, artistFolder, fileName);
                }

                const normalizedSource = path.normalize(track.path);
                const normalizedDest = path.normalize(destination);

                if (normalizedSource.toLowerCase() === normalizedDest.toLowerCase()) {
                    continue;
                }

                if (fs.existsSync(destination)) {
                    this.logger.warn(
                        `Cannot move "${track.path}" to "${destination}" because target already exists`,
                        'ArtistNameConsistencyChecker',
                        'organizeIntoArtistFolders',
                    );
                    continue;
                }

                const sourceDir = path.dirname(normalizedSource);
                const destDir = path.dirname(normalizedDest);

                fs.mkdirSync(destDir, { recursive: true });
                fs.renameSync(track.path, destination);

                track.path = destination;
                track.fileName = path.basename(destination);
                this.trackRepository.updateTrack(track);

                movedFromTo.set(sourceDir.toLowerCase(), { sourceDir, destDir });

                this.logger.info(
                    `Organized file into artist folder: "${normalizedSource}" -> "${normalizedDest}"`,
                    'ArtistNameConsistencyChecker',
                    'organizeIntoArtistFolders',
                );
            } catch (e) {
                this.logger.error(
                    e,
                    `Failed to organize file "${track.path}" into artist folder`,
                    'ArtistNameConsistencyChecker',
                    'organizeIntoArtistFolders',
                );
            }
        }

        // Move companion files (covers, playlists, etc.) left behind in source folders
        this.#moveCompanionFiles(movedFromTo, folders);
    }

    /**
     * Moves non-audio companion files (cover art, playlists, etc.) from source
     * directories where audio files were moved out, then removes empty directories.
     * @param {Map} movedFromTo - Map of lowercase source dir -> { sourceDir, destDir }
     * @param {Array} folders - Library folders from the folder repository
     */
    #moveCompanionFiles(movedFromTo, folders) {
        for (const { sourceDir, destDir } of movedFromTo.values()) {
            try {
                if (!fs.existsSync(sourceDir)) {
                    continue;
                }

                const remaining = fs.readdirSync(sourceDir);

                for (const fileName of remaining) {
                    const sourcePath = path.join(sourceDir, fileName);

                    // Skip directories — only move files
                    if (fs.statSync(sourcePath).isDirectory()) {
                        continue;
                    }

                    const destPath = path.join(destDir, fileName);

                    if (fs.existsSync(destPath)) {
                        this.logger.warn(
                            `Cannot move companion file "${sourcePath}" to "${destPath}" because target already exists`,
                            'ArtistNameConsistencyChecker',
                            'moveCompanionFiles',
                        );
                        continue;
                    }

                    fs.renameSync(sourcePath, destPath);

                    this.logger.info(
                        `Moved companion file: "${sourcePath}" -> "${destPath}"`,
                        'ArtistNameConsistencyChecker',
                        'moveCompanionFiles',
                    );
                }
            } catch (e) {
                this.logger.error(
                    e,
                    `Failed to move companion files from "${sourceDir}"`,
                    'ArtistNameConsistencyChecker',
                    'moveCompanionFiles',
                );
            }
        }

        // Remove empty directories left behind within library folders
        this.#removeEmptyDirectories(movedFromTo, folders);
    }

    /**
     * Removes empty directories left behind after files were moved.
     * Walks from deepest to shallowest, stopping at the library folder root.
     * @param {Map} movedFromTo - Map of lowercase source dir -> { sourceDir, destDir }
     * @param {Array} folders - Library folders from the folder repository
     */
    #removeEmptyDirectories(movedFromTo, folders) {
        for (const { sourceDir } of movedFromTo.values()) {
            let current = sourceDir;

            while (current) {
                try {
                    // Don't remove the library root folder itself
                    const isLibraryRoot = folders.some(
                        (f) => path.normalize(f.path).toLowerCase() === current.toLowerCase(),
                    );

                    if (isLibraryRoot) {
                        break;
                    }

                    if (!fs.existsSync(current)) {
                        current = path.dirname(current);
                        continue;
                    }

                    const contents = fs.readdirSync(current);

                    if (contents.length > 0) {
                        break;
                    }

                    fs.rmdirSync(current);

                    this.logger.info(
                        `Removed empty directory: "${current}"`,
                        'ArtistNameConsistencyChecker',
                        'removeEmptyDirectories',
                    );

                    current = path.dirname(current);
                } catch (e) {
                    this.logger.error(
                        e,
                        `Failed to remove empty directory "${current}"`,
                        'ArtistNameConsistencyChecker',
                        'removeEmptyDirectories',
                    );
                    break;
                }
            }
        }
    }

    /**
     * Finds the library folder that contains the given track path.
     * Returns the normalized folder path, or null if no match is found.
     */
    #findLibraryFolder(trackPath, folders) {
        const normalized = path.normalize(trackPath).toLowerCase();

        for (const folder of folders) {
            const folderPath = path.normalize(folder.path).toLowerCase();

            if (normalized.startsWith(folderPath)) {
                return path.normalize(folder.path);
            }
        }

        return null;
    }

    /**
     * Sanitizes a string for use as a folder name by removing invalid filesystem characters.
     */
    #sanitizeFolderName(name) {
        if (!name) {
            return 'Unknown';
        }

        let sanitized = name;
        const replacements = {
            ':': ' -',
            '/': '-',
            '\\': '-',
            '|': '-',
            '?': '',
            '*': '',
            '"': "'",
            '<': '',
            '>': '',
        };

        for (const [char, replacement] of Object.entries(replacements)) {
            sanitized = sanitized.split(char).join(replacement);
        }

        sanitized = sanitized.replace(/\s+/g, ' ').trim();
        sanitized = sanitized.replace(/[. ]+$/, '');

        return sanitized || 'Unknown';
    }
}

exports.ArtistNameConsistencyChecker = ArtistNameConsistencyChecker;
