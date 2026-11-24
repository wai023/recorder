# 录音（Fuyu 插件）

Windows 专用的浮屿录音插件。点岛上的「录音」页开始，点「停止并保存」得到 WAV 文件；文件自动加入浮屿的文件中转，并在岛上弹出通知。快捷键 `Ctrl+Alt+R` 可开始/停止。

## 原理

插件宿主是 Node 进程，启动一个常驻的 PowerShell 子进程，通过 stdin/stdout 收发命令。PowerShell 脚本 `assets/record.ps1` 随包分发，运行时复制到插件数据目录；它调用 Windows 自带的 `winmm.dll` MCI 接口录音并直接保存为 WAV。

不依赖 ffmpeg，不在包内携带任何 `.exe` / `.dll`。插件与浮屿同权，无沙箱。

## 它读什么、写什么、连什么

- 读：仅读取自身数据目录 `ctx.dataDir` 下的 `record.ps1`
- 写：`ctx.dataDir` 下的 `record.ps1` 与 `recording-<时间戳>.wav`
- 运行：`powershell.exe`（Windows 自带）
- 联网：无

## 开发

```sh
npm install
npm run dev        # 需浮屿正在运行
npm run typecheck
npm run lint
npm run test       # 13 项：协议解析、宿主初始化、端到端状态机
npm run check
npm run package    # 产出 .fuyu
```

## 已知限制

- 仅支持 Windows（macOS 未适配）
- 录音成功依赖系统存在可用的麦克风设备；MCI 报告的采样率在部分驱动上可能回落到默认值，但生成的 WAV 文件有效
- 首次运行需要 Windows 允许 PowerShell 执行本地脚本（子进程使用 `-ExecutionPolicy Bypass`）
- 自动化测试用假子进程模拟 MCI，不依赖真实麦克风；真机录音仍需在浮屿里点按钮验证一次
