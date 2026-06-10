@echo off
:: Launch Claude Usage Widget silently
:: Place this file in shell:startup to auto-run on login
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0claude-usage-widget.ps1"
