$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Add-JobMethod($name, [type]$result, [type[]]$parameters) {
  $method = $typeBuilder.DefinePInvokeMethod(
    $name, 'kernel32.dll', [Reflection.MethodAttributes]'Public, Static, PinvokeImpl',
    [Reflection.CallingConventions]::Standard, $result, $parameters,
    [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode
  )
  $method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor
    [Reflection.MethodImplAttributes]::PreserveSig)
}

try {
  # Emit the native declarations in-process so no compiler runs before containment.
  $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
    [Reflection.AssemblyName]::new('WorktrunkJob'), [Reflection.Emit.AssemblyBuilderAccess]::Run
  )
  $typeBuilder = $assembly.DefineDynamicModule('Job').DefineType('WorktrunkJob', [Reflection.TypeAttributes]::Public)
  Add-JobMethod CreateJobObjectW ([IntPtr]) @([IntPtr], [IntPtr])
  Add-JobMethod SetInformationJobObject ([int]) @([IntPtr], [int], [IntPtr], [uint32])
  Add-JobMethod GetCurrentProcess ([IntPtr]) @()
  Add-JobMethod AssignProcessToJobObject ([int]) @([IntPtr], [IntPtr])
  $jobApi = $typeBuilder.CreateType()

  # Only the launcher owns this non-inheritable handle. Windows closes it on exit.
  $job = $jobApi::CreateJobObjectW([IntPtr]::Zero, [IntPtr]::Zero)
  if ($job -eq [IntPtr]::Zero) { throw 'CreateJobObjectW failed' }

  # JOBOBJECT_EXTENDED_LIMIT_INFORMATION has LimitFlags at byte 16 on both architectures.
  $size = if ([IntPtr]::Size -eq 8) { 144 } else { 112 }
  $limits = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
  try {
    [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($size), 0, $limits, $size)
    [Runtime.InteropServices.Marshal]::WriteInt32($limits, 16, 0x2000) # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!$jobApi::SetInformationJobObject($job, 9, $limits, $size)) { throw 'SetInformationJobObject failed' }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($limits)
  }
  if (!$jobApi::AssignProcessToJobObject($job, $jobApi::GetCurrentProcess())) { throw 'AssignProcessToJobObject failed' }

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
