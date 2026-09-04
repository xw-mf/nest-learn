# 05 · Middleware：请求生命周期的第一站

> 对应官方文档：[Middleware](https://docs.nestjs.com/middleware)
> 本章目标：掌握中间件的两种形态（类/函数）、注册方式（`configure()` / `app.use()`）、路径匹配规则，以及它在请求生命周期中的位置。
> ⚠️ 本章所有行为结论均在 **Nest v12 + ESM** 环境下实测验证（实验代码：`src/common/middleware/` + `AppModule.configure()`）。

---

## 本阶段目标

- 理解中间件的本质：Nest 中间件**就是 Express 中间件**（默认适配器下）
- 掌握类中间件（可 DI）与函数式中间件（无依赖时用）的选择标准
- 掌握 `MiddlewareConsumer` 的 `apply`/`forRoutes`/`exclude` 链式 API
- 理解全局中间件（`app.use()`）与模块中间件的关键差异：**能不能用 DI**
- 建立请求生命周期的第一块拼图

---

## 知识点释义

### 1. 中间件是什么

中间件是在**路由处理器之前**被调用的函数，能拿到 `req`、`res`、`next` 三件套。它能：

- 执行任意代码（日志、计时）
- **修改 req/res 对象**（实测 ✅：中间件写入的 `requestTime` 能传到控制器）
- 直接结束请求（不调用 `next()`）
- 抛异常中断请求（实测 ✅：`throw new UnauthorizedException()` → 401 JSON）

**铁律：不结束请求就必须调 `next()`，否则请求永远挂起**（实测 ✅：curl 等到超时，退出码 28）。

在 Express 适配器下，Nest 中间件和 Express 中间件是同一个东西——没有 Nest 的魔法，就是 `(req, res, next) => void`。这意味着所有 Express 生态的中间件（`cors`、`helmet`、`morgan`）可以直接用。

### 2. 两种形态的选择标准

**类中间件**——需要依赖注入时：

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(private readonly labService: LabService) {} // ✅ 实测：DI 正常工作

  use(req: Request, res: Response, next: NextFunction) {
    console.log(`${req.method} ${req.path}`);
    next();
  }
}
```

**函数式中间件**——无依赖时的简化：

```typescript
export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Trace', 'functional-mw');
  next();
}
```

选择标准（官方建议）：**没有依赖就用函数式**。实测确认类中间件的 DI 不需要把它加进 `providers` 数组——`apply()` 时容器自动实例化。

### 3. 注册：`configure()` 与 `MiddlewareConsumer`

`@Module()` 元数据里**没有中间件的位置**，中间件通过模块类的 `configure()` 方法注册（模块需实现 `NestModule` 接口）：

```typescript
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware, traceMiddleware) // 可多个，实测：按顺序执行 ✅
      .exclude({ path: 'lab', method: RequestMethod.POST }) // 排除特定路由
      .forRoutes('lab'); // 作用范围
  }
}
```

`forRoutes()` 接受的参数：路径字符串、`{ path, method }` 对象（`RouteInfo`）、**控制器类**（最常用——直接锚定某控制器的所有路由）、或以上任意组合的列表。

**实测：路径匹配不受全局前缀影响** ✅——`setGlobalPrefix('api')` 后，`forRoutes('lab')` 依然匹配 `/api/lab`（匹配用的是路由定义的路径，不含前缀）。

通配符（v12/Express 5 语法，命名通配符）：

```typescript
.forRoutes({ path: 'abcd/{*splat}', method: RequestMethod.ALL })
// 'abcd/*splat' 匹配 abcd/1、abcd/123…；加花括号 {*splat} 后 'abcd/' 本身也匹配
```

### 4. 全局中间件：`app.use()`

```typescript
// main.ts
const app = await NestFactory.create(AppModule);
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Global-MW', 'app.use');
  next();
});
```

实测 ✅：对所有路由生效。但与模块中间件有两个关键差异：

1. **没有 DI**：`app.use()` 在 Nest 装配体系之外（直接交给底层 Express），只能传函数式中间件或手动 new 的实例。需要 DI 又想要全局效果？用类中间件 + `.forRoutes('*')`。
2. **类型提示差**（实测踩坑）：`INestApplication.use()` 的签名是 `(...args: any[])`，回调参数是隐式 `any`，strict 模式直接编译失败——要手动标注 express 的 `Request/Response/NextFunction` 类型。

### 5. 中间件的异常处理（重要边界）

实测 ✅：中间件里 `throw new UnauthorizedException()` → 客户端收到标准 401 JSON。但有一个关键边界（官方警告）：

**中间件在路由选定之前执行，所以只有全局异常过滤器能捕获它的异常。** 控制器级/方法级的 `@UseFilters()` 对中间件无效（06 章学完过滤器后回头看这句话会更清晰）。

### 6. 生命周期位置（第一块拼图）

```text
请求 → [中间件] → 路由匹配 → Guard → Interceptor(前) → Pipe → Controller
       ↑ 你在这里                                                 → Interceptor(后) → 响应
```

中间件是 Nest 请求处理链的**最外层**，它执行时 Nest 还不知道这个请求会落到哪个控制器——这解释了为什么它拿不到路由元数据、为什么只有全局过滤器能兜它的异常。后面 06-09 章会逐个把 Guard/Pipe/Interceptor/Filter 挂到这张图上。

**选择中间件 vs 后面章节的机制**：需要路由上下文（哪个控制器、哪个方法、DTO 元数据）就别用中间件——那是 Guard/Interceptor/Pipe 的领域。中间件适合**与业务路由无关**的横切逻辑：日志、CORS、请求 ID。

---

## 代码实现

本章实验代码（已建好，已验证 ✅）：

- `src/common/middleware/logger.middleware.ts`——类中间件，注入 `LabService` 验证 DI，写 `requestTime` 到 req
- `src/common/middleware/trace.middleware.ts`——函数式中间件，写 `X-Trace` 响应头
- `app.module.ts` 的 `configure()`——两个中间件按顺序 apply 到 `'lab'`；`authProbeMiddleware`（抛 401）apply 到 `'consumer/env'`
- `lab.controller.ts` 的 probe 里读取 `requestTime`，验证 req 修改传递到控制器

自测：

```bash
pnpm start:dev
curl -D - http://localhost:3000/api/lab            # 有 X-Trace 头，响应里有 middlewareRequestTime
curl -D - http://localhost:3000/api/cats           # 无 X-Trace 头（路径范围外）
curl http://localhost:3000/api/consumer/env        # 401（authProbe 中间件拦截）
curl -H 'Authorization: Bearer x' http://localhost:3000/api/consumer/env  # 放行
```

---

## 动手练习

1. **计时中间件**：写一个函数式中间件，记录请求处理耗时并通过 `X-Response-Time` 响应头返回。⚠️ 注意一个 HTTP 协议层的限制：响应一旦开始发送（`res.json()`），头就锁死了——所以"算耗时"和"设响应头"需要挂在两个不同的时机（想不清楚就看参考答案，这题有坑）。apply 到 `CatsController`。
2. **exclude 实践**：让 `LoggerMiddleware` 作用于 `'lab'`，但 `exclude` 掉其中的 GET 方法，curl 验证 GET 不打日志而（如果有的话）其他方法打。
3. **概念题**：中间件里能拿到"这个请求会由哪个控制器方法处理"这个信息吗？为什么？（提示：想生命周期图）
4. **概念题**：想在所有请求上校验 JWT，用中间件是不是好选择？对比 04 章结尾预告里的 Guard，先给出你的判断和理由，07 章学完后回头验证。
5. **挂起实验复现**：自己写一个不调 `next()` 的中间件 apply 到某路径，用 `curl -m 2` 验证挂起，然后移除它。

---

## 练习参考答案

**练习 1**：这题的坑在于 HTTP 响应的结构——**状态行 → 响应头 → 响应体**，按序流出，头一旦发出就锁死。`res` 的 `'finish'` 事件在"响应完整发出之后"触发，在那里 `setHeader` 会报 `ERR_HTTP_HEADERS_SENT`。正确做法分两个时机：

```typescript
export function costTimeMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  // 设头：拦截 writeHead（Node 底层真正"写响应头"的方法），抢在头发出前注入
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
    res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
    return originalWriteHead(...args);
  }) as typeof res.writeHead;

  // 算耗时/打日志：finish 事件（响应发完后）—— 这里只能做日志、指标上报
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} cost: ${Date.now() - start}ms`);
  });

  next();
}
```

（实测 ✅：`X-Response-Time: 2ms` 头正常返回。这也是 Express 生态 `response-time` 库的内部原理。另外一个预告：09 章学了 Interceptor 之后你会发现，在拦截器里做计时+设头是更符合 Nest 风格的写法——拦截器在处理器返回后、响应序列化前执行，天然有正确的时机。）

**练习 3**：**拿不到**。中间件执行时路由匹配还没发生（见生命周期图），`req` 上只有原始 HTTP 信息（方法、URL、头、体）。这是中间件和 Guard/Interceptor 的本质分界——后者能拿到 `ExecutionContext`（包含控制器类、方法、反射元数据），因为它们在路由匹配之后执行。所以"只对某个控制器的请求做处理"用 `forRoutes(CatsController)` 声明，而不是在中间件内部判断 URL——前者是声明式绑定，后者是脆弱的字符串匹配。

**练习 4**：**不是好选择**。三个原因：① JWT 校验通常需要注入 UserService 查库，全局中间件没有 DI，类中间件有 DI 但拿不到路由上下文；② 有些路由要放行（登录、注册），中间件只能靠 `exclude` 配路径，而 Guard 可以用装饰器（如 `@Public()`）在路由上声明，语义更清晰；③ 校验失败抛出的异常只能被全局过滤器捕获（中间件位置决定），定制错误响应的灵活性受限。正确答案是 Guard（07 章）——它就是为"请求该不该进来"设计的，能拿到完整执行上下文。

（练习 1 验证标准：响应头出现 `X-Response-Time: x ms`；练习 2 验证标准：GET /api/lab 无日志、日志中间件仍出现在其他未排除方法的控制台输出中；练习 5 验证标准：curl 退出码 28。）

---

## 自检清单

- [ ] 能解释 Nest 中间件 = Express 中间件（默认适配器），没有额外抽象
- [ ] 能说出类中间件 vs 函数式中间件的选择标准（有无依赖）
- [ ] 掌握 `apply` / `exclude` / `forRoutes` 链式 API，知道 `forRoutes` 可传控制器类
- [ ] 知道路径匹配不含全局前缀（实测）
- [ ] 能解释 `app.use()` 的两个局限（无 DI、类型签名差）
- [ ] 知道不调 `next()` 的后果（实测：挂起）
- [ ] 能画出生命周期图并指出中间件的位置，解释为什么它拿不到路由上下文
- [ ] 自测四条 curl 全部符合预期

---

## 下阶段预告

**06 · Exception Filters**：Nest 的异常层全貌——内置 `HttpException` 体系、异常过滤器如何接管错误响应、全局/控制器/方法三级作用域，以及为什么生产项目都应该有一个统一错误格式的全局过滤器。
