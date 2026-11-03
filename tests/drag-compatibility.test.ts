import { describe, expect, it } from 'vitest';
import { assessPermissions, type PermissionScan } from '../electron/drag-compatibility';

const scan = (self: number | null, targets: Array<number | null>): PermissionScan => ({
  self: { app: 'Capture Shelf', pid: 1, integrity: self },
  targets: targets.map((integrity, index) => ({ app: index ? 'Feishu' : 'WeChat', pid: index + 2, integrity })),
});

describe('Windows cross-application drag permissions', () => {
  it('detects both directions of permission mismatch without recommending elevation', () => {
    expect(assessPermissions(scan(8192, [12288])).status).toBe('mismatch');
    expect(assessPermissions(scan(12288, [8192])).status).toBe('mismatch');
  });
  it('does not present matching permissions as proof that a chat accepts files', () => {
    expect(assessPermissions(scan(8192, [8192, 8192])).status).toBe('same');
  });
  it('keeps unreadable process tokens and absent clients inconclusive', () => {
    expect(assessPermissions(scan(null, [8192])).status).toBe('unknown');
    expect(assessPermissions(scan(8192, [null])).status).toBe('unknown');
    expect(assessPermissions(scan(8192, [])).status).toBe('not-running');
    expect(assessPermissions(scan(8192, [8192, null])).status).toBe('unknown');
  });
  it('still reports a known mismatch when another client cannot be inspected', () => {
    const result = assessPermissions(scan(8192, [12288, null]));
    expect(result.status).toBe('mismatch');
    expect(result.mismatched).toEqual(['WeChat']);
  });
});
