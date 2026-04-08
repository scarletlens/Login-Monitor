const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const dns = require("dns").promises;
const net = require("net");
const tls = require("tls");
const http = require("http");
const https = require("https");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { performance } = require("perf_hooks");
const { chromium } = require("playwright");

const execFileAsync = promisify(execFile);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 2333;
const USER_DATA_DIR = path.join(__dirname, "user-data");
const CONFIG_FILE = path.join(__dirname, "app-config.json");
const DEFAULT_TARGET_URL = "https://example.com/";

let browserContext = null;
let page = null;
let appConfig = loadConfig();

function loadConfig() {
  try {
    const fileContent = fs.readFileSync(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(fileContent);
    return {
      targetUrl: normalizeTargetUrl(parsed.targetUrl || DEFAULT_TARGET_URL)
    };
  } catch (err) {
    const fallback = { targetUrl: DEFAULT_TARGET_URL };
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
    return fallback;
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(appConfig, null, 2)}\n`, "utf8");
}

function normalizeTargetUrl(value) {
  const input = String(value || "").trim();
  if (!input) {
    throw new Error("目标地址不能为空");
  }

  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("目标地址仅支持 http 或 https 协议");
  }

  return url.toString();
}

function getCurrentTargetUrl() {
  return appConfig.targetUrl;
}

function getCheckedAt() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

async function initBrowser(headless = true) {
  if (browserContext) return;

  browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    viewport: { width: 1440, height: 900 }
  });

  page = browserContext.pages()[0] || await browserContext.newPage();
}

async function closeBrowser() {
  if (browserContext) {
    await browserContext.close();
    browserContext = null;
    page = null;
  }
}

async function checkLoginState(targetUrl, extraKeywords = []) {
  if (!browserContext || !page) {
    await initBrowser(true);
  }

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const loginUrlKeywords = ["login", "signin", "cas", "sso", "auth"];
  const hitLoginUrlKeywords = loginUrlKeywords.filter(keyword =>
    currentUrl.toLowerCase().includes(keyword)
  );

  const defaultLoginTextKeywords = ["用户名"];
  const allKeywords = [...new Set([...defaultLoginTextKeywords, ...extraKeywords])];
  const hitTextKeywords = allKeywords.filter(keyword => bodyText.includes(keyword));
  const hasPasswordInput = await page.locator('input[type="password"]').count().catch(() => 0);
  const hasLoginButton = await page.locator('button:has-text("登录"), input[value="登录"]').count().catch(() => 0);

  const loggedOut =
    hitLoginUrlKeywords.length > 0 ||
    hitTextKeywords.length > 0 ||
    hasPasswordInput > 0 ||
    hasLoginButton > 0;

  return {
    ok: true,
    targetUrl,
    loggedOut,
    currentUrl,
    hitLoginUrlKeywords,
    hitTextKeywords,
    hasPasswordInput,
    hasLoginButton,
    checkedAt: getCheckedAt()
  };
}

function parseTarget(targetUrl) {
  const url = new URL(targetUrl);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return {
    url,
    host: url.hostname,
    port,
    protocol: url.protocol.replace(":", "")
  };
}

function clipOutput(text, maxLength = 1200) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}\n...输出已截断`;
}

function createResult(ok, output, extras = {}) {
  return {
    ok,
    output: clipOutput(output),
    ...extras
  };
}

async function runCommand(command, args, timeout = 10000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 1024 * 1024
    });

    return {
      ok: true,
      output: clipOutput(stdout || stderr || "执行成功，无输出")
    };
  } catch (err) {
    const output = clipOutput(err.stderr || err.stdout || err.message || "执行失败");
    return {
      ok: false,
      output
    };
  }
}

async function runDnsCheck(host) {
  try {
    const records = await dns.lookup(host, { all: true });
    const lines = records.map(item => `${item.address}${item.family ? ` (IPv${item.family})` : ""}`);
    return createResult(true, lines.join("\n"), { addresses: records });
  } catch (err) {
    return createResult(false, err.message || "DNS 解析失败");
  }
}

function formatHeaders(headers) {
  const interestingKeys = [
    "content-type",
    "server",
    "location",
    "set-cookie",
    "cache-control"
  ];
  const lines = [];

  for (const key of interestingKeys) {
    const value = headers[key];
    if (!value) continue;
    lines.push(`${key}: ${Array.isArray(value) ? value.join("; ") : value}`);
  }

  return lines;
}

function isRedirectStatus(statusCode) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function timedRequest(urlString, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlString);
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const start = performance.now();

    let lookupAt = null;
    let connectAt = null;
    let secureAt = null;
    let firstByteAt = null;

    const req = transport.request(
      parsedUrl,
      {
        method: "GET",
        headers: {
          "User-Agent": "login-monitor/1.0"
        }
      },
      res => {
        if (firstByteAt === null) {
          firstByteAt = performance.now();
        }

        res.on("data", () => {});
        res.on("end", () => {
          const totalAt = performance.now();
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            remoteAddress: req.socket?.remoteAddress || "",
            timings: {
              dns: lookupAt ? (lookupAt - start) / 1000 : null,
              connect: connectAt ? (connectAt - start) / 1000 : null,
              tls: secureAt ? (secureAt - start) / 1000 : null,
              firstByte: firstByteAt ? (firstByteAt - start) / 1000 : null,
              total: (totalAt - start) / 1000
            }
          });
        });
      }
    );

    req.on("socket", socket => {
      socket.on("lookup", () => {
        if (lookupAt === null) lookupAt = performance.now();
      });
      socket.on("connect", () => {
        if (connectAt === null) connectAt = performance.now();
      });
      socket.on("secureConnect", () => {
        if (secureAt === null) secureAt = performance.now();
      });
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("请求超时"));
    });
    req.end();
  });
}

async function followRedirects(targetUrl, maxRedirects = 5) {
  const chain = [];
  let currentUrl = targetUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    const response = await timedRequest(currentUrl);
    chain.push({
      url: currentUrl,
      statusCode: response.statusCode,
      location: response.headers.location || "",
      timings: response.timings,
      headers: response.headers,
      remoteAddress: response.remoteAddress
    });

    if (!isRedirectStatus(response.statusCode) || !response.headers.location) {
      break;
    }

    currentUrl = new URL(response.headers.location, currentUrl).toString();
  }

  return chain;
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)}s` : "-";
}

async function runHttpOverviewCheck(targetUrl) {
  try {
    const chain = await followRedirects(targetUrl, 5);
    const finalStep = chain[chain.length - 1];
    const lines = [
      `最终状态: ${finalStep.statusCode}`,
      `最终地址: ${finalStep.url}`,
      `远端地址: ${finalStep.remoteAddress || "-"}`,
      ...formatHeaders(finalStep.headers)
    ];
    return createResult(finalStep.statusCode < 400, lines.join("\n"), { chain });
  } catch (err) {
    return createResult(false, err.message || "HTTP 检测失败");
  }
}

async function runTcpCheck(host, port, timeoutMs = 6000) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    const start = performance.now();
    let finished = false;

    const finish = (ok, output) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(createResult(ok, output));
    };

    socket.setTimeout(timeoutMs);
    socket.connect(Number(port), host, () => {
      const duration = ((performance.now() - start) / 1000).toFixed(3);
      finish(true, `端口 ${port} 可连接\n建立连接耗时: ${duration}s`);
    });
    socket.on("timeout", () => finish(false, `端口 ${port} 连接超时`));
    socket.on("error", err => finish(false, `端口 ${port} 连接失败\n${err.message}`));
  });
}

async function runTimingCheck(targetUrl) {
  try {
    const chain = await followRedirects(targetUrl, 5);
    const finalStep = chain[chain.length - 1];
    const t = finalStep.timings;
    return createResult(
      finalStep.statusCode < 400,
      [
        `DNS: ${formatSeconds(t.dns)}`,
        `TCP: ${formatSeconds(t.connect)}`,
        `TLS: ${formatSeconds(t.tls)}`,
        `首字节: ${formatSeconds(t.firstByte)}`,
        `总耗时: ${formatSeconds(t.total)}`,
        `状态码: ${finalStep.statusCode}`,
        `远端地址: ${finalStep.remoteAddress || "-"}`
      ].join("\n"),
      { chain }
    );
  } catch (err) {
    return createResult(false, err.message || "HTTP 耗时检测失败");
  }
}

async function runCertificateCheck({ host, port, protocol }) {
  if (protocol !== "https") {
    return createResult(true, "当前目标使用 HTTP，未启用 HTTPS 证书检测。");
  }

  return new Promise(resolve => {
    const socket = tls.connect(
      {
        host,
        port: Number(port),
        servername: host,
        rejectUnauthorized: false,
        timeout: 10000
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || !Object.keys(cert).length) {
          resolve(createResult(false, "未获取到证书信息"));
          return;
        }

        const lines = [
          `主题: ${cert.subject?.CN || "-"}`,
          `签发方: ${cert.issuer?.CN || cert.issuer?.O || "-"}`,
          `生效时间: ${cert.valid_from || "-"}`,
          `过期时间: ${cert.valid_to || "-"}`
        ];

        resolve(createResult(true, lines.join("\n")));
      }
    );

    socket.on("error", err => resolve(createResult(false, err.message || "证书检测失败")));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(createResult(false, "证书检测超时"));
    });
  });
}

async function runRedirectChainCheck(targetUrl) {
  try {
    const chain = await followRedirects(targetUrl, 5);
    const lines = chain.map((step, index) => {
      const nextText = step.location ? ` -> ${new URL(step.location, step.url).toString()}` : "";
      return `${index + 1}. [${step.statusCode}] ${step.url}${nextText}`;
    });
    return createResult(true, lines.join("\n"), { chain });
  } catch (err) {
    return createResult(false, err.message || "重定向链检测失败");
  }
}

async function runHttpSampleCheck(targetUrl, sampleCount = 5) {
  const runs = await Promise.all(
    Array.from({ length: sampleCount }, async (_, index) => {
      try {
        const chain = await followRedirects(targetUrl, 5);
        const finalStep = chain[chain.length - 1];
        return {
          ok: finalStep.statusCode < 400,
          index: index + 1,
          total: finalStep.timings.total,
          statusCode: finalStep.statusCode
        };
      } catch (err) {
        return {
          ok: false,
          index: index + 1,
          error: err.message || "请求失败"
        };
      }
    })
  );

  const totals = runs.filter(run => Number.isFinite(run.total)).map(run => run.total);
  const successCount = runs.filter(run => run.ok).length;
  const lines = [
    `采样次数: ${sampleCount}`,
    `成功率: ${successCount}/${sampleCount}`
  ];

  if (totals.length) {
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const avg = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    lines.push(`最快: ${min.toFixed(3)}s`);
    lines.push(`平均: ${avg.toFixed(3)}s`);
    lines.push(`最慢: ${max.toFixed(3)}s`);
  }

  lines.push("");
  for (const run of runs) {
    if (run.ok) {
      lines.push(`${run.index}. ${run.total.toFixed(3)}s [${run.statusCode}]`);
    } else {
      lines.push(`${run.index}. 失败 ${run.error}`);
    }
  }

  return createResult(successCount === sampleCount, lines.join("\n"), { runs });
}

async function runTracerouteCheck(host) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "tracert" : "traceroute";
  const args = isWindows
    ? ["-d", "-h", "8", "-w", "1000", host]
    : ["-m", "8", "-w", "1", host];
  return runCommand(command, args, 25000);
}

async function runPingCheck(host) {
  const isWindows = process.platform === "win32";
  const args = isWindows ? ["-n", "4", host] : ["-c", "4", host];
  return runCommand("ping", args, 10000);
}

async function runNetworkDiagnostics(targetUrl) {
  const target = parseTarget(targetUrl);
  const { host, port } = target;

  const checks = await Promise.all([
    runDnsCheck(host),
    runPingCheck(host),
    runHttpOverviewCheck(targetUrl),
    runTcpCheck(host, port),
    runTimingCheck(targetUrl),
    runCertificateCheck(target),
    runRedirectChainCheck(targetUrl),
    runHttpSampleCheck(targetUrl, 5),
    runTracerouteCheck(host)
  ]);

  return {
    ok: true,
    targetUrl,
    checkedAt: getCheckedAt(),
    host,
    port,
    results: {
      dns: checks[0],
      ping: checks[1],
      curl: checks[2],
      tcp: checks[3],
      httpTiming: checks[4],
      certificate: checks[5],
      redirectChain: checks[6],
      httpSamples: checks[7],
      traceroute: checks[8]
    }
  };
}

app.get("/api/settings", (req, res) => {
  res.json({
    ok: true,
    targetUrl: getCurrentTargetUrl()
  });
});

app.post("/api/settings", (req, res) => {
  try {
    const targetUrl = normalizeTargetUrl(req.body?.targetUrl);
    appConfig.targetUrl = targetUrl;
    saveConfig();

    res.json({
      ok: true,
      targetUrl
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message
    });
  }
});

app.post("/api/open-browser", async (req, res) => {
  try {
    const targetUrl = normalizeTargetUrl(req.body?.targetUrl || getCurrentTargetUrl());

    await closeBrowser();
    await initBrowser(false);

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    res.json({
      ok: true,
      targetUrl,
      message: "浏览器已打开，请在弹出的浏览器中手动登录。登录完成后可关闭浏览器窗口，或直接回来启动监测。"
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.post("/api/check-login", async (req, res) => {
  try {
    const targetUrl = normalizeTargetUrl(req.body?.targetUrl || getCurrentTargetUrl());
    const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords : [];
    const result = await checkLoginState(targetUrl, keywords);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.post("/api/network-diagnostics", async (req, res) => {
  try {
    const targetUrl = normalizeTargetUrl(req.body?.targetUrl || getCurrentTargetUrl());
    const result = await runNetworkDiagnostics(targetUrl);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`监测服务已启动：http://127.0.0.1:${PORT}`);
  console.log(`当前目标页面：${getCurrentTargetUrl()}`);
});
