# Reset Music Bot Processes
# Use this to ensure no old bots are "fighting" for commands

Write-Host "🛑 Stopping all node processes..." -ForegroundColor Yellow
Stop-Process -Name "node" -ErrorAction SilentlyContinue
Write-Host "✅ All processes cleared. You can now run 'node index.js' safely." -ForegroundColor Green
