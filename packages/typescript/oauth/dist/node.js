import { DotDo } from 'platform.do';
export { PoolTimeoutError, connect } from 'platform.do';
import { connect } from 'rpc.do';
export { CapabilityError, CapnwebError, ConnectionError, RpcClient, RpcError, TimeoutError, connect as connectRpc } from 'rpc.do';

var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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
        const storage = await this.getPreferredStorage();
        await storage.setToken(token);
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
async function getUser(token) {
  const config = getConfig();
  const authToken = token || getEnv3("DO_TOKEN") || "";
  if (!authToken) {
    return { user: null };
  }
  try {
    const response = await config.fetch(`${config.apiUrl}/me`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      if (response.status === 401) {
        return { user: null };
      }
      throw new Error(`Authentication failed: ${response.statusText}`);
    }
    const user = await response.json();
    return { user, token: authToken };
  } catch (error) {
    console.error("Auth error:", error);
    return { user: null };
  }
}
async function login(credentials) {
  const config = getConfig();
  try {
    const response = await config.fetch(`${config.apiUrl}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(credentials)
    });
    if (!response.ok) {
      throw new Error(`Login failed: ${response.statusText}`);
    }
    const data = await response.json();
    return { user: data.user, token: data.token };
  } catch (error) {
    console.error("Login error:", error);
    throw error;
  }
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
    const storage = createSecureStorage2(config.storagePath);
    const tokenData = storage.getTokenData ? await storage.getTokenData() : null;
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
          if (storage.setTokenData) {
            await storage.setTokenData(newData);
          } else {
            await storage.setToken(newTokens.access_token);
          }
          return newTokens.access_token;
        } catch {
          return null;
        }
      }
      return null;
    }
    return await storage.getToken();
  } catch {
    return null;
  }
}
async function isAuthenticated(token) {
  const result = await getUser(token);
  return result.user !== null;
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
async function getStoredTokenData() {
  try {
    const { createSecureStorage: createSecureStorage2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));
    const config = getConfig();
    const storage = createSecureStorage2(config.storagePath);
    if (storage.getTokenData) {
      return await storage.getTokenData();
    }
    const token = await storage.getToken();
    return token ? { accessToken: token } : null;
  } catch {
    return null;
  }
}
function buildAuthUrl(options) {
  const config = getConfig();
  const clientId = options.clientId || config.clientId;
  const authDomain = options.authDomain || config.authKitDomain;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: options.redirectUri,
    response_type: options.responseType || "code",
    scope: options.scope || "openid profile email"
  });
  if (options.state) {
    params.set("state", options.state);
  }
  return `https://${authDomain}/authorize?${params.toString()}`;
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

// src/github-device.ts
async function startGitHubDeviceFlow(options) {
  const { clientId, scope = "user:email read:user" } = options;
  const fetchImpl = options.fetch || globalThis.fetch;
  if (!clientId) {
    throw new Error("GitHub client ID is required for device authorization");
  }
  try {
    const url = "https://github.com/login/device/code";
    const body = new URLSearchParams({
      client_id: clientId,
      scope
    });
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub device authorization failed: ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval
    };
  } catch (error) {
    console.error("GitHub device authorization error:", error);
    throw error;
  }
}
async function pollGitHubDeviceFlow(deviceCode, options) {
  const { clientId, interval = 5, expiresIn = 900 } = options;
  const fetchImpl = options.fetch || globalThis.fetch;
  if (!clientId) {
    throw new Error("GitHub client ID is required for token polling");
  }
  const startTime = Date.now();
  const timeout = expiresIn * 1e3;
  let currentInterval = interval * 1e3;
  while (true) {
    if (Date.now() - startTime > timeout) {
      throw new Error("GitHub device authorization expired. Please try again.");
    }
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
    try {
      const url = "https://github.com/login/oauth/access_token";
      const body = new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      });
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body
      });
      const data = await response.json();
      if ("access_token" in data) {
        return {
          accessToken: data.access_token,
          tokenType: data.token_type,
          scope: data.scope
        };
      }
      const error = data.error || "unknown";
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
          throw new Error(`GitHub token polling failed: ${error}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      continue;
    }
  }
}
async function getGitHubUser(accessToken, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (!accessToken) {
    throw new Error("GitHub access token is required");
  }
  try {
    const response = await fetchImpl("https://api.github.com/user", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub user fetch failed: ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    return {
      id: data.id,
      login: data.login,
      email: data.email,
      name: data.name,
      avatarUrl: data.avatar_url
    };
  } catch (error) {
    console.error("GitHub user fetch error:", error);
    throw error;
  }
}

// src/index.ts
init_storage();
async function createAuthenticatedClient(options = {}) {
  const { token: explicitToken, requireAuth = false, ...dotdoOptions } = options;
  let token = explicitToken || null;
  let tokenData = null;
  if (!token) {
    tokenData = await getStoredTokenData();
    if (tokenData) {
      token = tokenData.accessToken;
    } else {
      token = await getToken();
    }
  }
  if (requireAuth && !token) {
    throw new Error(
      "Authentication required but no token available. Please login using `oauth.do login` or provide a token explicitly."
    );
  }
  const client = new DotDo({
    ...dotdoOptions,
    auth: token ? { accessToken: token } : void 0
  });
  return {
    client,
    token,
    tokenData,
    isAuthenticated: !!token
  };
}
async function connectAuthenticated(service, options = {}) {
  const { client } = await createAuthenticatedClient(options);
  return client.connect(service);
}
function createAuthFactory(baseOptions = {}) {
  return async (options = {}) => {
    return createAuthenticatedClient({
      ...baseOptions,
      ...options
    });
  };
}
async function createDirectRpcClient(url, options = {}) {
  const { token: explicitToken, requireAuth = false, ...rpcOptions } = options;
  let token = explicitToken || null;
  if (!token) {
    token = await getToken();
  }
  if (requireAuth && !token) {
    throw new Error(
      "Authentication required but no token available. Please login using `oauth.do login` or provide a token explicitly."
    );
  }
  return connect(url, {
    ...rpcOptions,
    token: token || void 0
  });
}
async function createAuthenticatedRpcSession(options = {}) {
  const { token: explicitToken, requireAuth = false } = options;
  let token = explicitToken || null;
  let tokenData = null;
  if (!token) {
    tokenData = await getStoredTokenData();
    if (tokenData) {
      token = tokenData.accessToken;
    } else {
      token = await getToken();
    }
  }
  if (requireAuth && !token) {
    throw new Error(
      "Authentication required but no token available. Please login using `oauth.do login` or provide a token explicitly."
    );
  }
  return {
    token,
    tokenData,
    isAuthenticated: !!token,
    connect: (url, connectOptions) => {
      return connect(url, {
        ...connectOptions,
        token: token || void 0
      });
    }
  };
}

// src/login.ts
init_storage();
var REFRESH_BUFFER_MS2 = 5 * 60 * 1e3;
var loginInProgress = null;
var refreshInProgress = null;
function isTokenExpired2(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - REFRESH_BUFFER_MS2;
}
async function doRefresh(tokenData, storage) {
  if (refreshInProgress) {
    return refreshInProgress;
  }
  refreshInProgress = (async () => {
    try {
      const newTokens = await refreshAccessToken(tokenData.refreshToken);
      const expiresAt = newTokens.expires_in ? Date.now() + newTokens.expires_in * 1e3 : void 0;
      const newData = {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || tokenData.refreshToken,
        expiresAt
      };
      if (storage?.setTokenData) {
        await storage.setTokenData(newData);
      } else if (storage?.setToken) {
        await storage.setToken(newTokens.access_token);
      }
      return { token: newTokens.access_token, isNewLogin: false };
    } finally {
      refreshInProgress = null;
    }
  })();
  return refreshInProgress;
}
async function doDeviceLogin(options) {
  if (loginInProgress) {
    return loginInProgress;
  }
  const config = getConfig();
  const {
    openBrowser = true,
    print = console.log,
    provider,
    storage = createSecureStorage(config.storagePath)
  } = options;
  loginInProgress = (async () => {
    try {
      print("\nLogging in...\n");
      const authResponse = await authorizeDevice({ provider });
      print(`To complete login:`);
      print(`  1. Visit: ${authResponse.verification_uri}`);
      print(`  2. Enter code: ${authResponse.user_code}`);
      print(`
  Or open: ${authResponse.verification_uri_complete}
`);
      if (openBrowser) {
        try {
          const open = await import('open');
          await open.default(authResponse.verification_uri_complete);
          print("Browser opened automatically\n");
        } catch {
        }
      }
      print("Waiting for authorization...\n");
      const tokenResponse = await pollForTokens(
        authResponse.device_code,
        authResponse.interval,
        authResponse.expires_in
      );
      const expiresAt = tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1e3 : void 0;
      const newData = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt
      };
      if (storage.setTokenData) {
        await storage.setTokenData(newData);
      } else {
        await storage.setToken(tokenResponse.access_token);
      }
      print("Login successful!\n");
      return { token: tokenResponse.access_token, isNewLogin: true };
    } finally {
      loginInProgress = null;
    }
  })();
  return loginInProgress;
}
async function ensureLoggedIn(options = {}) {
  const config = getConfig();
  const { storage = createSecureStorage(config.storagePath) } = options;
  const tokenData = storage.getTokenData ? await storage.getTokenData() : null;
  const existingToken = tokenData?.accessToken || await storage.getToken();
  if (existingToken) {
    if (tokenData?.expiresAt && !isTokenExpired2(tokenData.expiresAt)) {
      return { token: existingToken, isNewLogin: false };
    }
    if (tokenData?.refreshToken) {
      try {
        return await doRefresh(tokenData, storage);
      } catch (error) {
        console.warn("Token refresh failed:", error);
      }
    }
    if (!tokenData?.expiresAt && !tokenData?.refreshToken) {
      const { user } = await getUser(existingToken);
      if (user) {
        return { token: existingToken, isNewLogin: false };
      }
    }
  }
  return doDeviceLogin(options);
}
async function forceLogin(options = {}) {
  const config = getConfig();
  const { storage = createSecureStorage(config.storagePath) } = options;
  await storage.removeToken();
  return ensureLoggedIn(options);
}
async function ensureLoggedOut(options = {}) {
  const config = getConfig();
  const { print = console.log, storage = createSecureStorage(config.storagePath) } = options;
  await storage.removeToken();
  print("Logged out successfully\n");
}

export { CompositeTokenStorage, FileTokenStorage, KeychainTokenStorage, LocalStorageTokenStorage, MemoryTokenStorage, SecureFileTokenStorage, auth, authorizeDevice, buildAuthUrl, configure, connectAuthenticated, createAuthFactory, createAuthenticatedClient, createAuthenticatedRpcSession, createDirectRpcClient, createSecureStorage, ensureLoggedIn, ensureLoggedOut, forceLogin, getConfig, getGitHubUser, getToken, getUser, isAuthenticated, login, logout, pollForTokens, pollGitHubDeviceFlow, startGitHubDeviceFlow };
//# sourceMappingURL=node.js.map
//# sourceMappingURL=node.js.map