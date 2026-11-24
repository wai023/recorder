# Windows MCI recorder, driven by the Node host over stdin/stdout.
# Commands: START <path>\n  STOP\n  QUIT\n
# Replies:  READY\n  RECORDING\n  SAVED <path>\n  ERROR <text>\n
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
                $script:currentPath = $path
                if ($recording) { Invoke-Mci "stop $alias" | Out-Null; Invoke-Mci "close $alias" | Out-Null }
                $dir = Split-Path -Parent $path
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
                Invoke-Mci "open new type waveaudio alias $alias" | Out-Null
                Try-Mci "set $alias channels 1"
                Try-Mci "set $alias bitspersample 16"
                Try-Mci "set $alias samplespersec $SampleRate"
                Try-Mci "set $alias time format ms"
                Invoke-Mci "record $alias" | Out-Null
                $recording = $true
                [Console]::Out.WriteLine('RECORDING')
            }
            elseif ($line -eq 'STOP') {
                if (-not $recording) { [Console]::Out.WriteLine('ERROR not-recording'); continue }
                Invoke-Mci "stop $alias" | Out-Null
                $path = $script:currentPath
                $escaped = $path.Replace('\', '\\')
                Invoke-Mci "save $alias `"$escaped`"" | Out-Null
                Invoke-Mci "close $alias" | Out-Null
                $recording = $false
                [Console]::Out.WriteLine("SAVED $path")
            }
            elseif ($line -eq 'QUIT') {
                if ($recording) { Invoke-Mci "stop $alias" | Out-Null }
                Invoke-Mci "close $alias" | Out-Null
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
}
