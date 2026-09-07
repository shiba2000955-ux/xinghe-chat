@echo off
cd /d "%~dp0"
start "星河通讯" http://localhost:5173/
py server.py
