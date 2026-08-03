[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

function Await-WinRTTask {
    param($Task, [Type]$ResultType)
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        ($_.GetParameters()[0].ParameterType.FullName -like '*IAsyncOperation*')
    } | Select-Object -First 1
    if (-not $asTask) { throw 'AsTask not found' }
    $netTask = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Task))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

$sessionsOut = @()
$summary = 'none'
$hasAudio = $false

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null

    $mgr = Await-WinRTTask (
        [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    ) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

    foreach ($s in $mgr.GetSessions()) {
        $app = $s.SourceAppUserModelId
        $playback = [string]$s.GetPlaybackInfo().PlaybackStatus
        $title = ''
        $artist = ''
        try {
            $props = Await-WinRTTask ($s.TryGetMediaPropertiesAsync()) (
                [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
            )
            if ($props) {
                $title = $props.Title
                $artist = $props.Artist
            }
        } catch {}

        $isPlaying = ($playback -eq 'Playing')
        if ($isPlaying) { $hasAudio = $true }

        $sessionsOut += [ordered]@{
            app     = $app
            status  = $playback
            title   = $title
            artist  = $artist
            playing = $isPlaying
        }
    }

    $playing = @($sessionsOut | Where-Object { $_.playing })
    if ($playing.Count -gt 0) {
        $parts = @($playing | ForEach-Object {
            if ($_.title) { "$($_.title)|$($_.app)" } else { $_.app }
        })
        $summary = ($parts -join ';')
    }
} catch {
    $summary = 'unavailable'
}

[PSCustomObject]@{
    hasAudio = $hasAudio
    summary  = $summary
    sessions = $sessionsOut
} | ConvertTo-Json -Compress -Depth 4
