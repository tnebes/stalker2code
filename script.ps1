$keys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$files = Get-ChildItem -Path ".\resources" -Filter *.cfg -Recurse
foreach ($file in $files) {
    # Use a fast stream reader to skip PowerShell object overhead
    $content = [System.IO.File]::ReadLines($file.FullName)
    foreach ($line in $content) {
        if ($line -match "^\s*([a-zA-Z0-9_]+)\s*=") {
            [void]$keys.Add($matches[1])
        }
    }
}
$keys | Sort-Object | Out-File -FilePath all_keys.txt