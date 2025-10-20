/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './polyfill.js';

import {randomUUID} from 'node:crypto';
import express, {type Request, type Response} from 'express';
import type {Channel} from './browser.js';
import {ensureBrowserConnected, ensureBrowserLaunched} from './browser.js';
import {parseArguments} from './cli.js';
import {logger, saveLogsToFile} from './logger.js';
import {McpContext} from './McpContext.js';
import {McpResponse} from './McpResponse.js';
import {Mutex} from './Mutex.js';
import {
  McpServer,
  StdioServerTransport,
  StreamableHTTPServerTransport,
  type CallToolResult,
  SetLevelRequestSchema,
} from './third_party/modelcontextprotocol-sdk/index.js';
import * as consoleTools from './tools/console.js';
import * as emulationTools from './tools/emulation.js';
import * as inputTools from './tools/input.js';
import * as networkTools from './tools/network.js';
import * as pagesTools from './tools/pages.js';
import * as performanceTools from './tools/performance.js';
import * as screenshotTools from './tools/screenshot.js';
import * as scriptTools from './tools/script.js';
import * as snapshotTools from './tools/snapshot.js';
import type {ToolDefinition} from './tools/ToolDefinition.js';

// If moved update release-please config
// x-release-please-start-version
const VERSION = '0.8.1';
// x-release-please-end

export const args = parseArguments(VERSION);

const logFile = args.logFile ? saveLogsToFile(args.logFile) : undefined;

logger(`Starting Chrome DevTools MCP Server v${VERSION}`);
const server = new McpServer(
  {
    name: 'chrome_devtools',
    title: 'Chrome DevTools MCP server',
    version: VERSION,
  },
  {capabilities: {logging: {}}},
);
server.server.setRequestHandler(SetLevelRequestSchema, () => {
  return {};
});

let context: McpContext;
async function getContext(): Promise<McpContext> {
  const extraArgs: string[] = (args.chromeArg ?? []).map(String);
  if (args.proxyServer) {
    extraArgs.push(`--proxy-server=${args.proxyServer}`);
  }
  const devtools = args.experimentalDevtools ?? false;
  const browser =
    args.browserUrl || args.wsEndpoint
      ? await ensureBrowserConnected({
          browserURL: args.browserUrl,
          wsEndpoint: args.wsEndpoint,
          wsHeaders: args.wsHeaders,
          devtools,
        })
      : await ensureBrowserLaunched({
          headless: args.headless,
          executablePath: args.executablePath,
          channel: args.channel as Channel,
          isolated: args.isolated,
          logFile,
          viewport: args.viewport,
          args: extraArgs,
          acceptInsecureCerts: args.acceptInsecureCerts,
          devtools,
        });

  if (context?.browser !== browser) {
    context = await McpContext.from(browser, logger);
  }
  return context;
}

const logDisclaimers = () => {
  console.error(
    `chrome-devtools-mcp exposes content of the browser instance to the MCP clients allowing them to inspect,
debug, and modify any data in the browser or DevTools.
Avoid sharing sensitive or personal information that you do not want to share with MCP clients.`,
  );
};

const toolMutex = new Mutex();

function registerTool(tool: ToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: tool.annotations,
    },
    async (params): Promise<CallToolResult> => {
      const guard = await toolMutex.acquire();
      try {
        logger(`${tool.name} request: ${JSON.stringify(params, null, '  ')}`);
        const context = await getContext();
        const response = new McpResponse();
        await tool.handler(
          {
            params,
          },
          response,
          context,
        );
        try {
          const content = await response.handle(tool.name, context);
          return {
            content,
          };
        } catch (error) {
          const errorText =
            error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: 'text',
                text: errorText,
              },
            ],
            isError: true,
          };
        }
      } catch (err) {
        logger(`${tool.name} error: ${err.message}`);
        throw err;
      } finally {
        guard.dispose();
      }
    },
  );
}

const tools = [
  ...Object.values(consoleTools),
  ...Object.values(emulationTools),
  ...Object.values(inputTools),
  ...Object.values(networkTools),
  ...Object.values(pagesTools),
  ...Object.values(performanceTools),
  ...Object.values(screenshotTools),
  ...Object.values(scriptTools),
  ...Object.values(snapshotTools),
] as ToolDefinition[];

tools.sort((a, b) => {
  return a.name.localeCompare(b.name);
});

for (const tool of tools) {
  registerTool(tool);
}

// 根据启动参数选择传输模式
if (args.httpServer) {
  // ============ HTTP 模式 ============
  logger('Starting in HTTP server mode');

  // 创建 Express 应用
  const app = express();

  app.use(express.json({limit: '4mb'}));
  app.use(express.urlencoded({extended: true}));

  // CORS 中间件
  app.use((req, res, next) => {
    logger(`${req.method} ${req.url}`);
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, DELETE, OPTIONS',
    );
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version',
    );

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // 创建 HTTP 传输层
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    allowedOrigins: ['*'],
    enableDnsRebindingProtection: false,
  });

  // 健康检查端点
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'Chrome DevTools MCP Server',
      version: VERSION,
      mode: 'http',
      timestamp: new Date().toISOString(),
    });
  });

  // 设置 MCP 路由
  app.post('/mcp', (req: Request, res: Response) => {
    transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', (req: Request, res: Response) => {
    transport.handleRequest(req, res);
  });

  app.delete('/mcp', (req: Request, res: Response) => {
    transport.handleRequest(req, res);
  });

  // 连接服务器到传输层
  await server.connect(transport);

  // 启动 HTTP 服务器
  const PORT = args.port;
  const HOST = args.host;

  app.listen(PORT, HOST, () => {
    console.log(
      `Chrome DevTools MCP Server is running on http://${HOST}:${PORT}`,
    );
    console.log(`Health check: http://${HOST}:${PORT}/health`);
    console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
    logDisclaimers();
  });
} else {
  // ============ stdio 模式（默认）============
  logger('Starting in stdio mode');

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger('Chrome DevTools MCP Server connected');
  logDisclaimers();
}
