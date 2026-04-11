@echo off
echo ============================================
echo  Raksha APK Build Script
echo ============================================

REM Check VITE_API_BASE is set
findstr /C:"YOUR_RAILWAY_NODE_URL_HERE" .env.production >nul 2>&1
if %errorlevel%==0 (
    echo.
    echo ERROR: You haven't set your Railway URL yet!
    echo Open raksha-web\.env.production and replace:
    echo   YOUR_RAILWAY_NODE_URL_HERE
    echo with your actual Railway URL, e.g.:
    echo   https://raksha-api.up.railway.app
    echo.
    pause
    exit /b 1
)

echo [1/3] Building React app...
call npm run build
if %errorlevel% neq 0 ( echo Build failed! & pause & exit /b 1 )

echo [2/3] Syncing to Android...
call npx cap sync android
if %errorlevel% neq 0 ( echo Sync failed! & pause & exit /b 1 )

echo [3/3] Done!
echo.
echo Now open Android Studio:
echo   File ^> Open ^> raksha-web\android
echo   Build ^> Generate Signed App Bundle / APK
echo.
pause
