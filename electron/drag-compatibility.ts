import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export interface PermissionProcess {
  app: 'Capture Shelf' | 'WeChat' | 'Feishu';
  pid: number;
  integrity: number | null;
  version?: string;
}
export interface PermissionScan { self: PermissionProcess | null; targets: PermissionProcess[] }
export function assessPermissions(scan: PermissionScan) {
  const own = scan.self?.integrity;
  const mismatched = scan.targets.filter((target) => own != null && target.integrity != null && target.integrity !== own).map((target) => target.app);
  const status = mismatched.length ? 'mismatch' : !scan.targets.length ? 'not-running'
    : own == null || scan.targets.some((target) => target.integrity == null) ? 'unknown' : 'same';
  return { status, mismatched: [...new Set(mismatched)] };
}

export async function inspectWindowsPermissions(script: string): Promise<PermissionScan> {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Read through Electron's filesystem so this also works inside packaged app.asar.
  const source = await fs.readFile(script, 'utf8');
  const command = Buffer.from(`& {\n${source}\n} -ShelfProcessId ${process.pid}`, 'utf16le').toString('base64');
  const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
    windowsHide: true, timeout: 10000, maxBuffer: 65536, encoding: 'utf8',
  });
  const data = JSON.parse(stdout.replace(/^\uFEFF/, '')) as PermissionScan;
  if (!Array.isArray(data.targets) || data.targets.length > 128) throw new Error('Invalid permission scan');
  const clean = (entry: PermissionProcess): PermissionProcess => {
    if (!entry || !['Capture Shelf', 'WeChat', 'Feishu'].includes(entry.app) || !Number.isInteger(entry.pid)) throw new Error('Invalid process entry');
    return { app: entry.app, pid: entry.pid, integrity: Number.isInteger(entry.integrity) && Number(entry.integrity) >= 0 ? entry.integrity : null,
      version: typeof entry.version === 'string' && /^[\d. ,()-]{1,60}$/.test(entry.version) ? entry.version : undefined };
  };
  return { self: data.self ? clean(data.self) : null, targets: data.targets.map(clean) };
}
