# Windows MCI recorder, driven by the Node host over stdin/stdout.
# Commands: START <path>\n  PAUSE\n  RESUME\n  STOP\n  QUIT\n
# Replies:  READY\n  RECORDING\n  PAUSED\n  RESUMED\n  SAVED <path>\n  ERROR <text>\n
param([int]$SampleRate = 16000)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class RecMci
{
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern uint mciSendString(string command, StringBuilder ret, uint length, IntPtr callback);

    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern uint mciGetErrorString(uint error, StringBuilder buffer, uint length);

    [DllImport("kernel32.dll")]
    private static extern uint SetThreadExecutionState(uint esFlags);

    // ES_CONTINUOUS (0x80000000) keeps the setting until it is cleared;
    // ES_SYSTEM_REQUIRED (0x00000001) asks the system not to idle-sleep.
    // Called on the same thread that runs the read loop, so it stays valid as long as this process lives.
    // Returns the previous flags, which is how the probe checks the request was really applied.
    public static uint KeepAwake(bool on)
    {
        try { return SetThreadExecutionState(on ? 0x80000001u : 0x80000000u); } catch { return 0; }
    }
}
'@

function Invoke-Mci {
    param([string]$Command)
    $buffer = New-Object System.Text.StringBuilder 512
    $code = [RecMci]::mciSendString($Command, $buffer, [uint32]$buffer.Capacity, [IntPtr]::Zero)
    if ($code -ne 0) {
        $msg = New-Object System.Text.StringBuilder 512
        [void][RecMci]::mciGetErrorString($code, $msg, [uint32]$msg.Capacity)
        throw "MCI $code $($msg.ToString()) [$Command]"
    }
    return $buffer.ToString()
}

function Try-Mci {
    param([string]$Command)
    try { Invoke-Mci $Command | Out-Null } catch { }
}

$alias = 'fuyuRecorder'
$recording = $false
$paused = $false
$script:currentPath = ''
[Console]::Out.WriteLine('READY')

try {
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        $line = $line.Trim()
        if ($line.Length -eq 0) { continue }

        try {
            if ($line.StartsWith('START ')) {
                $path = $line.Substring(6).Trim()
                if ($recording) { Try-Mci "stop $alias"; Try-Mci "close $alias" }
                $script:currentPath = $path
                $paused = $false
                $dir = Split-Path -Parent $path
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
                Invoke-Mci "open new type waveaudio alias $alias" | Out-Null
                Try-Mci "set $alias channels 1"
                Try-Mci "set $alias bitspersample 16"
                Try-Mci "set $alias samplespersec $SampleRate"
                Try-Mci "set $alias time format ms"
                Invoke-Mci "record $alias" | Out-Null
                $recording = $true
                # Keep the machine from going to sleep while we record. Closing the lid still sleeps.
                $prev = [RecMci]::KeepAwake($true)
                [Console]::Error.WriteLine(("keepawake on prev=0x{0:X}" -f $prev))
                [Console]::Out.WriteLine('RECORDING')
            }
            elseif ($line -eq 'PAUSE') {
                if (-not $recording -or $paused) { [Console]::Out.WriteLine('ERROR not-recording'); continue }
                Invoke-Mci "pause $alias" | Out-Null
                $paused = $true
                [Console]::Out.WriteLine('PAUSED')
            }
            elseif ($line -eq 'RESUME') {
                if (-not $recording -or -not $paused) { [Console]::Out.WriteLine('ERROR not-paused'); continue }
                Invoke-Mci "resume $alias" | Out-Null
                $paused = $false
                [Console]::Out.WriteLine('RESUMED')
            }
            elseif ($line -eq 'STOP') {
                if (-not $recording) { [Console]::Out.WriteLine('ERROR not-recording'); continue }
                if ($paused) { Invoke-Mci "resume $alias" | Out-Null; $paused = $false }
                Invoke-Mci "stop $alias" | Out-Null
                $path = $script:currentPath
                $escaped = $path.Replace('\', '\\')
                Invoke-Mci "save $alias `"$escaped`"" | Out-Null
                Invoke-Mci "close $alias" | Out-Null
                $recording = $false
                $prev = [RecMci]::KeepAwake($false)
                [Console]::Error.WriteLine(("keepawake off prev=0x{0:X}" -f $prev))
                [Console]::Out.WriteLine("SAVED $path")
            }
            elseif ($line -eq 'QUIT') {
                if ($recording) { Try-Mci "stop $alias" }
                Try-Mci "close $alias"
                $recording = $false
                [RecMci]::KeepAwake($false)
                break
            }
        }
        catch {
            [Console]::Out.WriteLine("ERROR $($_.Exception.Message)")
        }
    }
}
finally {
    if ($recording) {
        try { Invoke-Mci "stop $alias" | Out-Null; Invoke-Mci "close $alias" | Out-Null } catch {}
    }
    try { [RecMci]::KeepAwake($false) } catch {}
}
