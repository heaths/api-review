import * as assert from 'assert';
import { MemoryCache } from '../../cache';

suite('Cache', () => {
  test('stores values with metadata', () => {
    const cache = new MemoryCache();
    cache.set('pull-request', {
      value: { title: 'Update API' },
      etag: 'W/"etag"',
      fetchedAt: 42,
    });

    assert.deepStrictEqual(cache.get<{ title: string }>('pull-request'), {
      value: { title: 'Update API' },
      etag: 'W/"etag"',
      fetchedAt: 42,
    });
  });

  test('deletes individual entries', () => {
    const cache = new MemoryCache();
    cache.set('a', { value: 1, fetchedAt: 1 });

    cache.delete('a');

    assert.strictEqual(cache.get<number>('a'), undefined);
  });

  test('clears all entries', () => {
    const cache = new MemoryCache();
    cache.set('a', { value: 1, fetchedAt: 1 });
    cache.set('b', { value: 2, fetchedAt: 2 });

    cache.clear();

    assert.strictEqual(cache.get<number>('a'), undefined);
    assert.strictEqual(cache.get<number>('b'), undefined);
  });
});
