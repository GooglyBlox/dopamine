import { Component, Inject, ViewEncapsulation } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DuplicateGroup } from '../../../../services/duplicate/duplicate-group';
import { TrackModel } from '../../../../services/track/track-model';

@Component({
    selector: 'app-duplicate-tracks-dialog',
    templateUrl: './duplicate-tracks-dialog.component.html',
    styleUrls: ['./duplicate-tracks-dialog.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class DuplicateTracksDialogComponent {
    public selectedTracks: Set<TrackModel> = new Set();

    public constructor(
        @Inject(MAT_DIALOG_DATA) public duplicateGroups: DuplicateGroup[],
        private dialogRef: MatDialogRef<DuplicateTracksDialogComponent>,
    ) {
        dialogRef.disableClose = true;
    }

    public isSelected(track: TrackModel): boolean {
        return this.selectedTracks.has(track);
    }

    public toggleTrack(track: TrackModel): void {
        if (this.selectedTracks.has(track)) {
            this.selectedTracks.delete(track);
        } else {
            this.selectedTracks.add(track);
        }
    }

    public get selectedCount(): number {
        return this.selectedTracks.size;
    }

    public removeSelected(): void {
        this.dialogRef.close(Array.from(this.selectedTracks));
    }

    public close(): void {
        this.dialogRef.close([]);
    }

    public formatDuration(durationMs: number): string {
        const totalSeconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    public formatFileSize(bytes: number): string {
        if (bytes === 0) {
            return '0 B';
        }
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
    }
}
