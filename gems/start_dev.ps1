# Start Development Environment and Find Tunnel URL
Write-Host "🚀 Starting Development Environment..." -ForegroundColor Cyan

# 1. Stop existing dev containers
docker-compose -f docker-compose.dev.yml down

# 2. Start Dev Environment
docker-compose -f docker-compose.dev.yml up -d

# 3. Inject Data Updater (as per dev.sh logic)
Write-Host "🔄 Injecting Data Updater..."
docker exec gems-fomoguys-dev mkdir -p /app/public/api/data
# Using docker cp might need host path adjustment if on Windows/WSL boundary, trying direct exec first
# Note: standard docker cp works on Windows
docker cp data_updater.sh gems-fomoguys-dev:/app/data_updater.sh
docker exec gems-fomoguys-dev chmod +x /app/data_updater.sh
docker exec -d gems-fomoguys-dev sh -c "DATA_DIR=/app/public/api/data /app/data_updater.sh"

Write-Host "⏳ Waiting for Cloudflare Tunnel to generate URL..."
Start-Sleep -Seconds 5

$maxRetries = 10
$count = 0
$tunnelUrl = ""

while ([string]::IsNullOrEmpty($tunnelUrl) -and $count -lt $maxRetries) {
    $logs = docker logs gems-tunnel-dev 2>&1
    # Match pattern for trycloudflare.com
    if ($logs -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
        $tunnelUrl = $matches[0]
    } else {
        Start-Sleep -Seconds 2
        $count++
        Write-Host "   ...waiting for URL ($count/$maxRetries)"
    }
}

if (-not [string]::IsNullOrEmpty($tunnelUrl)) {
    Write-Host ""
    Write-Host "✅ Development URL: $tunnelUrl" -ForegroundColor Green
    Write-Host "⚠️  Note: This is a temporary URL for testing. It is NOT fomoguys.com."
    Write-Host "📝 Edit files -> Auto Reload"
} else {
    Write-Host "❌ Failed to get Tunnel URL. Check logs: docker logs gems-tunnel-dev" -ForegroundColor Red
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
