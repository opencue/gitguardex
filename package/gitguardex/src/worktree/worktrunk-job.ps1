$ErrorActionPreference = 'Stop'

try {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class WorktrunkJob {
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveProcesses;
    public UIntPtr Affinity;
    public uint Priority, SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits Basic;
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, IntPtr name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, int size);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

  public static void ContainLauncher() {
    var job = CreateJobObject(IntPtr.Zero, IntPtr.Zero);
    if (job == IntPtr.Zero) throw new Win32Exception();
    var limits = new ExtendedLimits();
    limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits))) ||
        !AssignProcessToJobObject(job, GetCurrentProcess())) throw new Win32Exception();
    // Only the launcher owns this non-inheritable handle. Windows closes it
    // on any exit, including when GitGuardex stops the launcher.
  }
}
'@
  [WorktrunkJob]::ContainLauncher()
  $start = [Diagnostics.ProcessStartInfo]::new($env:GUARDEX_WORKTRUNK_EXE, $env:GUARDEX_WORKTRUNK_ARGS)
  $start.WorkingDirectory = $env:GUARDEX_WORKTRUNK_ROOT
  $start.UseShellExecute = $false
  # Request explicit standard handles without decoding or buffering its output.
  $start.RedirectStandardInput = $true
  $child = [Diagnostics.Process]::Start($start)
  $child.StandardInput.Close()
  $child.WaitForExit()
  exit $child.ExitCode
} catch {
  [Console]::Error.WriteLine($_)
  exit 1
}
