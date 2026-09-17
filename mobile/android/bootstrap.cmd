@echo off
cd /d "%~dp0"
where gradle >nul 2>nul
if errorlevel 1 (echo Install Gradle 9.5.0 and JDK 17, then retry. & exit /b 1)
call gradle wrapper --gradle-version 9.5.0 --distribution-type bin
if errorlevel 1 exit /b 1
call gradlew.bat assembleDebug
