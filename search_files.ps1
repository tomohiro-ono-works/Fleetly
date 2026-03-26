param (
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateSet("MB", "KB")]
    [string]$Unit,

    [Parameter(Mandatory=$false, Position=1)]
    [string[]]$ExcludeList = @()
)

# 単位に応じた計算値の設定
$divisor = if ($Unit -eq "MB") { 1MB } else { 1KB }

Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    # 相対パスを取得
    $relPath = Resolve-Path $_.FullName -Relative
    
    # 除外リストに一致するかチェック
    $isExcluded = $false
    foreach ($pattern in $ExcludeList) {
        if ($relPath -like $pattern) {
            $isExcluded = $true
            break
        }
    }

    # 除外対象でなければオブジェクトを作成
    if (-not $isExcluded) {
        [PSCustomObject]@{
            "Size($Unit)" = [Math]::Truncate($_.Length / $divisor)
            "Path"       = $relPath
            "RawLength"  = $_.Length
        }
    }
} | Sort-Object RawLength -Descending | Select-Object -First 20 | Format-Table -Property "Size($Unit)", "Path" -AutoSize
