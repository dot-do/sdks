#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  __defProp(target, "default", { value: mod, enumerable: true }) ,
  mod
));

// src/storage.ts
var storage_exports = {};
__export(storage_exports, {
  CompositeTokenStorage: () => CompositeTokenStorage,
  FileTokenStorage: () => FileTokenStorage,
  KeychainTokenStorage: () => KeychainTokenStorage,
  LocalStorageTokenStorage: () => LocalStorageTokenStorage,
  MemoryTokenStorage: () => MemoryTokenStorage,
  SecureFileTokenStorage: () => SecureFileTokenStorage,
  createSecureStorage: () => createSecureStorage
});
function isNode() {
  return typeof process !== "undefined" && process.versions != null && process.versions.node != null;
}
function getEnv2(key) {
  if (typeof process !== "undefined" && process.env?.[key]) return process.env[key];
  return void 0;
}
function createSecureStorage(storagePath) {
  if (isNode()) {
    return new SecureFileTokenStorage(storagePath);
  }
  if (typeof localStorage !== "undefined") {
    return new LocalStorageTokenStorage();
  }
  return new MemoryTokenStorage();
}
var KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, KeychainTokenStorage, SecureFileTokenStorage, FileTokenStorage, MemoryTokenStorage, LocalStorageTokenStorage, CompositeTokenStorage;
var init_storage = __esm({
  "src/storage.ts"() {
    KEYCHAIN_SERVICE = "oauth.do";
    KEYCHAIN_ACCOUNT = "access_token";
    KeychainTokenStorage = class {
      keytar = null;
      initialized = false;
      /**
       * Lazily load keytar module
       * Returns null if keytar is not available (e.g., missing native dependencies)
       */
      async getKeytar() {
        if (this.initialized) {
          return this.keytar;
        }
        this.initialized = true;
        try {
          const imported = await import('keytar');
          const keytarModule = imported.default || imported;
          this.keytar = keytarModule;
          if (typeof this.keytar.getPassword !== "function") {
            if (getEnv2("DEBUG")) {
              console.warn("Keytar module loaded but getPassword is not a function:", Object.keys(this.keytar));
            }
            this.keytar = null;
            return null;
          }
          return this.keytar;
        } catch (error) {
          if (getEnv2("DEBUG")) {
            console.warn("Keychain storage not available:", error);
          }
          return null;
        }
      }
      async getToken() {
        const keytar = await this.getKeytar();
        if (!keytar) {
          return null;
        }
        try {
          const token = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
          return token;
        } catch (error) {
          if (getEnv2("DEBUG")) {
            console.warn("Failed to get token from keychain:", error);
          }
          return null;
        }
      }
      async setToken(token) {
        try {
          const keytar = await this.getKeytar();
          if (!keytar) {
            throw new Error("Keychain storage not available");
          }
          await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, token);
        } catch (error) {
          if (error?.code === "MODULE_NOT_FOUND" || error?.message?.includes("Cannot find module")) {
            throw new Error("Keychain storage not available: native module not built");
          }
          throw new Error(`Failed to save token to keychain: ${error}`);
        }
      }
      async removeToken() {
        const keytar = await this.getKeytar();
        if (!keytar) {
          return;
        }
        try {
          await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
        } catch {
        }
      }
      /**
       * Check if keychain storage is available on this system
       */
      async isAvailable() {
        try {
          const keytar = await this.getKeytar();
          if (!keytar) {
            return false;
          }
          await keytar.getPassword(KEYCHAIN_SERVICE, "__test__");
          return true;
        } catch (error) {
          if (getEnv2("DEBUG")) {
            console.warn("Keychain not available:", error);
          }
          return false;
        }
      }
    };
    SecureFileTokenStorage = class {
      tokenPath = null;
      configDir = null;
      initialized = false;
      customPath;
      constructor(customPath) {
        this.customPath = customPath;
      }
      async init() {
        if (this.initialized) return this.tokenPath !== null;
        this.initialized = true;
        if (!isNode()) return false;
        try {
          const os = await import('os');
          const path = await import('path');
          if (this.customPath) {
            const expandedPath = this.customPath.startsWith("~/") ? path.join(os.homedir(), this.customPath.slice(2)) : this.customPath;
            this.tokenPath = expandedPath;
            this.configDir = path.dirname(expandedPath);
          } else {
            this.configDir = path.join(os.homedir(), ".oauth.do");
            this.tokenPath = path.join(this.configDir, "token");
          }
          return true;
        } catch {
          return false;
        }
      }
      async getToken() {
        const data = await this.getTokenData();
        if (data) {
          return data.accessToken;
        }
        if (!await this.init() || !this.tokenPath) return null;
        try {
          const fs = await import('fs/promises');
          const stats = await fs.stat(this.tokenPath);
          const mode = stats.mode & 511;
          if (mode !== 384 && getEnv2("DEBUG")) {
            console.warn(
              `Warning: Token file has insecure permissions (${mode.toString(8)}). Expected 600. Run: chmod 600 ${this.tokenPath}`
            );
          }
          const content = await fs.readFile(this.tokenPath, "utf-8");
          const trimmed = content.trim();
          if (trimmed.startsWith("{")) {
            const data2 = JSON.parse(trimmed);
            return data2.accessToken;
          }
          return trimmed;
        } catch {
          return null;
        }
      }
      async setToken(token) {
        await this.setTokenData({ accessToken: token.trim() });
      }
      async getTokenData() {
        if (!await this.init() || !this.tokenPath) return null;
        try {
          const fs = await import('fs/promises');
          const content = await fs.readFile(this.tokenPath, "utf-8");
          const trimmed = content.trim();
          if (trimmed.startsWith("{")) {
            return JSON.parse(trimmed);
          }
          return { accessToken: trimmed };
        } catch {
          return null;
        }
      }
      async setTokenData(data) {
        if (!await this.init() || !this.tokenPath || !this.configDir) {
          throw new Error("File storage not available");
        }
        try {
          const fs = await import('fs/promises');
          await fs.mkdir(this.configDir, { recursive: true, mode: 448 });
          await fs.writeFile(this.tokenPath, JSON.stringify(data), { encoding: "utf-8", mode: 384 });
          await fs.chmod(this.tokenPath, 384);
        } catch (error) {
          console.error("Failed to save token data:", error);
          throw error;
        }
      }
      async removeToken() {
        if (!await this.init() || !this.tokenPath) return;
        try {
          const fs = await import('fs/promises');
          await fs.unlink(this.tokenPath);
        } catch {
        }
      }
      /**
       * Get information about the storage backend
       */
      async getStorageInfo() {
        await this.init();
        return { type: "file", secure: true, path: this.tokenPath };
      }
    };
    FileTokenStorage = class {
      tokenPath = null;
      configDir = null;
      initialized = false;
      async init() {
        if (this.initialized) return this.tokenPath !== null;
        this.initialized = true;
        if (!isNode()) return false;
        try {
          const os = await import('os');
          const path = await import('path');
          this.configDir = path.join(os.homedir(), ".oauth.do");
          this.tokenPath = path.join(this.configDir, "token");
          return true;
        } catch {
          return false;
        }
      }
      async getToken() {
        if (!await this.init() || !this.tokenPath) return null;
        try {
          const fs = await import('fs/promises');
          const token = await fs.readFile(this.tokenPath, "utf-8");
          return token.trim();
        } catch {
          return null;
        }
      }
      async setToken(token) {
        if (!await this.init() || !this.tokenPath || !this.configDir) {
          throw new Error("File storage not available");
        }
        try {
          const fs = await import('fs/promises');
          await fs.mkdir(this.configDir, { recursive: true });
          await fs.writeFile(this.tokenPath, token, "utf-8");
        } catch (error) {
          console.error("Failed to save token:", error);
          throw error;
        }
      }
      async removeToken() {
        if (!await this.init() || !this.tokenPath) return;
        try {
          const fs = await import('fs/promises');
          await fs.unlink(this.tokenPath);
        } catch {
        }
      }
    };
    MemoryTokenStorage = class {
      token = null;
      async getToken() {
        return this.token;
      }
      async setToken(token) {
        this.token = token;
      }
      async removeToken() {
        this.token = null;
      }
    };
    LocalStorageTokenStorage = class {
      key = "oauth.do:token";
      async getToken() {
        if (typeof localStorage === "undefined") {
          return null;
        }
        return localStorage.getItem(this.key);
      }
      async setToken(token) {
        if (typeof localStorage === "undefined") {
          throw new Error("localStorage is not available");
        }
        localStorage.setItem(this.key, token);
      }
      async removeToken() {
        if (typeof localStorage === "undefined") {
          return;
        }
        localStorage.removeItem(this.key);
      }
    };
    CompositeTokenStorage = class {
      keychainStorage;
      fileStorage;
      preferredStorage = null;
      constructor() {
        this.keychainStorage = new KeychainTokenStorage();
        this.fileStorage = new SecureFileTokenStorage();
      }
      /**
       * Determine the best available storage backend
       */
      async getPreferredStorage() {
        if (this.preferredStorage) {
          return this.preferredStorage;
        }
        if (await this.keychainStorage.isAvailable()) {
          this.preferredStorage = this.keychainStorage;
          return this.preferredStorage;
        }
        this.preferredStorage = this.fileStorage;
        return this.preferredStorage;
      }
      async getToken() {
        const keychainToken = await this.keychainStorage.getToken();
        if (keychainToken) {
          return keychainToken;
        }
        const fileToken = await this.fileStorage.getToken();
        if (fileToken) {
          if (await this.keychainStorage.isAvailable()) {
            try {
              await this.keychainStorage.setToken(fileToken);
              await this.fileStorage.removeToken();
              if (getEnv2("DEBUG")) {
                console.log("Migrated token from file to keychain");
              }
            } catch {
            }
          }
          return fileToken;
        }
        return null;
      }
      async setToken(token) {
        const storage2 = await this.getPreferredStorage();
        await storage2.setToken(token);
      }
      async removeToken() {
        await Promise.all([this.keychainStorage.removeToken(), this.fileStorage.removeToken()]);
      }
      /**
       * Get information about the current storage backend
       */
      async getStorageInfo() {
        if (await this.keychainStorage.isAvailable()) {
          return { type: "keychain", secure: true };
        }
        return { type: "file", secure: true };
      }
    };
  }
});

// package.json
var require_package = __commonJS({
  "package.json"(exports$1, module) {
    module.exports = {
      name: "oauth.do",
      version: "0.1.0",
      description: "OAuth authentication SDK and CLI for org.ai identity",
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      bin: {
        "oauth.do": "./dist/cli.js"
      },
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          require: "./dist/index.cjs"
        },
        "./node": {
          types: "./dist/node.d.ts",
          import: "./dist/node.js",
          require: "./dist/node.cjs"
        },
        "./mdx/*": "./src/mdx/*"
      },
      files: [
        "dist",
        "src/mdx",
        "README.md",
        "LICENSE"
      ],
      scripts: {
        build: "tsup",
        dev: "tsup --watch",
        test: "vitest run",
        "test:watch": "vitest",
        "check:publish": `node -e "const pkg = require('./package.json'); const deps = JSON.stringify(pkg.dependencies || {}); if (deps.includes('workspace:')) { console.error('ERROR: workspace: protocol found in dependencies. Replace with actual versions before publishing.'); process.exit(1); }"`,
        prepublishOnly: "pnpm check:publish && pnpm build && pnpm test"
      },
      keywords: [
        "oauth",
        "authentication",
        "auth",
        "login",
        "identity",
        "cli",
        "sdk",
        "org-ai",
        "dotdo"
      ],
      author: {
        name: "DotDo",
        email: "npm@dotdo.dev",
        url: "https://dotdo.dev"
      },
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/dot-do/sdks.git",
        directory: "packages/typescript/oauth"
      },
      bugs: {
        url: "https://github.com/dot-do/sdks/issues"
      },
      homepage: "https://oauth.do",
      engines: {
        node: ">=18.0.0"
      },
      dependencies: {
        open: "^10.1.0",
        "rpc.do": "workspace:*",
        "platform.do": "workspace:*"
      },
      optionalDependencies: {
        keytar: "^7.9.0"
      },
      devDependencies: {
        "@types/node": "^24.10.1",
        tsup: "^8.0.0",
        typescript: "^5.5.2",
        vitest: "^2.1.8"
      }
    };
  }
});

// src/config.ts
function getEnv(key) {
  if (globalThis[key]) return globalThis[key];
  if (typeof process !== "undefined" && process.env?.[key]) return process.env[key];
  return void 0;
}
var globalConfig = {
  apiUrl: getEnv("OAUTH_API_URL") || getEnv("API_URL") || "https://apis.do",
  clientId: getEnv("OAUTH_CLIENT_ID") || "client_01JQYTRXK9ZPD8JPJTKDCRB656",
  authKitDomain: getEnv("OAUTH_AUTHKIT_DOMAIN") || "login.oauth.do",
  fetch: globalThis.fetch,
  storagePath: getEnv("OAUTH_STORAGE_PATH")
};
function configure(config) {
  globalConfig = {
    ...globalConfig,
    ...config
  };
}
function getConfig() {
  return globalConfig;
}

// src/device.ts
async function authorizeDevice(options = {}) {
  const config = getConfig();
  if (!config.clientId) {
    throw new Error('Client ID is required for device authorization. Set OAUTH_CLIENT_ID or configure({ clientId: "..." })');
  }
  try {
    const url = "https://auth.apis.do/user_management/authorize/device";
    const body = new URLSearchParams({
      client_id: config.clientId,
      scope: "openid profile email"
    });
    if (options.provider) {
      body.set("provider", options.provider);
    }
    const response = await config.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Device authorization failed: ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Device authorization error:", error);
    throw error;
  }
}
async function pollForTokens(deviceCode, interval = 5, expiresIn = 600) {
  const config = getConfig();
  if (!config.clientId) {
    throw new Error("Client ID is required for token polling");
  }
  const startTime = Date.now();
  const timeout = expiresIn * 1e3;
  let currentInterval = interval * 1e3;
  while (true) {
    const elapsed = Date.now() - startTime;
    const timeRemaining = timeout - elapsed;
    if (timeRemaining <= 0) {
      throw new Error("Device authorization expired. Please try again.");
    }
    const sleepTime = Math.min(currentInterval, timeRemaining);
    await new Promise((resolve) => setTimeout(resolve, sleepTime));
    if (Date.now() - startTime > timeout) {
      throw new Error("Device authorization expired. Please try again.");
    }
    try {
      const response = await config.fetch("https://auth.apis.do/user_management/authenticate", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: config.clientId
        }).toString()
      });
      if (response.ok) {
        const data = await response.json();
        return data;
      }
      const errorData = await response.json().catch(() => ({ error: "unknown" }));
      const error = errorData.error || "unknown";
      switch (error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          currentInterval += 5e3;
          continue;
        case "access_denied":
          throw new Error("Access denied by user");
        case "expired_token":
          throw new Error("Device code expired");
        default:
          throw new Error(`Token polling failed: ${error}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      continue;
    }
  }
}

// src/auth.ts
async function resolveSecret(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.get === "function") {
    return await value.get();
  }
  return null;
}
function getEnv3(key) {
  if (globalThis[key]) return globalThis[key];
  if (typeof process !== "undefined" && process.env?.[key]) return process.env[key];
  return void 0;
}
async function logout(token) {
  const config = getConfig();
  const authToken = token || getEnv3("DO_TOKEN") || "";
  if (!authToken) {
    return;
  }
  try {
    const response = await config.fetch(`${config.apiUrl}/logout`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      console.warn(`Logout warning: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Logout error:", error);
  }
}
var REFRESH_BUFFER_MS = 5 * 60 * 1e3;
function isTokenExpired(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - REFRESH_BUFFER_MS;
}
async function getToken() {
  const adminToken = getEnv3("DO_ADMIN_TOKEN");
  if (adminToken) return adminToken;
  const doToken = getEnv3("DO_TOKEN");
  if (doToken) return doToken;
  try {
    const { env } = await import('cloudflare:workers');
    const cfAdminToken = await resolveSecret(env.DO_ADMIN_TOKEN);
    if (cfAdminToken) return cfAdminToken;
    const cfToken = await resolveSecret(env.DO_TOKEN);
    if (cfToken) return cfToken;
  } catch {
  }
  try {
    const { createSecureStorage: createSecureStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
    const config = getConfig();
    const storage2 = createSecureStorage2(config.storagePath);
    const tokenData = storage2.getTokenData ? await storage2.getTokenData() : null;
    if (tokenData) {
      if (!isTokenExpired(tokenData.expiresAt)) {
        return tokenData.accessToken;
      }
      if (tokenData.refreshToken) {
        try {
          const newTokens = await refreshAccessToken(tokenData.refreshToken);
          const expiresAt = newTokens.expires_in ? Date.now() + newTokens.expires_in * 1e3 : void 0;
          const newData = {
            accessToken: newTokens.access_token,
            refreshToken: newTokens.refresh_token || tokenData.refreshToken,
            expiresAt
          };
          if (storage2.setTokenData) {
            await storage2.setTokenData(newData);
          } else {
            await storage2.setToken(newTokens.access_token);
          }
          return newTokens.access_token;
        } catch {
          return null;
        }
      }
      return null;
    }
    return await storage2.getToken();
  } catch {
    return null;
  }
}
function auth() {
  return getToken;
}
async function refreshAccessToken(refreshToken) {
  const config = getConfig();
  if (!config.clientId) {
    throw new Error("Client ID is required for token refresh");
  }
  const response = await config.fetch("https://auth.apis.do/user_management/authenticate", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId
    }).toString()
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
  }
  return await response.json();
}

// src/cli.ts
init_storage();
var colors = {
  reset: "\x1B[0m",
  bright: "\x1B[1m",
  dim: "\x1B[2m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  red: "\x1B[31m",
  cyan: "\x1B[36m",
  gray: "\x1B[90m",
  blue: "\x1B[34m"
};
var storage = createSecureStorage();
function configureFromEnv() {
  configure({
    apiUrl: process.env.OAUTH_API_URL || process.env.API_URL || "https://apis.do",
    clientId: process.env.OAUTH_CLIENT_ID || "client_01JQYTRXK9ZPD8JPJTKDCRB656",
    authKitDomain: process.env.OAUTH_AUTHKIT_DOMAIN || "login.oauth.do"
  });
}
function printError(message, error) {
  console.error(`${colors.red}Error:${colors.reset} ${message}`);
  if (error && error.message) {
    console.error(error.message);
  }
  if (error && error.stack && process.env.DEBUG) {
    console.error(`
${colors.dim}Stack trace:${colors.reset}`);
    console.error(`${colors.dim}${error.stack}${colors.reset}`);
  }
}
function printSuccess(message) {
  console.log(`${colors.green}\u2713${colors.reset} ${message}`);
}
function printInfo(message) {
  console.log(`${colors.cyan}\u2139${colors.reset} ${message}`);
}
function printHelp() {
  console.log(`
${colors.bright}OAuth.do CLI${colors.reset}

${colors.cyan}Usage:${colors.reset}
  oauth.do <command> [options]

${colors.cyan}Commands:${colors.reset}
  login      Login using device authorization flow
  logout     Logout and remove stored credentials
  whoami     Show current authenticated user
  token      Display current authentication token
  status     Show authentication and storage status

${colors.cyan}Options:${colors.reset}
  --help, -h     Show this help message
  --version, -v  Show version
  --debug        Show debug information

${colors.cyan}Examples:${colors.reset}
  ${colors.gray}# Login to your account${colors.reset}
  oauth.do login

  ${colors.gray}# Check who is logged in${colors.reset}
  oauth.do whoami

  ${colors.gray}# Get your authentication token${colors.reset}
  oauth.do token

  ${colors.gray}# Logout${colors.reset}
  oauth.do logout

${colors.cyan}Environment Variables:${colors.reset}
  OAUTH_CLIENT_ID        Client ID for OAuth
  OAUTH_AUTHKIT_DOMAIN   AuthKit domain (default: login.oauth.do)
  OAUTH_API_URL          API base URL (default: https://apis.do)
  DEBUG                  Enable debug output
`);
}
function printVersion() {
  try {
    Promise.resolve().then(() => __toESM(require_package(), 1)).then((pkg) => {
      console.log(`oauth.do v${pkg.default.version}`);
    });
  } catch {
    console.log("oauth.do");
  }
}
async function loginCommand() {
  try {
    console.log(`${colors.bright}Starting OAuth login...${colors.reset}
`);
    printInfo("Requesting device authorization...");
    const authResponse = await authorizeDevice();
    console.log(`
${colors.bright}To complete login:${colors.reset}`);
    console.log(`
  1. Visit: ${colors.cyan}${authResponse.verification_uri}${colors.reset}`);
    console.log(`  2. Enter code: ${colors.bright}${colors.yellow}${authResponse.user_code}${colors.reset}`);
    console.log(`
  ${colors.dim}Or open this URL directly:${colors.reset}`);
    console.log(`  ${colors.blue}${authResponse.verification_uri_complete}${colors.reset}
`);
    const open = await import('open').catch(() => null);
    if (open) {
      try {
        await open.default(authResponse.verification_uri_complete);
        printSuccess("Opened browser for authentication");
      } catch {
        printInfo(`Could not open browser. Please visit the URL above manually.`);
      }
    } else {
      printInfo(`Could not open browser. Please visit the URL above manually.`);
    }
    console.log(`
${colors.dim}Waiting for authorization...${colors.reset}
`);
    const tokenResponse = await pollForTokens(
      authResponse.device_code,
      authResponse.interval,
      authResponse.expires_in
    );
    await storage.setToken(tokenResponse.access_token);
    const authResult = await auth(tokenResponse.access_token);
    printSuccess("Login successful!");
    if (authResult.user) {
      console.log(`
${colors.dim}Logged in as:${colors.reset}`);
      if (authResult.user.name) {
        console.log(`  ${colors.bright}${authResult.user.name}${colors.reset}`);
      }
      if (authResult.user.email) {
        console.log(`  ${colors.gray}${authResult.user.email}${colors.reset}`);
      }
    }
    const fileStorage = storage;
    if (typeof fileStorage.getStorageInfo === "function") {
      const storageInfo = await fileStorage.getStorageInfo();
      console.log(`
${colors.dim}Token stored in: ${colors.green}~/.oauth.do/token${colors.reset}${colors.reset}`);
    }
  } catch (error) {
    printError("Login failed", error instanceof Error ? error : void 0);
    process.exit(1);
  }
}
async function logoutCommand() {
  try {
    const token = await storage.getToken();
    if (!token) {
      printInfo("Not logged in");
      return;
    }
    await logout(token);
    await storage.removeToken();
    printSuccess("Logged out successfully");
  } catch (error) {
    printError("Logout failed", error instanceof Error ? error : void 0);
    process.exit(1);
  }
}
async function whoamiCommand() {
  try {
    const token = await storage.getToken();
    if (!token) {
      console.log(`${colors.dim}Not logged in${colors.reset}`);
      console.log(`
Run ${colors.cyan}oauth.do login${colors.reset} to authenticate`);
      return;
    }
    const authResult = await auth(token);
    if (!authResult.user) {
      console.log(`${colors.dim}Not authenticated${colors.reset}`);
      console.log(`
Run ${colors.cyan}oauth.do login${colors.reset} to authenticate`);
      return;
    }
    console.log(`${colors.bright}Authenticated as:${colors.reset}`);
    if (authResult.user.name) {
      console.log(`  ${colors.green}Name:${colors.reset} ${authResult.user.name}`);
    }
    if (authResult.user.email) {
      console.log(`  ${colors.green}Email:${colors.reset} ${authResult.user.email}`);
    }
    if (authResult.user.id) {
      console.log(`  ${colors.green}ID:${colors.reset} ${authResult.user.id}`);
    }
  } catch (error) {
    printError("Failed to get user info", error instanceof Error ? error : void 0);
    process.exit(1);
  }
}
async function tokenCommand() {
  try {
    const token = await storage.getToken();
    if (!token) {
      console.log(`${colors.dim}No token found${colors.reset}`);
      console.log(`
Run ${colors.cyan}oauth.do login${colors.reset} to authenticate`);
      return;
    }
    console.log(token);
  } catch (error) {
    printError("Failed to get token", error instanceof Error ? error : void 0);
    process.exit(1);
  }
}
async function statusCommand() {
  try {
    console.log(`${colors.bright}OAuth.do Status${colors.reset}
`);
    const fileStorage = storage;
    if (typeof fileStorage.getStorageInfo === "function") {
      const storageInfo = await fileStorage.getStorageInfo();
      console.log(`${colors.cyan}Storage:${colors.reset} ${colors.green}Secure File${colors.reset}`);
      console.log(`  ${colors.dim}Using ~/.oauth.do/token with 0600 permissions${colors.reset}`);
    }
    const token = await storage.getToken();
    if (!token) {
      console.log(`
${colors.cyan}Auth:${colors.reset} ${colors.dim}Not authenticated${colors.reset}`);
      console.log(`
Run ${colors.cyan}oauth.do login${colors.reset} to authenticate`);
      return;
    }
    const authResult = await auth(token);
    if (authResult.user) {
      console.log(`
${colors.cyan}Auth:${colors.reset} ${colors.green}Authenticated${colors.reset}`);
      if (authResult.user.email) {
        console.log(`  ${colors.dim}${authResult.user.email}${colors.reset}`);
      }
    } else {
      console.log(`
${colors.cyan}Auth:${colors.reset} ${colors.yellow}Token expired or invalid${colors.reset}`);
      console.log(`
Run ${colors.cyan}oauth.do login${colors.reset} to re-authenticate`);
    }
  } catch (error) {
    printError("Failed to get status", error instanceof Error ? error : void 0);
    process.exit(1);
  }
}
async function autoLoginOrShowUser() {
  try {
    const token = await storage.getToken();
    if (token) {
      const authResult = await auth(token);
      if (authResult.user) {
        console.log(`${colors.green}\u2713${colors.reset} Already authenticated
`);
        if (authResult.user.name) {
          console.log(`  ${colors.bright}${authResult.user.name}${colors.reset}`);
        }
        if (authResult.user.email) {
          console.log(`  ${colors.gray}${authResult.user.email}${colors.reset}`);
        }
        if (authResult.user.id) {
          console.log(`  ${colors.dim}ID: ${authResult.user.id}${colors.reset}`);
        }
        return;
      }
      printInfo("Session expired, logging in again...\n");
    }
    await loginCommand();
  } catch (error) {
    await loginCommand();
  }
}
async function main() {
  configureFromEnv();
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    printVersion();
    process.exit(0);
  }
  if (args.includes("--debug")) {
    process.env.DEBUG = "true";
  }
  const command = args.find((arg) => !arg.startsWith("--"));
  switch (command) {
    case "login":
      await loginCommand();
      break;
    case void 0:
      await autoLoginOrShowUser();
      break;
    case "logout":
      await logoutCommand();
      break;
    case "whoami":
      await whoamiCommand();
      break;
    case "token":
      await tokenCommand();
      break;
    case "status":
      await statusCommand();
      break;
    default:
      printError(`Unknown command: ${command}`);
      console.log(`
Run ${colors.cyan}oauth.do --help${colors.reset} for usage information`);
      process.exit(1);
  }
}
main().catch((error) => {
  printError("Unexpected error", error);
  process.exit(1);
});

export { main };
//# sourceMappingURL=cli.js.map
//# sourceMappingURL=cli.js.map