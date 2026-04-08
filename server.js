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
const DEFAULT_LANG = "zh";

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
    throw new Error(MESSAGES.zh.targetUrlEmpty);
  }

  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(MESSAGES.zh.targetUrlProtocol);
  }

  return url.toString();
}

function normalizeLang(value) {
  return value === "en" ? "en" : DEFAULT_LANG;
}

function getCurrentTargetUrl() {
  return appConfig.targetUrl;
}

function getCheckedAt(lang = DEFAULT_LANG) {
  return new Date().toLocaleString(lang === "en" ? "en-US" : "zh-CN", { hour12: false });
}

const MESSAGES = {
  zh: {
    targetUrlEmpty: "目标地址不能为空",
    targetUrlProtocol: "目标地址仅支持 http 或 https 协议",
    successNoOutput: "执行成功，无输出",
    commandFailed: "执行失败",
    dnsFailed: "DNS 解析失败",
    requestTimeout: "请求超时",
    httpStatus: "最终状态",
    finalUrl: "最终地址",
    remoteAddress: "远端地址",
    tcpReachable: "端口 {port} 可连接",
    connectTime: "建立连接耗时",
    tcpTimeout: "端口 {port} 连接超时",
    tcpFailed: "端口 {port} 连接失败",
    firstByte: "首字节",
    totalTime: "总耗时",
    statusCode: "状态码",
    httpTimingFailed: "HTTP 耗时检测失败",
    httpCheckFailed: "HTTP 检测失败",
    httpNoCert: "当前目标使用 HTTP，未启用 HTTPS 证书检测。",
    certNotFound: "未获取到证书信息",
    certSubject: "主题",
    certIssuer: "签发方",
    certValidFrom: "生效时间",
    certValidTo: "过期时间",
    certFailed: "证书检测失败",
    certTimeout: "证书检测超时",
    redirectFailed: "重定向链检测失败",
    sampleCount: "采样次数",
    successRate: "成功率",
    fastest: "最快",
    average: "平均",
    slowest: "最慢",
    sampleFailed: "失败"
  },
  en: {
    targetUrlEmpty: "Target URL cannot be empty",
    targetUrlProtocol: "Target URL must use http or https",
    successNoOutput: "Command succeeded with no output",
    commandFailed: "Command failed",
    dnsFailed: "DNS resolution failed",
    requestTimeout: "Request timed out",
    httpStatus: "Final status",
    finalUrl: "Final URL",
    remoteAddress: "Remote address",
    tcpReachable: "Port {port} is reachable",
    connectTime: "Connection time",
    tcpTimeout: "Port {port} connection timed out",
    tcpFailed: "Port {port} connection failed",
    firstByte: "First byte",
    totalTime: "Total time",
    statusCode: "Status code",
    httpTimingFailed: "HTTP timing check failed",
    httpCheckFailed: "HTTP check failed",
    httpNoCert: "The current target uses HTTP, so HTTPS certificate inspection is skipped.",
    certNotFound: "No certificate information was returned",
    certSubject: "Subject",
    certIssuer: "Issuer",
    certValidFrom: "Valid from",
    certValidTo: "Valid to",
    certFailed: "Certificate check failed",
    certTimeout: "Certificate check timed out",
    redirectFailed: "Redirect chain check failed",
    sampleCount: "Samples",
    successRate: "Success rate",
    fastest: "Fastest",
    average: "Average",
    slowest: "Slowest",
    sampleFailed: "Failed"
  }
};

function t(lang, key, vars = {}) {
  const dict = MESSAGES[normalizeLang(lang)] || MESSAGES.zh;
  let template = dict[key] || key;
  for (const [name, value] of Object.entries(vars)) {
    template = template.replaceAll(`{${name}}`, String(value));
  }
  return template;
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

async function checkLoginState(targetUrl, extraKeywords = [], lang = DEFAULT_LANG) {
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
    checkedAt: getCheckedAt(lang)
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

async function runCommand(command, args, timeout = 10000, lang = DEFAULT_LANG) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 1024 * 1024
    });

    return {
      ok: true,
      output: clipOutput(stdout || stderr || t(lang, "successNoOutput"))
    };
  } catch (err) {
    const output = clipOutput(err.stderr || err.stdout || err.message || t(lang, "commandFailed"));
    return {
      ok: false,
      output
    };
  }
}

async function runDnsCheck(host, lang = DEFAULT_LANG) {
  try {
    const records = await dns.lookup(host, { all: true });
    const lines = records.map(item => `${item.address}${item.family ? ` (IPv${item.family})` : ""}`);
    return createResult(true, lines.join("\n"), { addresses: records });
  } catch (err) {
    return createResult(false, err.message || t(lang, "dnsFailed"));
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

function timedRequest(urlString, timeoutMs = 20000, lang = DEFAULT_LANG) {
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
      req.destroy(new Error(t(lang, "requestTimeout")));
    });
    req.end();
  });
}

async function followRedirects(targetUrl, maxRedirects = 5, lang = DEFAULT_LANG) {
  const chain = [];
  let currentUrl = targetUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    const response = await timedRequest(currentUrl, 20000, lang);
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

async function runHttpOverviewCheck(targetUrl, lang = DEFAULT_LANG) {
  try {
    const chain = await followRedirects(targetUrl, 5, lang);
    const finalStep = chain[chain.length - 1];
    const lines = [
      `${t(lang, "httpStatus")}: ${finalStep.statusCode}`,
      `${t(lang, "finalUrl")}: ${finalStep.url}`,
      `${t(lang, "remoteAddress")}: ${finalStep.remoteAddress || "-"}`,
      ...formatHeaders(finalStep.headers)
    ];
    return createResult(finalStep.statusCode < 400, lines.join("\n"), { chain });
  } catch (err) {
    return createResult(false, err.message || t(lang, "httpCheckFailed"));
  }
}

async function runTcpCheck(host, port, timeoutMs = 6000, lang = DEFAULT_LANG) {
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
      finish(true, `${t(lang, "tcpReachable", { port })}\n${t(lang, "connectTime")}: ${duration}s`);
    });
    socket.on("timeout", () => finish(false, t(lang, "tcpTimeout", { port })));
    socket.on("error", err => finish(false, `${t(lang, "tcpFailed", { port })}\n${err.message}`));
  });
}

async function runTimingCheck(targetUrl, lang = DEFAULT_LANG) {
  try {
    const chain = await followRedirects(targetUrl, 5, lang);
    const finalStep = chain[chain.length - 1];
    const timings = finalStep.timings;
    return createResult(
      finalStep.statusCode < 400,
      [
        `DNS: ${formatSeconds(timings.dns)}`,
        `TCP: ${formatSeconds(timings.connect)}`,
        `TLS: ${formatSeconds(timings.tls)}`,
        `${t(lang, "firstByte")}: ${formatSeconds(timings.firstByte)}`,
        `${t(lang, "totalTime")}: ${formatSeconds(timings.total)}`,
        `${t(lang, "statusCode")}: ${finalStep.statusCode}`,
        `${t(lang, "remoteAddress")}: ${finalStep.remoteAddress || "-"}`
      ].join("\n"),
      { chain }
    );
  } catch (err) {
    return createResult(false, err.message || t(lang, "httpTimingFailed"));
  }
}

async function runCertificateCheck({ host, port, protocol }, lang = DEFAULT_LANG) {
  if (protocol !== "https") {
    return createResult(true, t(lang, "httpNoCert"));
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
          resolve(createResult(false, t(lang, "certNotFound")));
          return;
        }

        const lines = [
          `${t(lang, "certSubject")}: ${cert.subject?.CN || "-"}`,
          `${t(lang, "certIssuer")}: ${cert.issuer?.CN || cert.issuer?.O || "-"}`,
          `${t(lang, "certValidFrom")}: ${cert.valid_from || "-"}`,
          `${t(lang, "certValidTo")}: ${cert.valid_to || "-"}`
        ];

        resolve(createResult(true, lines.join("\n")));
      }
    );

    socket.on("error", err => resolve(createResult(false, err.message || t(lang, "certFailed"))));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(createResult(false, t(lang, "certTimeout")));
    });
  });
}

async function runRedirectChainCheck(targetUrl, lang = DEFAULT_LANG) {
  try {
    const chain = await followRedirects(targetUrl, 5, lang);
    const lines = chain.map((step, index) => {
      const nextText = step.location ? ` -> ${new URL(step.location, step.url).toString()}` : "";
      return `${index + 1}. [${step.statusCode}] ${step.url}${nextText}`;
    });
    return createResult(true, lines.join("\n"), { chain });
  } catch (err) {
    return createResult(false, err.message || t(lang, "redirectFailed"));
  }
}

async function runHttpSampleCheck(targetUrl, sampleCount = 5, lang = DEFAULT_LANG) {
  const runs = await Promise.all(
    Array.from({ length: sampleCount }, async (_, index) => {
      try {
        const chain = await followRedirects(targetUrl, 5, lang);
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
          error: err.message || t(lang, "commandFailed")
        };
      }
    })
  );

  const totals = runs.filter(run => Number.isFinite(run.total)).map(run => run.total);
  const successCount = runs.filter(run => run.ok).length;
  const lines = [
    `${t(lang, "sampleCount")}: ${sampleCount}`,
    `${t(lang, "successRate")}: ${successCount}/${sampleCount}`
  ];

  if (totals.length) {
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const avg = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    lines.push(`${t(lang, "fastest")}: ${min.toFixed(3)}s`);
    lines.push(`${t(lang, "average")}: ${avg.toFixed(3)}s`);
    lines.push(`${t(lang, "slowest")}: ${max.toFixed(3)}s`);
  }

  lines.push("");
  for (const run of runs) {
    if (run.ok) {
      lines.push(`${run.index}. ${run.total.toFixed(3)}s [${run.statusCode}]`);
    } else {
      lines.push(`${run.index}. ${t(lang, "sampleFailed")} ${run.error}`);
    }
  }

  return createResult(successCount === sampleCount, lines.join("\n"), { runs });
}

async function runTracerouteCheck(host, lang = DEFAULT_LANG) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? "tracert" : "traceroute";
  const args = isWindows
    ? ["-d", "-h", "8", "-w", "1000", host]
    : ["-m", "8", "-w", "1", host];
  return runCommand(command, args, 25000, lang);
}

async function runPingCheck(host, lang = DEFAULT_LANG) {
  const isWindows = process.platform === "win32";
  const args = isWindows ? ["-n", "4", host] : ["-c", "4", host];
  return runCommand("ping", args, 10000, lang);
}

async function runNetworkDiagnostics(targetUrl, lang = DEFAULT_LANG) {
  const target = parseTarget(targetUrl);
  const { host, port } = target;

  const checks = await Promise.all([
    runDnsCheck(host, lang),
    runPingCheck(host, lang),
    runHttpOverviewCheck(targetUrl, lang),
    runTcpCheck(host, port, 6000, lang),
    runTimingCheck(targetUrl, lang),
    runCertificateCheck(target, lang),
    runRedirectChainCheck(targetUrl, lang),
    runHttpSampleCheck(targetUrl, 5, lang),
    runTracerouteCheck(host, lang)
  ]);

  return {
    ok: true,
    targetUrl,
    checkedAt: getCheckedAt(lang),
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
    const lang = normalizeLang(req.body?.lang);
    const result = await checkLoginState(targetUrl, keywords, lang);
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
    const lang = normalizeLang(req.body?.lang);
    const result = await runNetworkDiagnostics(targetUrl, lang);
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
