export interface DateService {
  formatCommentTimestamp(comment: { readonly createdAt?: string; readonly updatedAt?: string; readonly isDraft: boolean }): string | undefined;
}

export function createDateService(now: () => number = () => Date.now()): DateService {
  return {
    formatCommentTimestamp(comment) {
      if (comment.isDraft) {
        return 'pending';
      }

      const timestamp = comment.createdAt ?? comment.updatedAt;
      return timestamp ? formatGitHubRelativeDate(timestamp, now()) : undefined;
    },
  };
}

export function formatGitHubRelativeDate(value: string, now = Date.now()): string | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  const elapsedMilliseconds = Math.max(0, now - timestamp);
  const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
  if (elapsedSeconds < 10) {
    return 'now';
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays}d ago`;
  }

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedDays < 30) {
    return `${elapsedWeeks}w ago`;
  }

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedDays < 365) {
    return `${elapsedMonths}mo ago`;
  }

  const elapsedYears = Math.floor(elapsedDays / 365);
  return `${elapsedYears}y ago`;
}
