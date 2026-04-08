<p align="center">
  <img src="./images/logo.png" width="140" alt="Login Monitor Logo" />
</p>

<h1 align="center">Login Monitor</h1>

<p align="center">
  A local dashboard for monitoring business-system login status.
</p>

# Login Monitor

`Login Monitor` is a local dashboard application for monitoring whether a business web system is still logged in.  
`Login Monitor` 是一个用于监测业务系统登录状态的本地大屏应用。

It is designed for long-running use on an operations desktop or monitoring terminal.  
它适合长期运行在值守电脑、运维终端或监控工作站上。

## Preview

![预览图1](./images/demo1.png)
![预览图2](./images/demo2.png)

## Overview / 项目介绍

The project includes a front-end dashboard and a local back-end service built with `Express + Playwright`.  
项目由前端监控大屏和基于 `Express + Playwright` 的本地服务端组成。

The dashboard is used for target URL configuration, browser login, login-state monitoring, logout records, and network diagnostics.  
前端页面用于填写目标地址、打开登录浏览器、启动登录态监测、查看掉线记录以及执行网络诊断。

The local service is responsible for persistent browser sessions, login-state checks, and diagnostic APIs.  
本地服务端负责浏览器持久化会话、登录态判断以及网络诊断接口。

This app helps you quickly identify logout issues, redirects, reachability problems, and common DNS / HTTPS / TCP / route anomalies.  
这个应用可以帮助你快速发现掉登录、页面重定向、网络不可达，以及常见的 DNS / HTTPS / TCP / 链路异常。

## Features / 功能简介

### 1. Login-State Monitoring / 登录态监测

- Configure and save the target URL directly in the dashboard.  
  直接在页面中填写并保存目标地址。
- Open a visible browser window for one-time manual login.  
  打开可见浏览器窗口，完成一次人工登录。
- Reuse persistent Playwright browser data for session storage.  
  使用 Playwright 持久化浏览器数据保存登录状态。
- Periodically check whether the target page appears to be logged out.  
  周期性检查目标页面是否疑似掉登录。
- Support extra custom keywords for logout detection.  
  支持附加自定义关键词增强掉登录识别。
- Record suspected logout and recovery events in the left-side log panel.  
  检测到疑似掉登录或恢复时，会记录到左侧日志面板。

### 2. Logout Records / 掉线记录

- Record time, status, page URL, and detail message.  
  记录掉线时间、状态、页面地址和异常详情。
- Add recovery entries when the page becomes normal again.  
  页面恢复正常后会追加“恢复”记录。
- Clear records with one click.  
  支持一键清空记录。

### 3. Network Diagnostics / 网络诊断

Built-in checks include:  
当前内置的网络检测项包括：

- `DNS` resolution  
  `DNS` 解析
- `Ping` reachability  
  `Ping` 连通性
- `HTTP` overview  
  `HTTP` 响应概览
- `TCP` port probe  
  `TCP` 端口探测
- `HTTP` timing analysis  
  `HTTP` 耗时分析
- `HTTPS` certificate inspection  
  `HTTPS` 证书检测
- Redirect chain analysis  
  重定向链分析
- Repeated request sampling  
  多次请求采样
- `Traceroute / Tracert` path analysis  
  `Traceroute / Tracert` 链路分析

The dashboard shows final summaries instead of full command output, which makes it easier to read during operations.  
页面展示的是最终结果摘要，而不是完整命令输出，更适合在运维大屏中快速查看。

### 4. Cross-Platform Support / 跨平台支持

- macOS: fully supported  
  macOS：支持完整使用
- Windows: login monitoring and most diagnostics are supported  
  Windows：支持登录监测和大部分网络诊断能力
- Linux: expected to work, but not specifically validated in this project  
  Linux：理论上可运行，但当前项目未专门验证

`Ping` uses OS-specific arguments automatically, and `Traceroute` uses `traceroute` on macOS/Linux and `tracert` on Windows.  
`Ping` 会按系统自动选择参数，`Traceroute` 在 macOS/Linux 下使用 `traceroute`，在 Windows 下使用 `tracert`。

Most HTTP, TCP, certificate, redirect, and sampling checks are implemented with Node built-in modules for better cross-platform consistency.  
大部分 HTTP、TCP、证书、重定向和采样检测通过 Node 原生模块实现，跨平台一致性更好。

## Quick Start / 快速使用

### Requirements / 环境依赖

Please make sure the following are installed:  
请先确保本机已安装以下环境：

- [Node.js](https://nodejs.org/) 18 or later  
  [Node.js](https://nodejs.org/) 18 或更高版本
- `npm`  
  `npm`

Check your local versions with:  
可以先用以下命令检查本机版本：

```bash
node -v
npm -v
```

Project runtime dependencies:  
项目运行依赖：

- `express`
- `cors`
- `playwright`

`Playwright` requires a browser runtime before first use.  
`Playwright` 在首次使用前需要安装浏览器运行时。

On Windows, `tracert` output may be incomplete depending on system policy or network rules.  
在 Windows 下，`tracert` 的结果可能会因为系统策略或网络环境限制而不完整。

### Install Dependencies / 安装依赖

Install all Node dependencies from the project root:  
在项目根目录一次性安装全部 Node 依赖：

```bash
npm install
```

If you want to install dependencies one by one, use:  
如果你希望逐个安装依赖，可以使用以下命令：

Install `express`:  
安装 `express`：

```bash
npm install express
```

Install `cors`:  
安装 `cors`：

```bash
npm install cors
```

Install `playwright`:  
安装 `playwright`：

```bash
npm install playwright
```

Install the Playwright Chromium runtime:  
安装 Playwright 的 Chromium 浏览器组件：

```bash
npx playwright install chromium
```

### Start the Service / 启动服务

The direct startup command is:  
直接启动命令是：

```bash
node server.js
```

`npm start` is also available because `package.json` maps it to `node server.js`:  
也可以使用 `npm start`，因为 `package.json` 中已经把它映射到了 `node server.js`：

```bash
npm start
```

The default local service address is:  
默认本地服务地址为：

```text
http://127.0.0.1:2333
```

### Open the Dashboard / 打开监控页面

Open the local page file in your browser:  
直接用浏览器打开本地页面文件：

```text
monitor.html
```

Recommended workflow:  
建议使用流程：

1. Start the local service.  
   启动本地服务。
2. Open `monitor.html`.  
   打开 `monitor.html`。
3. Enter and save the target URL.  
   填写并保存目标地址。
4. Click `Open Browser Login` and complete one manual login.  
   点击“打开浏览器登录”，完成一次人工登录。
5. Click `Start Monitor`.  
   点击“启动监测”。
6. Run `Network Diagnostics` when needed.  
   需要时执行“网络检测”。

## Project Structure / 目录说明

```text
login-monitor/
├── app-config.json   # Saved target URL configuration / 本地保存的目标地址配置
├── monitor.html      # Front-end dashboard / 前端监控大屏
├── server.js         # Local back-end service / 本地服务端
├── user-data/        # Playwright persistent browser data / Playwright 持久化登录数据
├── package.json      # Dependencies and scripts / 项目依赖与启动脚本
└── bg.jpg            # Background image / 页面背景图
```

## Configuration / 配置说明

### Target URL / 目标地址

The saved target URL is stored in `app-config.json`.  
保存后的目标地址会写入 `app-config.json`。

In normal usage, you usually do not need to edit this file manually because the dashboard can update it directly.  
日常使用时通常不需要手动编辑这个文件，因为页面中可以直接修改并保存。

### Default Port / 默认端口

The server runs on port `2333` by default.  
服务端默认运行在 `2333` 端口。

If needed, update the `PORT` constant in [server.js](/Users/huhu/Documents/Develop/login-monitor/server.js).  
如果需要修改端口，可以调整 [server.js](/Users/huhu/Documents/Develop/login-monitor/Login%20Monitor/server.js) 中的 `PORT` 常量。

## Development / 开发说明

Main script:  
主要使用脚本：

```bash
npm start
```

Quick syntax check:  
快速语法检查：

```bash
node --check server.js
```

## License / 许可证

The current `package.json` declares the license as `ISC`.  
当前项目 `package.json` 中声明的许可证为 `ISC`。
