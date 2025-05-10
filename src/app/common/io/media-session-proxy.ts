import { Injectable } from '@angular/core';

@Injectable({providedIn: 'root'})
export class MediaSessionProxy {
    public setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler): void {
        window.navigator.mediaSession.setActionHandler(action, handler);
    }

    public clearActionHandler(action: MediaSessionAction): void {
        window.navigator.mediaSession.setActionHandler(action, () => undefined);
    }

    public setMetadata(title: string, artist: string, album: string, artwork: string): void {
        window.navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            album: album,
            artwork: [
                {
                    src: artwork,
                },
            ],
        });
    }

    public clearMetadata(): void {
        window.navigator.mediaSession.metadata = null;
    }
    
    public setPositionState(duration: number, position: number, playbackRate: number = 1): void {
        if (typeof window.navigator.mediaSession.setPositionState === 'function') {
            // Ensure position is never greater than duration
            // If duration is 0 or invalid, don't set position state
            if (duration > 0) {
                const validPosition = Math.min(position, duration);
                
                window.navigator.mediaSession.setPositionState({
                    duration: duration,
                    position: validPosition,
                    playbackRate: playbackRate
                });
            }
        }
    }
}
