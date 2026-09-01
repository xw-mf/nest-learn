# 01 · First Steps：项目结构与启动原理

> 对应官方文档：[First steps](https://docs.nestjs.com/first-steps)
> 本章目标：不搞懂所有细节，但要能说清楚——**一个 Nest 应用是怎么从 `main.ts` 跑起来、并把一个请求响应回去的**。

---

## 本阶段目标

- 理解脚手架每个核心文件的职责
- 理解启动流程：`NestFactory.create()` 到底做了什么
- 理解 Nest 的"平台无关"设计（Express / Fastify）
- 跑通开发流程：启动、热重载、lint、格式化

---

## 知识点释义

### 1. 入口文件 `main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
```

逐行拆解：

- **`NestFactory`**：应用工厂。它的职责是读取你传入的根模块（`AppModule`），**扫描整个模块树，实例化所有 Controller 和 Provider，建立依赖注入（DI）容器，注册所有路由**。可以把它理解成"装配车间"——你写的都是零件，它负责组装成一台能跑的机器。
- **`create()` 返回 `INestApplication`**：一个应用实例对象，之后所有全局配置（全局前缀、全局管道、全局过滤器…）都挂在它上面。
- **`setGlobalPrefix('api')`**：所有路由统一加 `/api` 前缀，即 `@Get()` 实际监听的是 `/api`。
- **`listen()`**：启动底层 HTTP 服务器开始监听端口。
- **`instrument: ObserveInstrument`**：这是脚手架预装的 `@nestjs/observe`（官方可观测性服务）的探针，**不是 Nest 核心概念，学习阶段可以无视它**。
- **`abortOnError`**（补充）：`create()` 默认在启动出错时直接以退出码 1 终止进程；传 `{ abortOnError: false }` 可改为抛出异常让你自己处理。

### 2. 平台无关（Platform agnostic）

**为什么需要它**：Nest 的核心只定义"应用应该长什么样"（模块、路由、DI），不绑定具体 HTTP 库。底层 HTTP 引擎是可替换的"平台包"：

| 平台包 | 底层 | 特点 |
|---|---|---|
| `@nestjs/platform-express` | Express | **默认**，生态最成熟 |
| `@nestjs/platform-fastify` | Fastify | 性能更高、开销更低 |

你写的 Controller/Service 代码两个平台下完全一样。只有当你要用平台专属 API（比如 Express 的 `res.sendFile()`）时，才需要显式声明类型：

```typescript
import { NestExpressApplication } from '@nestjs/platform-express';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
```

> 学习阶段用默认的 Express 即可，Fastify 只在有明确性能需求时考虑。

### 3. 核心三件套（先建立整体印象）

脚手架的 `src/` 下有三个文件，它们就是 Nest 应用的最小骨架：

```text
请求 → main.ts → AppModule（模块：组织单位）
                    ├── AppController（控制器：接请求、定路由）
                    └── AppService（提供者：干活的业务逻辑）
```

- **`app.module.ts`** —— 根模块。`@Module()` 装饰器通过三个数组描述这个模块：`imports`（依赖哪些其他模块）、`controllers`（有哪些控制器）、`providers`（有哪些可注入的服务）。
- **`app.controller.ts`** —— `@Controller()` 标记这是控制器，`@Get()` 把方法绑定到 `GET /` 路由。注意构造函数里 `private readonly appService: AppService` —— **这就是依赖注入**：你没有 `new AppService()`，只是声明了"我需要一个 AppService"，Nest 的 DI 容器在实例化控制器时自动帮你注入。
- **`app.service.ts`** —— `@Injectable()` 标记这个类可以被注入到别的地方。

现在只需要记住一句话：**Controller 负责接，Service 负责干，Module 负责把它们组织起来**。后面 02、03、04 三章会分别深挖。

### 4. ESM 的注意点（本项目特有）

`base` 是 **ESM 项目**（`package.json` 里 `"type": "module"`），和官方文档默认的 CommonJS 示例有一个关键差异：

```typescript
// ❌ CommonJS 写法（官方文档示例）
import { AppModule } from './app.module';

// ✅ ESM 写法（本项目必须这样）—— 即使源文件是 .ts，import 也要写 .js 后缀
import { AppModule } from './app.module.js';
```

这是 Node.js ESM 规范的要求（import 的是编译后的产物路径）。**本项目所有相对路径 import 都必须带 `.js` 后缀**，少写了运行时才报错，很坑，务必养成习惯。

### 5. Nest CLI

`nest-cli.json` 是 CLI 的配置文件，当前内容很精简：

```json
{
  "collection": "@nestjs/schematics",   // 代码生成器模板集
  "sourceRoot": "src",                   // 源码根目录
  "compilerOptions": { "deleteOutDir": true }  // 构建前清空 dist
}
```

后面会常用 CLI 生成代码骨架（如 `nest g resource cats` 一键生成模块+控制器+服务），到时候再展开。

---

## 运行与验证

在 `base/` 目录下：

```bash
# 开发模式（推荐）：监听文件变化，自动重编译重启
pnpm start:dev

# 普通启动
pnpm start

# 代码检查 / 格式化
pnpm lint
pnpm format
```

启动后验证（注意全局前缀）：

```bash
curl http://localhost:3000/api
# 期望输出：Hello World!
```

**加速构建**（可选）：Nest 支持用 SWC（Rust 写的编译器）替代 tsc，构建快约 20 倍：

```bash
pnpm start -- -b swc
```

---

## 动手练习

1. **改端口**：不修改 `main.ts` 代码，通过环境变量让应用跑在 `4000` 端口。提示：看 `listen()` 那一行已经写了什么。
2. **加一条路由**：在 `AppController` 里新增一个方法，让 `GET /api/info` 返回 `{ name: 'base', version: '1.0.0' }`。要求：返回值由 `AppService` 的新方法提供，Controller 不直接写死数据。
3. **破坏实验**：把 `app.service.ts` 里的 `@Injectable()` 删掉，重启应用观察报什么错；再恢复。想一想：这个报错信息说明 DI 容器在启动时做了什么？
4. **思考题**（不用写代码）：`setGlobalPrefix('api')` 和直接在 `@Controller('api')` 里写前缀，两种方式有什么区别？什么场景下用前者更合适？

---

## 练习参考答案

> 练习 2 是纯动手题，做对的标准就是 curl 能跑通；其余参考答案如下，**先自己做完再看**。

**练习 1（改端口的几种方法）**

本质是"怎么把 `PORT` 送进 Node 进程的环境变量"：

1. `PORT=4000 pnpm start:dev` —— 命令行临时注入，只对本次命令生效（预期答案，最常用）
2. `export PORT=4000` 再启动 —— 对当前终端会话持续生效
3. 写进 `package.json` scripts：`"start:4k": "PORT=4000 nest start"` —— 固化成可复用的命名脚本
4. `.env` 文件 + `node --env-file=.env dist/main`（Node ≥ 20.6）—— 注意 `nest start` 不会自动读 `.env`
5. `.env` 文件 + `@nestjs/config` —— 工程化标准做法，后续"配置管理"章节专门学

**练习 3（删掉 `@Injectable()` 会怎样）—— 实测修正版**

> ⚠️ 本节答案经过实际实验验证，初版答案有误，以下为真实行为。

**现象：不报错，应用正常启动，`/api` 正常返回。** 为什么？拆开看 `@Injectable()` 到底做了什么：

1. **Provider 的注册不依赖装饰器**。`AppService` 是被显式写进 `providers: [AppService]` 数组的，容器拿这个类去 `new` 就够了，注册环节根本不需要 `@Injectable()`。
2. **`@Injectable()` 的真正作用是让 TypeScript 发射元数据**。TS 只在类上**至少有一个装饰器**时，才通过 `reflect-metadata` 发射 `design:paramtypes`（构造函数参数类型列表）。DI 容器靠这份元数据推断"实例化这个类时需要先注入什么"。
3. `AppService` **没有任何构造函数依赖**，所以有没有这份元数据无所谓——容器直接 `new AppService()`，一切正常。

**进阶实验（更能暴露本质的两步）**：

- 给 `AppService` 加构造函数依赖再删掉装饰器：`constructor(private readonly prefix: string) {}` + 无 `@Injectable()` → **依然不报错，但 `prefix` 静默变成 `undefined`**（返回 `undefined Hello World!`）。因为元数据没发射，容器以为这是零依赖类，直接 `new` 了。这是最危险的情况：**静默错误，不 fail fast**。
- 保留 `@Injectable()`、依赖不注册到模块：同样的构造函数 → 启动时立刻抛 `UnknownDependenciesException: Nest can't resolve dependencies of the AppService (?). Please make sure that the argument String at index [0] is available in the AppModule module.`

**结论**：`@Injectable()` 的语义不是"注册"，而是**"声明本类的依赖需要容器解析"**。Nest 的 fail fast 发生在"有元数据但依赖未注册"时；而"缺装饰器导致元数据丢失"反而静默。所以官方风格要求**所有 Provider 无条件加 `@Injectable()`**，即使它没有任何依赖——这是防御性标注，防止你以后给类加依赖时踩进静默 undefined 的坑。

**练习 4（全局前缀 vs 控制器前缀）**

- `app.setGlobalPrefix('api')`：**应用级**配置，一次性作用于所有已注册路由（还可以通过 `exclude` 排除特定路由）。适合"部署形态"层面的需求——比如网关约定所有后端服务统一以 `/api` 开头、或多版本共存（`/v1`、`/v2`）。
- `@Controller('api')`：**资源级**配置，只影响这一个控制器，语义是"这个控制器负责的资源路径"。

实践原则：全局前缀管"部署/网关约定"，控制器前缀管"业务资源命名"。两者经常同时存在：`setGlobalPrefix('api')` + `@Controller('cats')` → `GET /api/cats`。

---

## 自检清单

- [ ] 能不看文档说出 `main.ts` 每一行的作用
- [ ] 能解释 `NestFactory.create()` 启动时做了哪三件事（扫描模块 / 建 DI 容器 / 注册路由）
- [ ] 知道本项目为什么 import 必须写 `.js` 后缀
- [ ] 知道 platform-express 和 platform-fastify 的关系，以及为什么业务代码不用关心选哪个
- [ ] 练习 2 完成，`curl http://localhost:3000/api/info` 返回正确 JSON

---

## 下阶段预告

**02 · Controllers**：路由参数（`@Param` `@Query` `@Body`）、请求方法与状态码、通配符路由、DTO 的第一课——把"接请求"这件事的完整工具箱摸一遍，并正式开始搭贯穿基础阶段的 `cats` 练手模块。
