import * as assert from 'assert';
import { createDateService, formatGitHubRelativeDate } from '../../dateService';

suite('Date service', () => {
  test('formats GitHub-style short relative dates', () => {
    const now = Date.parse('2026-09-15T16:00:00Z');

    assert.strictEqual(formatGitHubRelativeDate('2026-09-15T15:59:55Z', now), 'now');
    assert.strictEqual(formatGitHubRelativeDate('2026-09-15T15:59:15Z', now), '45s ago');
    assert.strictEqual(formatGitHubRelativeDate('2026-09-15T15:15:00Z', now), '45m ago');
    assert.strictEqual(formatGitHubRelativeDate('2026-09-15T13:00:00Z', now), '3h ago');
    assert.strictEqual(formatGitHubRelativeDate('2026-09-13T16:00:00Z', now), '2d ago');
    assert.strictEqual(formatGitHubRelativeDate('2026-09-08T16:00:00Z', now), '1w ago');
    assert.strictEqual(formatGitHubRelativeDate('2026-07-17T16:00:00Z', now), '2mo ago');
    assert.strictEqual(formatGitHubRelativeDate('2024-09-15T16:00:00Z', now), '2y ago');
  });

  test('prefers created timestamps and keeps drafts pending', () => {
    const dateService = createDateService(() => Date.parse('2026-09-15T16:00:00Z'));

    assert.strictEqual(dateService.formatCommentTimestamp({
      createdAt: '2026-09-08T16:00:00Z',
      updatedAt: '2026-09-15T15:00:00Z',
      isDraft: false,
    }), '1w ago');
    assert.strictEqual(dateService.formatCommentTimestamp({
      createdAt: undefined,
      updatedAt: '2026-09-15T15:00:00Z',
      isDraft: false,
    }), '1h ago');
    assert.strictEqual(dateService.formatCommentTimestamp({
      createdAt: '2026-09-08T16:00:00Z',
      updatedAt: '2026-09-15T15:00:00Z',
      isDraft: true,
    }), 'pending');
  });
});
