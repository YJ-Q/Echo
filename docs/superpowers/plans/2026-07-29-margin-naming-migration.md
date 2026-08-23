# Margin Naming Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前产品、配置、运行入口和生成物统一为 Margin，同时保持旧 `ECHO_*` 配置、`echo.sqlite`、旧备份及 legacy schema 完整兼容。

**Architecture:** 在 `src/config/env.js` 集中解析品牌配置、兼容变量和数据库路径，其他模块只消费解析结果；用户可见品牌与新生成物改为 Margin。数据库/API 中的 `echo_response`、`echo_reflection`、`echo_state` 和 `echo_interaction_style` 保留为 legacy schema，不做破坏性迁移。

**Tech Stack:** Node.js 20+、ES modules、Express、SQLite、Electron、Node test runner、Docker Compose、Windows CMD。

## Global Constraints

- 当前正式产品名为 `Margin`；`Echo` 只允许出现在兼容说明、legacy schema 和产品演进历史中。
- 配置优先级固定为 `MARGIN_*` → `ECHO_*` → Margin 默认值。
- 新安装默认数据库为 `data/margin.sqlite`。
- 已存在 `data/echo.sqlite` 且不存在 `data/margin.sqlite` 时继续使用旧库，不自动移动、复制、合并或删除。
- `echo_response`、`echo_reflection`、`echo_state`、`echo_interaction_style` 本阶段不得改名。
- 新备份使用 `margin-export-*` 和 `margin-backup-*`；旧快照必须继续可导入。
- Case Study 的“从 Echo 到 Margin”章节和历史 Git 记录不得机械替换。
- 公开 GitHub URL 在仓库真正更名前继续使用现有可访问地址。
- 项目测试命令为 `node --test test`，不得使用会递归扫描 `.worktrees` 的裸 `node --test`。
- 实施前必须建立隔离工作树；主工作区现有 `.env.example`、`package.json` 和设计材料修改属于用户，禁止覆盖或暂存。

---

### Task 1: 集中配置优先级和兼容警告

**Files:**
- Modify: `src/config/env.js`
- Create: `test/runtimeConfig.test.js`

**Interfaces:**
- Consumes: `process.env` 或测试传入的普通对象。
- Produces: `loadRuntimeConfig(env, options)`，返回 `{ port, nodeEnv, llmProvider, logLevel, dbPath, warnings }`。
- Produces: `options.rootDir` 用于测试默认数据库路径；`options.pathExists` 用于无文件系统副作用地测试路径选择。

- [ ] **Step 1: 写配置优先级失败测试**

在 `test/runtimeConfig.test.js` 创建测试：

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadRuntimeConfig } from '../src/config/env.js';

const rootDir = path.resolve('C:/margin-test-root');

test('Margin variables take priority over legacy Echo variables', () => {
  const config = loadRuntimeConfig({
    MARGIN_LOG_LEVEL: 'debug',
    ECHO_LOG_LEVEL: 'error',
    MARGIN_LLM_PROVIDER: 'local',
    ECHO_LLM_PROVIDER: 'openai',
    MARGIN_DB_PATH: './data/custom-margin.sqlite',
    ECHO_DB_PATH: './data/custom-echo.sqlite'
  }, {
    rootDir,
    pathExists: () => false
  });

  assert.equal(config.logLevel, 'debug');
  assert.equal(config.llmProvider, 'local');
  assert.equal(config.dbPath, path.resolve(rootDir, 'data/custom-margin.sqlite'));
  assert.match(config.warnings.join('\n'), /ECHO_LOG_LEVEL.*ignored/u);
  assert.match(config.warnings.join('\n'), /ECHO_LLM_PROVIDER.*ignored/u);
  assert.match(config.warnings.join('\n'), /ECHO_DB_PATH.*ignored/u);
});

test('legacy Echo variables remain supported with deprecation warnings', () => {
  const config = loadRuntimeConfig({
    ECHO_LOG_LEVEL: 'warn',
    ECHO_LLM_PROVIDER: 'local',
    ECHO_DB_PATH: './data/echo.sqlite'
  }, {
    rootDir,
    pathExists: () => false
  });

  assert.equal(config.logLevel, 'warn');
  assert.equal(config.llmProvider, 'local');
  assert.equal(config.dbPath, path.resolve(rootDir, 'data/echo.sqlite'));
  assert.match(config.warnings.join('\n'), /ECHO_LOG_LEVEL is deprecated/u);
  assert.match(config.warnings.join('\n'), /ECHO_LLM_PROVIDER is deprecated/u);
  assert.match(config.warnings.join('\n'), /ECHO_DB_PATH is deprecated/u);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test test/runtimeConfig.test.js
```

Expected: FAIL，因为当前配置层不读取 `MARGIN_*`，也不返回 `dbPath`。

- [ ] **Step 3: 实现统一变量解析**

在 `src/config/env.js` 增加：

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(moduleDir, '..', '..');

function resolveCompatValue(env, marginKey, echoKey, fallback, warnings) {
  const marginValue = String(env[marginKey] || '').trim();
  const echoValue = String(env[echoKey] || '').trim();

  if (marginValue) {
    if (echoValue) {
      warnings.push(`${echoKey} is ignored because ${marginKey} is set.`);
    }
    return { value: marginValue, source: marginKey };
  }

  if (echoValue) {
    warnings.push(`${echoKey} is deprecated; use ${marginKey}.`);
    return { value: echoValue, source: echoKey };
  }

  return { value: fallback, source: 'default' };
}
```

将导出函数签名改为：

```js
export function loadRuntimeConfig(
  env = process.env,
  {
    rootDir = defaultRootDir,
    pathExists = fs.existsSync
  } = {}
) {
```

函数内先创建 `warnings`，再通过 `resolveCompatValue` 解析 log level、provider 和显式数据库路径。错误信息使用实际生效变量：

```js
const providerSetting = resolveCompatValue(
  env,
  'MARGIN_LLM_PROVIDER',
  'ECHO_LLM_PROVIDER',
  'local',
  warnings
);
const llmProvider = providerSetting.value.toLowerCase();

if (!SUPPORTED_PROVIDERS.includes(llmProvider)) {
  errors.push(`Unsupported ${providerSetting.source === 'default' ? 'MARGIN_LLM_PROVIDER' : providerSetting.source}: ${llmProvider}`);
}
```

- [ ] **Step 4: 补齐默认数据库路径测试**

继续在 `test/runtimeConfig.test.js` 增加：

```js
test('a new installation defaults to margin.sqlite', () => {
  const config = loadRuntimeConfig({}, {
    rootDir,
    pathExists: () => false
  });

  assert.equal(config.dbPath, path.join(rootDir, 'data', 'margin.sqlite'));
});

test('an existing echo.sqlite remains the fallback when margin.sqlite is absent', () => {
  const legacyPath = path.join(rootDir, 'data', 'echo.sqlite');
  const config = loadRuntimeConfig({}, {
    rootDir,
    pathExists: (candidate) => candidate === legacyPath
  });

  assert.equal(config.dbPath, legacyPath);
  assert.match(config.warnings.join('\n'), /legacy database.*echo\.sqlite/u);
});

test('margin.sqlite wins when both default databases exist', () => {
  const config = loadRuntimeConfig({}, {
    rootDir,
    pathExists: () => true
  });

  assert.equal(config.dbPath, path.join(rootDir, 'data', 'margin.sqlite'));
  assert.match(config.warnings.join('\n'), /legacy database.*not merged/u);
});
```

实现路径解析：

```js
function resolveDatabasePath({ env, rootDir, pathExists, warnings }) {
  const setting = resolveCompatValue(
    env,
    'MARGIN_DB_PATH',
    'ECHO_DB_PATH',
    '',
    warnings
  );

  if (setting.value) {
    return path.resolve(rootDir, setting.value);
  }

  const marginPath = path.join(rootDir, 'data', 'margin.sqlite');
  const echoPath = path.join(rootDir, 'data', 'echo.sqlite');
  const marginExists = pathExists(marginPath);
  const echoExists = pathExists(echoPath);

  if (marginExists) {
    if (echoExists) {
      warnings.push('A legacy database also exists at data/echo.sqlite; it was not merged automatically.');
    }
    return marginPath;
  }

  if (echoExists) {
    warnings.push('Using the legacy database at data/echo.sqlite; set MARGIN_DB_PATH to migrate explicitly.');
    return echoPath;
  }

  return marginPath;
}
```

- [ ] **Step 5: 运行聚焦测试**

Run:

```powershell
node --test test/runtimeConfig.test.js
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/config/env.js test/runtimeConfig.test.js
git commit -m "feat: add Margin configuration compatibility"
```

---

### Task 2: 让数据库和 provider 只消费统一配置

**Files:**
- Modify: `src/storage/memoryStore.js`
- Modify: `src/services/llm/providerRegistry.js`
- Modify: `src/services/echoAgent.js`
- Modify: `src/server.js`
- Modify: `test/runtimeConfig.test.js`
- Modify: `test/api.test.js`

**Interfaces:**
- Consumes: Task 1 的 `loadRuntimeConfig()`。
- Produces: `configureMemoryStore({ dbPath })`，在首次打开数据库前设置当前进程的路径。
- Produces: `configureProviderRegistry({ requestedProvider })` 和 `resolveMarginProvider()`；保留 `resolveEchoProvider` 作为本版本内部兼容别名。

- [ ] **Step 1: 写数据库显式配置失败测试**

在 `test/runtimeConfig.test.js` 增加：

```js
import { getMemoryStorePaths, configureMemoryStore } from '../src/storage/memoryStore.js';

test('memory store consumes the resolved Margin database path', () => {
  const dbPath = path.join(rootDir, 'data', 'configured-margin.sqlite');
  configureMemoryStore({ dbPath });
  assert.equal(getMemoryStorePaths().dbPath, dbPath);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test test/runtimeConfig.test.js
```

Expected: FAIL，`configureMemoryStore` 尚不存在。

- [ ] **Step 3: 实现存储配置入口**

在 `src/storage/memoryStore.js` 模块级状态中增加：

```js
let configuredDbPath = '';

export function configureMemoryStore({ dbPath } = {}) {
  configuredDbPath = dbPath ? path.resolve(dbPath) : '';
}
```

将 `getStorePaths()` 的数据库路径改为：

```js
function getStorePaths() {
  const dbPath = configuredDbPath
    || path.join(rootDir, 'data', 'margin.sqlite');
  const dataDir = path.dirname(dbPath);

  return {
    dataDir,
    dbPath,
    legacyMemoryPath: path.join(dataDir, 'memory.json')
  };
}
```

测试清理阶段调用 `configureMemoryStore({ dbPath: '' })`，避免测试间状态泄漏。

- [ ] **Step 4: 集中 provider 选择**

将 `src/services/llm/providerRegistry.js` 改为：

```js
let configuredProvider = 'local';

export function configureProviderRegistry({ requestedProvider } = {}) {
  configuredProvider = String(requestedProvider || 'local').trim().toLowerCase();
}

export function resolveMarginProvider() {
  const providers = {
    openai: createOpenAIProvider(),
    anthropic: createAnthropicProvider(),
    siliconflow: createSiliconFlowProvider(),
    local: createLocalProvider()
  };

  return providers[configuredProvider] || providers.local;
}

export const resolveEchoProvider = resolveMarginProvider;
```

`src/services/echoAgent.js` 将导入和调用改为 `resolveMarginProvider()`。业务调用方不得读取环境变量。

- [ ] **Step 5: 在启动入口注入配置**

在 `src/server.js` 中：

```js
import { configureMemoryStore } from './storage/memoryStore.js';
import { configureProviderRegistry } from './services/llm/providerRegistry.js';

const config = loadRuntimeConfig();
configureMemoryStore({ dbPath: config.dbPath });
configureProviderRegistry({ requestedProvider: config.llmProvider });
```

确保 `createApp()` 之前完成注入，并在启动日志结构中增加不包含用户路径的字段：

```js
logger.info(`Margin backend listening on http://localhost:${config.port}`, {
  provider: config.llmProvider,
  node_env: config.nodeEnv,
  database: path.basename(config.dbPath)
});
```

- [ ] **Step 6: 将 API 测试改用 `MARGIN_DB_PATH` 对应的配置入口**

测试中不再依赖运行时直接读取 `ECHO_DB_PATH`。在 `startTestServer()` 中：

```js
const config = loadRuntimeConfig({
  MARGIN_DB_PATH: dbPath,
  MARGIN_LLM_PROVIDER: 'local'
}, {
  rootDir: tempDir,
  pathExists: () => false
});
configureMemoryStore({ dbPath: config.dbPath });
```

cleanup 中重置：

```js
configureMemoryStore({ dbPath: '' });
```

- [ ] **Step 7: 运行测试并提交**

Run:

```powershell
node --test test/runtimeConfig.test.js test/api.test.js
```

Expected: PASS。

```powershell
git add src/storage/memoryStore.js src/services/llm/providerRegistry.js src/services/echoAgent.js src/server.js test/runtimeConfig.test.js test/api.test.js
git commit -m "refactor: inject Margin runtime configuration"
```

---

### Task 3: 更新当前产品元信息和运行文案

**Files:**
- Modify: `src/app.js`
- Modify: `src/services/echoStateEngine.js`
- Modify: `src/services/llm/echoPrompt.js`
- Modify: `src/services/toneProfile.js`
- Modify: `src/services/profileDictionary.js`
- Modify: `public/viewModels.js`
- Modify: `electron/main.js`
- Modify: `test/api.test.js`
- Create: `test/marginBrand.test.js`

**Interfaces:**
- API `/api`、`/health`、`/state` 的当前品牌名称为 `Margin`。
- legacy schema 字段保持不变。

- [ ] **Step 1: 写品牌失败测试**

创建 `test/marginBrand.test.js`：

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const currentProductFiles = [
  'src/app.js',
  'src/server.js',
  'electron/main.js',
  'src/services/echoStateEngine.js',
  'src/services/llm/echoPrompt.js',
  'src/services/toneProfile.js',
  'src/services/profileDictionary.js',
  'public/viewModels.js'
];

test('current runtime copy uses Margin rather than Echo', async () => {
  for (const file of currentProductFiles) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /(?:name:\s*['"]Echo['"]|Echo backend|Echo API|Invalid Echo configuration|You are Echo|Reply as Echo|Echo interaction style)/u,
      file
    );
  }
});
```

在 `test/api.test.js` 中增加 `/api`、`/health`、`/state` 对 `name === 'Margin'` 的断言。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test test/marginBrand.test.js test/api.test.js
```

Expected: FAIL，当前运行文案仍包含 Echo。

- [ ] **Step 3: 修改当前品牌文案**

完成以下精确语义替换：

```text
Echo backend → Margin backend
Echo API → Margin API
Invalid Echo configuration → Invalid Margin configuration
Echo became quiet for a moment. → Margin became quiet for a moment.
You are Echo. → You are Margin.
Reply as Echo → Reply as Margin
Echo second-self voice → Margin second-self voice
Echo 互动风格 → Margin 互动风格
[Echo] Using mock view model → [Margin] Using mock view model
```

将 `/api`、`/health`、`/state` 返回的 `name` 改为 `Margin`。

不得改动：

```text
echo_response
echo_reflection
echo_state
echo_interaction_style
```

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
node --test test/marginBrand.test.js test/api.test.js
```

Expected: PASS。

```powershell
git add src/app.js src/services/echoStateEngine.js src/services/llm/echoPrompt.js src/services/toneProfile.js src/services/profileDictionary.js public/viewModels.js electron/main.js test/api.test.js test/marginBrand.test.js
git commit -m "refactor: use Margin in current runtime copy"
```

---

### Task 4: 迁移包、Docker 和启动入口

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Create: `run-margin-local.cmd`
- Create: `run-margin-desktop.cmd`
- Modify: `run-echo-local.cmd`
- Modify: `run-echo-desktop.cmd`
- Modify: `scripts/deploy.sh`
- Modify: `test/marginBrand.test.js`

**Interfaces:**
- 新入口为 `run-margin-local.cmd` 和 `run-margin-desktop.cmd`。
- 旧脚本只负责显示弃用信息并转发。
- Docker service、container 和 volume 使用 Margin 命名。

- [ ] **Step 1: 写静态入口失败测试**

在 `test/marginBrand.test.js` 增加：

```js
test('package and deployment entry points use Margin defaults', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const envExample = await readFile('.env.example', 'utf8');
  const compose = await readFile('docker-compose.yml', 'utf8');
  const dockerfile = await readFile('Dockerfile', 'utf8');

  assert.equal(packageJson.name, 'margin');
  assert.equal(packageJson.scripts.test, 'node --test test');
  assert.match(envExample, /MARGIN_DB_PATH=\.\/data\/margin\.sqlite/u);
  assert.match(envExample, /MARGIN_LLM_PROVIDER=local/u);
  assert.match(compose, /services:\s*\n\s*margin:/u);
  assert.match(compose, /MARGIN_DB_PATH=\/app\/data\/margin\.sqlite/u);
  assert.match(dockerfile, /ENV MARGIN_DB_PATH=\/app\/data\/margin\.sqlite/u);
});

test('legacy launchers delegate to Margin launchers', async () => {
  const oldLocal = await readFile('run-echo-local.cmd', 'utf8');
  const oldDesktop = await readFile('run-echo-desktop.cmd', 'utf8');
  assert.match(oldLocal, /deprecated.*run-margin-local\.cmd/iu);
  assert.match(oldDesktop, /deprecated.*run-margin-desktop\.cmd/iu);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test test/marginBrand.test.js
```

Expected: FAIL。

- [ ] **Step 3: 创建 Margin 启动脚本并改造旧包装器**

`run-margin-local.cmd` 使用当前 `run-echo-local.cmd` 的启动逻辑。

`run-echo-local.cmd` 只保留：

```bat
@echo off
echo [deprecated] run-echo-local.cmd has moved to run-margin-local.cmd.
call "%~dp0run-margin-local.cmd" %*
```

桌面脚本采用相同结构。

- [ ] **Step 4: 更新包和容器配置**

在 `package.json` 中设置：

```json
{
  "name": "margin",
  "description": "Margin - a memory-driven second-self personal AI companion.",
  "scripts": {
    "test": "node --test test"
  },
  "keywords": [
    "margin",
    "ai-companion",
    "memory",
    "reflection"
  ]
}
```

保留现有其他 scripts，包括主工作区可能存在的 `design:review`。运行：

```powershell
npm install --package-lock-only --ignore-scripts
```

机械更新 `package-lock.json` 中根包名称。

Docker Compose 使用：

```yaml
services:
  margin:
    container_name: margin
    volumes:
      - margin-data:/app/data
    environment:
      - MARGIN_DB_PATH=/app/data/margin.sqlite
      - MARGIN_LLM_PROVIDER=siliconflow

volumes:
  margin-data:
```

- [ ] **Step 5: 运行测试并提交**

Run:

```powershell
node --test test/marginBrand.test.js
npm test
```

Expected: 两条命令均 PASS，`npm test` 只扫描 `test/`。

```powershell
git add package.json package-lock.json .env.example Dockerfile docker-compose.yml run-margin-local.cmd run-margin-desktop.cmd run-echo-local.cmd run-echo-desktop.cmd scripts/deploy.sh test/marginBrand.test.js
git commit -m "chore: add Margin runtime entry points"
```

---

### Task 5: 迁移备份生成物并验证旧快照

**Files:**
- Modify: `src/services/backupService.js`
- Modify: `scripts/backup-data.js`
- Modify: `scripts/import-data.js`
- Modify: `test/api.test.js`
- Modify: `test/marginBrand.test.js`

**Interfaces:**
- 保留函数 `exportEchoDataSnapshot` 和 `importEchoDataSnapshot` 作为本版本兼容 API。
- 新增别名 `exportMarginDataSnapshot` 和 `importMarginDataSnapshot`。
- 新文件名为 `margin-export-*` 和 `margin-backup-*`。

- [ ] **Step 1: 写新文件名与旧快照失败测试**

修改 `test/api.test.js` 的备份断言：

```js
assert.match(path.basename(snapshot.file_path), /^margin-export-.+\.json$/u);
assert.match(path.basename(sqliteBackup.file_path), /^margin-backup-.+\.sqlite$/u);
```

旧快照夹具继续包含 `echo_response` 和 `echo_reflection`，并断言导入成功。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test test/api.test.js
```

Expected: FAIL，当前生成物仍以 `echo-` 开头。

- [ ] **Step 3: 更新生成物和当前错误文案**

在 `src/services/backupService.js` 中：

```js
const filePath = path.join(targetDir, `margin-export-${timestamp}.json`);
const filePath = path.join(targetDir, `margin-backup-${timestamp}.sqlite`);

export const exportMarginDataSnapshot = exportEchoDataSnapshot;
export const importMarginDataSnapshot = importEchoDataSnapshot;
```

将错误文案改为：

```text
Invalid Margin snapshot
Margin database not found. Start the app once or set MARGIN_DB_PATH.
Missing --file=... for Margin import.
```

错误文案可以补充 `ECHO_DB_PATH remains supported for compatibility`，但不得要求用户立即迁移。

- [ ] **Step 4: 运行测试并提交**

Run:

```powershell
node --test test/api.test.js test/marginBrand.test.js
```

Expected: PASS。

```powershell
git add src/services/backupService.js scripts/backup-data.js scripts/import-data.js test/api.test.js test/marginBrand.test.js
git commit -m "feat: emit Margin backup artifacts"
```

---

### Task 6: 整理当前文档并标记历史材料

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/API_CONTRACTS.md`
- Modify: `docs/BACKEND_STATUS.md`
- Modify: `docs/BACKUP_AND_EXPORT.md`
- Modify: `docs/BACKEND_FRONTEND_SPLIT_GUIDE.md`
- Modify: `docs/PRODUCT_POSITIONING_V2.md`
- Modify: `docs/CURRENT_UI_DESIGN_SPEC.md`
- Modify: `docs/DESIGN_IMAGERY.md`
- Modify: `docs/DESIGN_SPEC_COMPONENT_MAPPING.md`
- Modify: `test/marginBrand.test.js`

**Interfaces:**
- 当前操作文档使用 Margin。
- 历史设计文档保留原始 Echo 表述，但顶部有历史状态块。
- Case Study 演进章节不修改。

- [ ] **Step 1: 写文档边界失败测试**

在 `test/marginBrand.test.js` 增加：

```js
test('current operational docs use Margin and compatibility examples', async () => {
  const readme = await readFile('README.md', 'utf8');
  const backupDoc = await readFile('docs/BACKUP_AND_EXPORT.md', 'utf8');

  assert.match(readme, /^# Margin/mu);
  assert.match(readme, /MARGIN_DB_PATH=\.\/data\/margin\.sqlite/u);
  assert.match(readme, /ECHO_DB_PATH.*deprecated.*supported/iu);
  assert.match(backupDoc, /margin-export-/u);
  assert.match(backupDoc, /legacy.*echo-export-/iu);
});

test('historical design documents declare their Echo-era status', async () => {
  for (const file of [
    'docs/CURRENT_UI_DESIGN_SPEC.md',
    'docs/DESIGN_IMAGERY.md',
    'docs/DESIGN_SPEC_COMPONENT_MAPPING.md'
  ]) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /历史材料.*Echo.*旧名称/u, file);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node --test test/marginBrand.test.js
```

Expected: FAIL。

- [ ] **Step 3: 更新当前操作文档**

当前操作文档的示例统一为：

```bash
MARGIN_LOG_LEVEL=info
MARGIN_LLM_PROVIDER=local
MARGIN_DB_PATH=./data/margin.sqlite
```

兼容章节明确：

```text
ECHO_LOG_LEVEL, ECHO_LLM_PROVIDER, and ECHO_DB_PATH remain supported for
one compatibility period. MARGIN_* takes priority when both are present.
```

仓库 URL 在 GitHub 真正更名前保持当前可访问地址，并在旁边注明仓库名仍是 legacy external identifier。

- [ ] **Step 4: 标记历史设计材料**

在三份历史设计文档标题后添加：

```markdown
> **历史材料说明**
>
> 本文形成于产品仍使用 Echo 名称的阶段。当前正式产品名为 Margin；
> 文中的 Echo 表述作为产品演进证据保留，不代表当前品牌规范。
```

不要机械替换正文。

- [ ] **Step 5: 运行测试并提交**

Run:

```powershell
node --test test/marginBrand.test.js
```

Expected: PASS。

```powershell
git add README.md CHANGELOG.md CONTRIBUTING.md docs/API_CONTRACT.md docs/API_CONTRACTS.md docs/BACKEND_STATUS.md docs/BACKUP_AND_EXPORT.md docs/BACKEND_FRONTEND_SPLIT_GUIDE.md docs/PRODUCT_POSITIONING_V2.md docs/CURRENT_UI_DESIGN_SPEC.md docs/DESIGN_IMAGERY.md docs/DESIGN_SPEC_COMPONENT_MAPPING.md test/marginBrand.test.js
git commit -m "docs: establish Margin as the current product name"
```

---

### Task 7: 全仓库兼容审计与最终验证

**Files:**
- Create: `docs/MARGIN_NAMING_COMPATIBILITY.md`
- Modify: `case-study/content/recruiter-summary.json` only after the GitHub repository has actually been renamed
- Modify: `scripts/case-study/lib/content-contract.mjs` only after the GitHub repository has actually been renamed
- Modify: `test/caseStudyContentContract.test.js` only after the GitHub repository has actually been renamed
- Modify: `test/caseStudyWeb.test.js` only after the GitHub repository has actually been renamed

**Interfaces:**
- 兼容清单是未来移除 `ECHO_*` 的唯一入口文档。
- 本任务不假设 GitHub 已更名；旧 URL 可访问时保持不变。

- [ ] **Step 1: 编写兼容清单**

创建 `docs/MARGIN_NAMING_COMPATIBILITY.md`，包含以下表格：

```markdown
| Legacy identifier | Current replacement | Status | Removal condition |
|---|---|---|---|
| `ECHO_LOG_LEVEL` | `MARGIN_LOG_LEVEL` | Deprecated, supported | Separate removal spec |
| `ECHO_LLM_PROVIDER` | `MARGIN_LLM_PROVIDER` | Deprecated, supported | Separate removal spec |
| `ECHO_DB_PATH` | `MARGIN_DB_PATH` | Deprecated, supported | Migration tooling shipped |
| `data/echo.sqlite` | `data/margin.sqlite` | Auto-detected, never moved | Explicit user migration |
| `echo_response` | none | Legacy schema, retained | Versioned DB/API migration |
| `echo_reflection` | none | Legacy schema, retained | Versioned DB/API migration |
| `echo_state` | none | Legacy event value, retained | Event migration and rollback |
| `echo_interaction_style` | none | Legacy profile key, retained | Profile migration and rollback |
| `run-echo-local.cmd` | `run-margin-local.cmd` | Wrapper | Separate removal spec |
| `run-echo-desktop.cmd` | `run-margin-desktop.cmd` | Wrapper | Separate removal spec |
```

- [ ] **Step 2: 执行受控残留扫描**

Run:

```powershell
git grep -n -i -E '\bEcho\b|ECHO_|echo_' -- ':!case-study/dist/**' ':!case-study/pdf/**' ':!docs/superpowers/**'
```

逐项归类。允许的残留只有：

- legacy schema；
- 兼容变量与包装器；
- 历史材料说明和正文；
- Case Study 的演进章节；
- 尚未更名的真实 GitHub URL。

发现当前品牌文案残留时，在本任务中修改，并为 `test/marginBrand.test.js` 增加防回归断言。

- [ ] **Step 3: 运行完整验证**

Run:

```powershell
npm test
node scripts/case-study/check-privacy.mjs
node scripts/case-study/build-web.mjs
node --check src/config/env.js
node --check src/server.js
git diff --check
```

Expected:

- 项目测试全部通过；
- Case Study privacy scan passed；
- Web 构建成功；
- 静态语法检查成功；
- 无空白错误。

- [ ] **Step 4: 验证旧配置启动**

使用临时目录和旧变量启动一次：

```powershell
$env:ECHO_LLM_PROVIDER='local'
$env:ECHO_DB_PATH="$env:TEMP\margin-legacy-compat.sqlite"
node src/server.js
```

Expected:

- 服务成功启动；
- 日志显示 Margin；
- 日志包含 `ECHO_*` 弃用提示；
- 数据写入指定旧变量路径；
- 不输出变量值之外的用户数据或密钥。

测试后停止服务并删除本次明确创建的临时数据库。

- [ ] **Step 5: 验证新配置启动**

```powershell
$env:MARGIN_LLM_PROVIDER='local'
$env:MARGIN_DB_PATH="$env:TEMP\margin-current.sqlite"
node src/server.js
```

Expected:

- 服务成功启动；
- 无 `ECHO_*` 弃用提示；
- `/health` 返回 `name: Margin`；
- 数据写入 `margin-current.sqlite`。

- [ ] **Step 6: 提交最终兼容文档**

```powershell
git add docs/MARGIN_NAMING_COMPATIBILITY.md test/marginBrand.test.js
git commit -m "docs: record Margin naming compatibility"
```

- [ ] **Step 7: 请求代码审查**

使用 `requesting-code-review`，重点检查：

- 新旧配置优先级；
- 默认数据库探测是否可能误用或覆盖数据；
- provider 是否仍有绕过配置层读取环境变量的路径；
- legacy schema 是否被误改；
- 当前品牌残留扫描是否把历史证据误判；
- 主工作区用户未提交修改是否完整保留。

只有 Critical 和 Important 问题清零后才能进入分支收尾。

---

## Integration Notes

实施分支应基于提交 `586c81f` 或其后继提交创建。由于主工作区当前存在用户未提交的 `.env.example`、`package.json` 和设计材料，实施和合并必须遵守：

1. 隔离工作树内不得假设这些未提交修改不存在；
2. `package.json` 和 `.env.example` 合并前先比较主工作区差异；
3. 保留 `design:review` script 和用户新增的 provider/UI 设计材料；
4. 如果主工作区仍有同文件修改，禁止直接覆盖或强制 checkout；
5. 先让用户提交/暂存其修改，或采用逐文件三方合并后再完成集成。

GitHub 仓库更名不属于本计划的自动执行步骤。仓库更名完成后，再单独更新：

```text
README.md
case-study/content/recruiter-summary.json
scripts/case-study/lib/content-contract.mjs
test/caseStudyContentContract.test.js
test/caseStudyWeb.test.js
公开 Case Study 部署
```
