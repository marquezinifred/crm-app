import { describe, it, expect, beforeEach } from 'vitest';
import { __test } from '@/server/services/document-compare.service';

describe('document compare — fallback metadata', () => {
  beforeEach(() => __test.breaker.__reset());

  it('emptyResult com source=metadata', () => {
    const r = __test.emptyResult('metadata');
    expect(r.source).toBe('metadata');
    expect(r.scopeChanges).toEqual([]);
    expect(r.itemsAdded).toEqual([]);
    expect(r.valueChange.absolute).toBeNull();
  });

  it('circuit breaker abre após 3 falhas', () => {
    __test.breaker.recordFailure();
    __test.breaker.recordFailure();
    expect(__test.breaker.isOpen()).toBe(false);
    __test.breaker.recordFailure();
    expect(__test.breaker.isOpen()).toBe(true);
  });

  it('recordSuccess fecha o circuit', () => {
    __test.breaker.recordFailure();
    __test.breaker.recordFailure();
    __test.breaker.recordFailure();
    expect(__test.breaker.isOpen()).toBe(true);
    __test.breaker.recordSuccess();
    expect(__test.breaker.isOpen()).toBe(false);
  });
});
