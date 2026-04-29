export class ReleaseNameKey {
    public static fromArtistName(name: string): string {
        return (name ?? '').trim().toLowerCase();
    }
}
