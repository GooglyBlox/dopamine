export interface LoopPoints {
    startSeconds: number;
    endSeconds: number;
    isEnabled: boolean;
}

export class DefaultLoopPoints implements LoopPoints {
    public startSeconds: number = 0;
    public endSeconds: number = 0;
    public isEnabled: boolean = false;

    public constructor(startSeconds: number = 0, endSeconds: number = 0, isEnabled: boolean = false) {
        this.startSeconds = startSeconds;
        this.endSeconds = endSeconds;
        this.isEnabled = isEnabled;
    }

    public static createDisabled(): DefaultLoopPoints {
        return new DefaultLoopPoints(0, 0, false);
    }

    public static createFromTrack(totalSeconds: number): DefaultLoopPoints {
        return new DefaultLoopPoints(0, totalSeconds, false);
    }
} 