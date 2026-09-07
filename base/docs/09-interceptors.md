# 09 · Interceptors：包装响应流的最后一公里

> 对应官方文档：[Interceptors](https://docs.nestjs.com/interceptors)
> 本章目标：理解拦截器包装的 Observable 模型，掌握响应映射、异常重写、缓存短路三大玩法，完成请求生命周期的最后一块拼图。
> ⚠️ 本章所有行为结论均在 **Nest v12 + ESM** 实测验证（实验代码：`src/common/interceptors/`）。
> 💡 前端类比先行：拦截器 ≈ **axios 的 `interceptors.response.use`**——处理器返回的是 Observable 流，你在流上挂操作符加工响应，就像 axios 拦截器里改写 `response.data`。

---

## 本阶段目标

- 理解 `intercept(context, next)` 的双参数模型与 `handle()` 的含义
- 掌握三个核心玩法：响应映射（map）、异常重写（catchError）、缓存短路（不调 handle）
- 理解拦截器的洋葱模型（前逻辑 / 后逻辑）
- 完成生命周期全图，并理解"05 章计时中间件为什么该用拦截器重写"

---

## 知识点释义

### 1. 拦截器是什么：AOP 的包装器

拦截器 = 实现 `NestInterceptor` 接口的类，灵感来自面向切面编程（AOP）。核心是这个方法的形状：

```typescript
intercept(context: ExecutionContext, next: CallHandler): Observable<any>
```

两个参数，各管一件事：

- **`context`（ExecutionContext）**：08 章见过——知道当前是哪个控制器、哪个方法，能读元数据；
- **`next`（CallHandler）**：`next.handle()` **调用路由处理器**，返回一个 **RxJS Observable**。

关键认知：**`handle()` 之前写的代码在处理器执行前运行；`handle()` 返回的 Observable 上挂的操作符在处理器返回后运行**——这就是一个洋葱：

```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    console.log('Before...');              // ① 处理器执行前
    const now = Date.now();
    return next.handle()                    // ② 调用处理器，拿到响应流
      .pipe(
        tap(() => console.log(`After... ${Date.now() - now}ms`)), // ③ 流发出值时
      );
  }
}
```

实测 ✅（`/api/lab`）：日志顺序 `Before → After... 1ms`。

### 2. RxJS 十分钟速成（本章够用的最小集）

你没系统学过 RxJS 也没关系，本章只需要三个操作符和一个概念：

- **Observable**：一个"将来会发出值"的流。`handle()` 返回的流，在 Nest 订阅它之后，会把处理器的返回值发出来；
- **`map(fn)`**：把流里的每个值**转换**成别的（≈ `Array.map`，≈ axios 响应拦截器里改 data）；
- **`tap(fn)`**：值的"旁观者"，做事但不改动流（≈ `console.log` 探头）；
- **`catchError(fn)`**：流上抛了错误时接管（≈ `try/catch` 的流版本）。

`of(x)` 创建一个立即发出 x 的流——缓存场景用它伪造响应。

### 3. 玩法一：响应映射（统一响应格式，实测 ✅）

```typescript
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, UnifiedResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>) {
    return next.handle().pipe(
      map((data) => ({ code: 0, message: 'ok', data })), // 处理器返回什么，包进 data
    );
  }
}
```

实测：`/api/lab` 的返回值被包成 `{ code: 0, message: 'ok', data: {...} }` ✅。

**这就是生产项目"统一响应格式"的正解**：成功响应走拦截器（`{code:0, data}`），错误响应走异常过滤器（06 章的 `{code, message, traceId, data:null}`），控制器只返回纯业务数据。

> ⚠️ 官方警告实测相关：**响应映射对 `@Res()` 库特定模式无效**（02 章说过用 `@Res()` 会失去拦截器能力，这里闭环了）。

### 4. 玩法二：缓存短路（不调 `handle()`，实测 ✅）

```typescript
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (isCached) {
      return of(['from-cache']); // 直接返回一个流——handle() 没被调用！
    }
    return next.handle();
  }
}
```

实测 ✅：日志只有 `[CacheInterceptor] 命中缓存`，**处理器的 `console.log` 没有出现**——`create()` 压根没执行。**不调用 `handle()`，处理器就不执行**，这是拦截器最强大的能力：完全接管响应。

### 5. 玩法三：异常重写（catchError）

```typescript
return next.handle().pipe(
  catchError((err) => throwError(() => new BadGatewayException())),
);
```

**实测发现的边界**（顺序实验）：管道抛 400 时，拦截器的 `Before` 打印了，`After` **没有**——流异常终止，`tap` 不执行，但 `catchError` 可以接住。注意拦截器的 `catchError` 和异常过滤器的分工：拦截器在**流上**改换异常（还能拿到 ExecutionContext），过滤器在**终点**格式化响应。想"换个异常类型"用拦截器，想"统一错误格式"用过滤器。

### 6. 绑定级别（老模式第四次出现）

```typescript
@UseInterceptors(LoggingInterceptor)   // 方法级 / 控制器级，传类支持 DI
app.useGlobalInterceptors(new X())     // 全局，无 DI
{ provide: APP_INTERCEPTOR, useClass: X }  // 全局，支持 DI
```

和 `APP_FILTER` / `APP_PIPE` / `APP_GUARD` 完全同构——四件套齐了。

### 7. 生命周期全图（全部实测 ✅）

```text
请求 → 中间件 → Guard → Interceptor(前) → Pipe → Controller
                                                     │
响应 ← Exception Filter（任何环节抛异常） ← Interceptor(后，map/tap/catchError)
```

实测证据链：中间件最先（05）、无 token 403 先于 400（08）、拦截器 Before 先于管道 400（本章）、管道异常跳过拦截器 After 直达过滤器（本章）。

### 8. 兑现伏笔：计时逻辑的正确位置

05 章我们用拦截 `writeHead` 的黑魔法实现了 `X-Response-Time`。拦截器版本：

```typescript
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const start = Date.now();
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      tap(() => res.setHeader('X-Response-Time', `${Date.now() - start}ms`)),
    );
  }
}
```

**为什么这里能设头而 finish 事件里不能**：`tap` 在"处理器返回后、响应序列化发出前"执行——头还没发，时机天然正确。机制选对了位置，就没有黑魔法。（注意：这个计时只覆盖"管道+处理器"阶段，不含守卫/中间件耗时；要全链路计时仍需中间件。两个方案各有适用面。）

---

## 代码实现

本章实验代码（已建好，已验证 ✅）：

- `common/interceptors/logging.interceptor.ts`——Before/After 计时
- `common/interceptors/transform.interceptor.ts`——统一成功响应格式 `{code:0, message:'ok', data}`
- `common/interceptors/cache.interceptor.ts`——缓存短路原型
- `lab.controller.ts`——类级 `@UseInterceptors(LoggingInterceptor, TransformInterceptor)`，方法级 `@UseInterceptors(CacheInterceptor)` 在 `/api/lab/cached`

自测：

```bash
pnpm start:dev
curl -H 'Authorization: Bearer user' http://localhost:3000/api/lab         # 统一格式包装
curl -H 'Authorization: Bearer user' http://localhost:3000/api/lab/cached  # 缓存短路（看控制台无 handler 日志）
curl -H 'Authorization: Bearer user' http://localhost:3000/api/cats/abc    # 400，且拦截器 After 不执行
```

---

## 动手练习

1. **Timing 落地**：实现第 8 节的 `TimingInterceptor`，绑到 `CatsController`，curl 验证 `X-Response-Time` 头；和 05 章的中间件版本共存对比（一个管全链路，一个管处理器段），观察两个值的大小关系并解释。
2. **统一格式全局化**：把 `TransformInterceptor` 用 `APP_INTERCEPTOR` 注册为全局。然后发现问题：`/api/lab/boom` 的错误响应会不会也被包装成 `{code:0}`？实测并解释为什么不会。
3. **超时拦截器**：实现官方文档的 `TimeoutInterceptor`（`timeout(5000)` + `catchError` 转 `RequestTimeoutException`），在 lab 加一个 `setTimeout` 6 秒的慢路由验证。
4. **概念题**：练习 2 里如果全局 Transform 真的把错误也包装了，问题出在哪一层的设计上？（提示：成功流和异常流在 RxJS 里是两条通道）
5. **概念题**：`TransformInterceptor` 对返回 `StreamableFile`（文件下载）的路由会有什么影响？设计上怎么规避？

---

## 练习参考答案

**练习 2/4**：不会被包装。`map` 只作用于流的**正常值通道**；异常走的是流的**错误通道**，直接绕过 `map` 交给异常层。这正是 RxJS 双通道设计的价值：成功路径和失败路径天然分离，拦截器加工成功响应、过滤器加工失败响应，互不干扰。如果哪天错误也被 `{code:0}` 包了，说明有人在 `catchError` 里把错误转成了正常返回值——那就吞掉了异常语义，过滤器也接不到了。

**练习 5**：`map` 会把 `StreamableFile` 对象包进 `{code:0, data}` 里——文件下载被破坏（Nest 识别 `StreamableFile` 靠的就是返回值本身）。规避方式：拦截器里判断返回值类型，`instanceof StreamableFile` 时原样放行；或者用元数据标记（`@NoTransform()` 之类的自定义装饰器 + `Reflector` 读取，08 章的模式）。这也是"全局机制要留逃生门"的通用设计原则——和 `@Public()` 之于全局守卫是同一个思想。

（练习 1 验证标准：响应头有 `X-Response-Time`，且拦截器版的值 ≤ 中间件版的值；练习 3 验证标准：慢路由 5 秒后返回 408 `Request Timeout`。）

---

## 自检清单

- [ ] 能解释 `handle()` 的双重角色：调用处理器 + 返回响应流
- [ ] 掌握 map / tap / catchError 三个操作符的职责
- [ ] 能解释缓存拦截器"不调 handle 处理器就不执行"（实测）
- [ ] 知道响应映射对 `@Res()` 模式无效
- [ ] 能画出完整的请求生命周期图（中间件→守卫→拦截器→管道→控制器→过滤器兜底）
- [ ] 能解释成功流走拦截器、异常流走过滤器的双通道设计
- [ ] 三条自测 curl 全部符合预期

---

## 下阶段预告

**10 · Custom Decorators**：装饰器元编程收官。自定义参数装饰器（把 `req.user` 变成 `@User()` 直接注入参数）、`createParamDecorator`、装饰器组合（把 `@Auth() + @Roles()` 合成一个）。学完后 Overview 章节全部拿下，可以进博客项目了。
