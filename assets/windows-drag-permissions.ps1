param([Parameter(Mandatory=$true)][int]$ShelfProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShelfDragToken {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr data, int length, out int needed);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    public static int Read(int pid) {
        IntPtr process = OpenProcess(0x1000, false, pid), token = IntPtr.Zero, data = IntPtr.Zero;
        try {
            if (process == IntPtr.Zero || !OpenProcessToken(process, 8, out token)) return -1;
            int needed;
            GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
            if (needed <= 0) return -1;
            data = Marshal.AllocHGlobal(needed);
            if (!GetTokenInformation(token, 25, data, needed, out needed)) return -1;
            IntPtr sid = Marshal.ReadIntPtr(data);
            byte count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
            return Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
        } finally {
            if (data != IntPtr.Zero) Marshal.FreeHGlobal(data);
            if (token != IntPtr.Zero) CloseHandle(token);
            if (process != IntPtr.Zero) CloseHandle(process);
        }
    }
}
'@
function Get-ShelfProcessEntry($shelfProcess, [string]$appName) {
    $level = [ShelfDragToken]::Read($shelfProcess.Id)
    $version = $null
    try { $version = $shelfProcess.MainModule.FileVersionInfo.FileVersion } catch {}
    [pscustomobject]@{ app=$appName; pid=$shelfProcess.Id; integrity=$(if ($level -ge 0) { $level } else { $null }); version=$version }
}
$selfEntry = $null
try { $selfEntry = Get-ShelfProcessEntry (Get-Process -Id $ShelfProcessId) 'Capture Shelf' } catch {}
$targets = @()
foreach ($definition in @(@{ Name='Weixin'; App='WeChat' }, @{ Name='WeChat'; App='WeChat' }, @{ Name='Feishu'; App='Feishu' })) {
    $candidates = @(Get-Process -Name $definition.Name -ErrorAction SilentlyContinue)
    $owners = @($candidates | Where-Object { $_.MainWindowHandle -ne 0 })
    # Background renderers have the same name. Prefer window-owning processes.
    if ($owners.Count -eq 0) { $owners = @($candidates | Sort-Object StartTime | Select-Object -First 1) }
    foreach ($owner in $owners) { $targets += Get-ShelfProcessEntry $owner $definition.App }
}
[pscustomobject]@{ self=$selfEntry; targets=@($targets) } | ConvertTo-Json -Depth 4 -Compress
