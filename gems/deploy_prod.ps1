 # Production Deployment Script
Write-Host "🚀 Starting Production Deployment..." -ForegroundColor Green

# 1. Stop existing production containers
Write-Host "🛑 Stopping existing containers..."
docker-compose down

# 2. Rebuild Production Image
Write-Host "🏗️ Building Production Image (cryptox-prod:latest)..."
docker build -t cryptox-prod:latest -f Dockerfile .
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

# 3. Start Production Containers
Write-Host "🔄 Starting Production Containers..."
docker-compose up -d

Write-Host "✅ Deployment Complete! Visit https://fomoguys.com" -ForegroundColor Green
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
