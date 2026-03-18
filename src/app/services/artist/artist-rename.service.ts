import * as fs from 'fs-extra';
import { Injectable } from '@angular/core';
import { Logger } from '../../common/logger';
import { FileAccessBase } from '../../common/io/file-access.base';
import { TrackRepositoryBase } from '../../data/repositories/track-repository.base';
import { FolderRepositoryBase } from '../../data/repositories/folder-repository.base';
import { Track } from '../../data/entities/track';
import { DataDelimiter } from '../../data/data-delimiter';
import { FileMetadataFactoryBase } from '../../common/metadata/file-metadata.factory.base';
import { IndexingService } from '../indexing/indexing.service';
import { Folder } from '../../data/entities/folder';

@Injectable()
export class ArtistRenameService {
    public constructor(
        private trackRepository: TrackRepositoryBase,
        private folderRepository: FolderRepositoryBase,
        private fileAccess: FileAccessBase,
        private fileMetadataFactory: FileMetadataFactoryBase,
        private indexingService: IndexingService,
        private logger: Logger,
    ) {}

    public async renameArtistAsync(oldName: string, newName: string): Promise<void> {
        if (!oldName || !newName || oldName === newName) {
            return;
        }

        this.logger.info(`Renaming artist "${oldName}" to "${newName}"`, 'ArtistRenameService', 'renameArtistAsync');

        // Step 1: Find all tracks where this artist appears (as track artist or album artist)
        const tracksAsTrackArtist: Track[] = this.trackRepository.getTracksForTrackArtists([oldName]) ?? [];
        const tracksAsAlbumArtist: Track[] = this.trackRepository.getTracksForAlbumArtists([oldName]) ?? [];

        // Merge unique tracks by trackId
        const allTrackMap = new Map<number, Track>();
        for (const t of tracksAsTrackArtist) {
            allTrackMap.set(t.trackId, t);
        }
        for (const t of tracksAsAlbumArtist) {
            allTrackMap.set(t.trackId, t);
        }
        const allTracks = Array.from(allTrackMap.values());

        this.logger.info(`Found ${allTracks.length} tracks to update`, 'ArtistRenameService', 'renameArtistAsync');

        // Step 2: Update file metadata tags for all tracks
        for (const track of allTracks) {
            try {
                await this.updateFileMetadata(track.path, oldName, newName);
            } catch (e: unknown) {
                this.logger.error(e, `Failed to update metadata for "${track.path}"`, 'ArtistRenameService', 'renameArtistAsync');
            }
        }

        // Step 3: Rename audio files that contain the old artist name in the filename
        // Also collect the directories that contained renamed files so we can handle companion files
        const affectedDirectories = new Set<string>();
        for (const track of allTracks) {
            try {
                const directory = this.fileAccess.getDirectoryPath(track.path);
                affectedDirectories.add(directory);

                const newPath = this.renameTrackFile(track.path, oldName, newName);
                if (newPath !== track.path) {
                    track.path = newPath;
                    track.fileName = this.fileAccess.getFileName(newPath);
                }
            } catch (e: unknown) {
                this.logger.error(e, `Failed to rename file "${track.path}"`, 'ArtistRenameService', 'renameArtistAsync');
            }
        }

        // Step 4: Rename companion files (m3u playlists, etc.) in affected directories
        for (const dir of affectedDirectories) {
            try {
                this.renameCompanionFiles(dir, oldName, newName);
            } catch (e: unknown) {
                this.logger.error(e, `Failed to rename companion files in "${dir}"`, 'ArtistRenameService', 'renameArtistAsync');
            }
        }

        // Step 5: Update database artist fields for all tracks
        for (const track of allTracks) {
            try {
                this.updateTrackArtistFields(track, oldName, newName);
                this.trackRepository.updateTrack(track);
            } catch (e: unknown) {
                this.logger.error(e, `Failed to update DB for track "${track.path}"`, 'ArtistRenameService', 'renameArtistAsync');
            }
        }

        // Step 6: Rename artist folder(s) in library folders
        // Windows may hold file handles briefly after metadata writes, so retry with delays
        await this.renameArtistFoldersWithRetry(oldName, newName);

        // Step 7: Trigger a re-index to refresh the UI
        this.indexingService.indexCollectionAlways();
    }

    private updateTrackArtistFields(track: Track, oldName: string, newName: string): void {
        if (track.artists) {
            track.artists = this.replaceArtistInDelimitedString(track.artists, oldName, newName);
        }
        if (track.albumArtists) {
            track.albumArtists = this.replaceArtistInDelimitedString(track.albumArtists, oldName, newName);
        }
    }

    private replaceArtistInDelimitedString(delimitedString: string, oldName: string, newName: string): string {
        const artists = DataDelimiter.fromDelimitedString(delimitedString);
        const updatedArtists = artists.map((a) => (a.toLowerCase() === oldName.toLowerCase() ? newName : a));
        return DataDelimiter.toDelimitedString(updatedArtists);
    }

    private async updateFileMetadata(filePath: string, oldName: string, newName: string): Promise<void> {
        if (!this.fileAccess.pathExists(filePath)) {
            this.logger.warn(`File not found for metadata update: "${filePath}"`, 'ArtistRenameService', 'updateFileMetadata');
            return;
        }

        const metadata = await this.fileMetadataFactory.createAsync(filePath);

        let changed = false;

        const newArtists = metadata.artists.map((a: string) => (a.toLowerCase() === oldName.toLowerCase() ? newName : a));
        if (JSON.stringify(newArtists) !== JSON.stringify(metadata.artists)) {
            metadata.artists = newArtists;
            changed = true;
        }

        const newAlbumArtists = metadata.albumArtists.map((a: string) => (a.toLowerCase() === oldName.toLowerCase() ? newName : a));
        if (JSON.stringify(newAlbumArtists) !== JSON.stringify(metadata.albumArtists)) {
            metadata.albumArtists = newAlbumArtists;
            changed = true;
        }

        if (changed) {
            metadata.save();
            this.logger.info(`Updated metadata for "${filePath}"`, 'ArtistRenameService', 'updateFileMetadata');
        }
    }

    private renameTrackFile(filePath: string, oldName: string, newName: string): string {
        if (!this.fileAccess.pathExists(filePath)) {
            return filePath;
        }

        const fileName = this.fileAccess.getFileNameWithoutExtension(filePath);
        const extension = this.fileAccess.getFileExtension(filePath);
        const directory = this.fileAccess.getDirectoryPath(filePath);

        const newFileName = this.replaceArtistInFileName(fileName, oldName, newName);

        if (newFileName === fileName) {
            return filePath;
        }

        const newFilePath = this.fileAccess.combinePath([directory, `${newFileName}${extension}`]);

        this.caseAwareRename(filePath, newFilePath);

        this.logger.info(`Renamed file "${filePath}" to "${newFilePath}"`, 'ArtistRenameService', 'renameTrackFile');

        return newFilePath;
    }

    private replaceArtistInFileName(fileName: string, oldName: string, newName: string): string {
        // Replace at the beginning of the filename (primary artist position, before first " - ")
        // Format: "Artist - Album - NN - Title"
        const dashIndex = fileName.indexOf(' - ');
        if (dashIndex > -1) {
            const artistPart = fileName.substring(0, dashIndex);
            if (artistPart.toLowerCase() === oldName.toLowerCase()) {
                return newName + fileName.substring(dashIndex);
            }
        }

        return fileName;
    }

    private renameCompanionFiles(directory: string, oldName: string, newName: string): void {
        if (!this.fileAccess.pathExists(directory)) {
            return;
        }

        let files: string[];
        try {
            files = this.fileAccess.getFilesInDirectory(directory);
        } catch {
            return;
        }

        for (const filePath of files) {
            const ext = this.fileAccess.getFileExtension(filePath).toLowerCase();

            // Handle m3u playlist files
            if (ext === '.m3u' || ext === '.m3u8') {
                this.renameM3uFile(filePath, oldName, newName);
            }
        }
    }

    private renameM3uFile(filePath: string, oldName: string, newName: string): void {
        // Step 1: Update the content of the m3u file (replace artist references)
        try {
            let content = this.fileAccess.getFileContentAsString(filePath);
            const oldContent = content;

            // Replace artist name in EXTINF lines and file reference lines
            // Be careful to only replace the artist portion, not random occurrences
            content = this.replaceArtistInM3uContent(content, oldName, newName);

            if (content !== oldContent) {
                this.fileAccess.writeToFile(filePath, content);
                this.logger.info(`Updated m3u content in "${filePath}"`, 'ArtistRenameService', 'renameM3uFile');
            }
        } catch (e: unknown) {
            this.logger.error(e, `Failed to update m3u content in "${filePath}"`, 'ArtistRenameService', 'renameM3uFile');
        }

        // Step 2: Rename the m3u file itself if it contains the artist name
        // Format: "Artist - Album.m3u"
        const fileName = this.fileAccess.getFileNameWithoutExtension(filePath);
        const ext = this.fileAccess.getFileExtension(filePath);
        const directory = this.fileAccess.getDirectoryPath(filePath);

        const newFileName = this.replaceArtistInFileName(fileName, oldName, newName);
        if (newFileName !== fileName) {
            const newFilePath = this.fileAccess.combinePath([directory, `${newFileName}${ext}`]);
            this.caseAwareRename(filePath, newFilePath);
            this.logger.info(`Renamed m3u file "${filePath}" to "${newFilePath}"`, 'ArtistRenameService', 'renameM3uFile');
        }
    }

    private replaceArtistInM3uContent(content: string, oldName: string, newName: string): string {
        // Replace artist references in EXTINF lines
        // Format: #EXTINF:127,Artist - title  or  #EXTINF:127,Artist, OtherArtist - title
        // Also replace in file reference lines: NN - Artist, OtherArtist - title.flac
        const lines = content.split('\n');
        const updatedLines = lines.map((line) => {
            if (line.startsWith('#EXTINF:')) {
                // Replace artist name after the comma in EXTINF
                return this.replaceWholeWordCaseInsensitive(line, oldName, newName);
            } else if (line.startsWith('#')) {
                // Other comment lines - leave alone
                return line;
            } else if (line.trim() !== '') {
                // File reference line - replace artist name
                return this.replaceWholeWordCaseInsensitive(line, oldName, newName);
            }
            return line;
        });

        return updatedLines.join('\n');
    }

    private replaceWholeWordCaseInsensitive(text: string, oldName: string, newName: string): string {
        // Escape special regex characters in the artist name
        const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        return text.replace(regex, newName);
    }

    private async renameArtistFoldersWithRetry(oldName: string, newName: string, maxRetries: number = 5): Promise<void> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.renameArtistFolders(oldName, newName);
                return;
            } catch (e: unknown) {
                if (attempt < maxRetries) {
                    this.logger.info(
                        `Folder rename attempt ${attempt} failed, retrying in 500ms...`,
                        'ArtistRenameService',
                        'renameArtistFoldersWithRetry',
                    );
                    await new Promise((resolve) => setTimeout(resolve, 500));
                } else {
                    this.logger.error(
                        e,
                        `Failed to rename artist folder after ${maxRetries} attempts`,
                        'ArtistRenameService',
                        'renameArtistFoldersWithRetry',
                    );
                }
            }
        }
    }

    private renameArtistFolders(oldName: string, newName: string): void {
        const folders: Folder[] = this.folderRepository.getFolders() ?? [];

        for (const folder of folders) {
            const libraryPath = folder.path;

            if (!this.fileAccess.pathExists(libraryPath)) {
                continue;
            }

            // Find the artist folder (case-insensitive on Windows)
            const existingFolder = this.findArtistFolderCaseInsensitive(libraryPath, oldName);
            if (existingFolder != undefined) {
                const newArtistFolderPath = this.fileAccess.combinePath([libraryPath, newName]);
                this.caseAwareRename(existingFolder, newArtistFolderPath);
                this.logger.info(
                    `Renamed artist folder "${existingFolder}" to "${newArtistFolderPath}"`,
                    'ArtistRenameService',
                    'renameArtistFolders',
                );
            }
        }
    }

    private findArtistFolderCaseInsensitive(libraryPath: string, artistName: string): string | undefined {
        try {
            const allEntries: string[] = fs.readdirSync(libraryPath);
            for (const entry of allEntries) {
                if (entry.toLowerCase() === artistName.toLowerCase()) {
                    const fullPath = this.fileAccess.combinePath([libraryPath, entry]);
                    try {
                        if (fs.lstatSync(fullPath).isDirectory()) {
                            return fullPath;
                        }
                    } catch {
                        // skip
                    }
                }
            }
        } catch (e: unknown) {
            this.logger.error(
                e,
                `Failed to search for artist folder in "${libraryPath}"`,
                'ArtistRenameService',
                'findArtistFolderCaseInsensitive',
            );
        }
        return undefined;
    }

    /**
     * Handles renaming on Windows where case-only changes need a two-step rename
     * (e.g., "Asteria" -> "asteria" requires "Asteria" -> "Asteria_tmp" -> "asteria")
     */
    private caseAwareRename(oldPath: string, newPath: string): void {
        if (oldPath === newPath) {
            return;
        }

        if (oldPath.toLowerCase() === newPath.toLowerCase()) {
            // Case-only change on Windows: use temp intermediate name
            const tempPath = oldPath + '_rename_tmp_' + Date.now();
            this.fileAccess.renameFileOrDirectory(oldPath, tempPath);
            this.fileAccess.renameFileOrDirectory(tempPath, newPath);
        } else {
            this.fileAccess.renameFileOrDirectory(oldPath, newPath);
        }
    }
}
