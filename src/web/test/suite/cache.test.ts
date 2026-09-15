import * as assert from 'assert';
import { MemoryCache } from '../../cache';

suite('Cache', () => {
  test('stores values with metadata', () => {
    const cache = new MemoryCache({ now: () => 100 });
    cache.set('pull-request', {
      value: { title: 'Update API' },
      etag: 'W/"etag"',
      fetchedAt: 42,
    });

    const entry = cache.get<{ title: string }>('pull-request');
    assert.deepStrictEqual(entry?.value, { title: 'Update API' });
    assert.strictEqual(entry?.etag, 'W/"etag"');
    assert.strictEqual(entry?.fetchedAt, 42);
    assert.strictEqual(entry?.lastAccessedAt, 100);
    assert.ok((entry?.size ?? 0) > 0);
  });

  test('updates the last accessed time on reads', () => {
    const times = [10, 25];
    const cache = new MemoryCache({ now: () => times.shift() ?? 25 });
    cache.set('a', { value: 1, fetchedAt: 1 });

    assert.strictEqual(cache.get<number>('a')?.lastAccessedAt, 25);
  });

  test('evicts the least recently accessed entry when over the size limit', () => {
    let now = 0;
    const cache = new MemoryCache({
      maxSize: 3,
      now: () => ++now,
      sizeCalculation: (_key, entry) => String(entry.value).length,
    });

    cache.set('a', { value: 'a', fetchedAt: 1 });
    cache.set('b', { value: 'b', fetchedAt: 2 });
    cache.get('a');
    cache.set('c', { value: 'c', fetchedAt: 3 });
    cache.set('d', { value: 'd', fetchedAt: 4 });

    assert.strictEqual(cache.get<string>('a')?.value, 'a');
    assert.strictEqual(cache.get<string>('b'), undefined);
    assert.strictEqual(cache.get<string>('c')?.value, 'c');
    assert.strictEqual(cache.get<string>('d')?.value, 'd');
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
