@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo 花地湾运营台 - 办公室协作版
echo 正在启动，请保留这个窗口。
echo.
where py >nul 2>&1
if not errorlevel 1 (
  py -3 --version >nul 2>&1
  if not errorlevel 1 goto run_py
)
python --version >nul 2>&1
if not errorlevel 1 goto run_python
echo 未找到 Python。请安装 Python 3.10 或更新版本，并勾选 Add Python to PATH。
echo 安装后关闭本窗口，重新双击本文件。
goto finish
:run_py
py -3 server.py --lan
goto finish
:run_python
python server.py --lan
:finish
echo.
echo 服务已停止。需要再次使用时，请重新双击本文件。
pause
