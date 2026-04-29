export class ReleaseDateUtils {
    public static toSortValue(dateString: string | undefined): number {
        if (dateString == undefined || dateString.length === 0) {
            return 0;
        }
        const parts = dateString.split('-');
        const year = parseInt(parts[0], 10);
        const month = parts.length > 1 ? parseInt(parts[1], 10) : 1;
        const day = parts.length > 2 ? parseInt(parts[2], 10) : 1;
        if (isNaN(year)) {
            return 0;
        }
        const safeMonth = isNaN(month) ? 1 : month;
        const safeDay = isNaN(day) ? 1 : day;
        return year * 10000 + safeMonth * 100 + safeDay;
    }

    public static toEpoch(dateString: string | undefined): number {
        if (dateString == undefined || dateString.length === 0) {
            return 0;
        }
        const parts = dateString.split('-');
        const year = parseInt(parts[0], 10);
        const month = parts.length > 1 ? parseInt(parts[1], 10) : 1;
        const day = parts.length > 2 ? parseInt(parts[2], 10) : 1;
        if (isNaN(year)) {
            return 0;
        }
        return Date.UTC(year, (isNaN(month) ? 1 : month) - 1, isNaN(day) ? 1 : day);
    }

    public static todaySortValue(): number {
        const now = new Date();
        return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    }

    public static daysFromTodaySortValue(days: number): number {
        const now = new Date();
        now.setDate(now.getDate() + days);
        return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    }
}
