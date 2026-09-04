# 06 · Exception Filters：异常层与统一错误格式

> 对应官方文档：[Exception filters](https://docs.nestjs.com/exception-filters)
> 本章目标：理解 Nest 内置异常层的默认行为，掌握 `HttpException` 体系、异常过滤器的编写与三级作用域绑定，产出生产级的统一错误格式。
> ⚠️ 本章所有行为结论均在 **Nest v12.0.1 + ESM** 实测验证，含一处**官方文档与实际行为不符**的勘误。
> 实验代码：`src/common/filters/` + `lab.controller.ts` 的 boom/native/teapot/badreq/raw 探针。

---

## 本阶段目标

- 理解内置异常层：什么都不做时，异常如何变成响应
- 掌握 `HttpException` 构造参数与内置子类体系
- 会写自定义异常过滤器（`@Catch` + `ArgumentsHost`）
- 掌握过滤器的三级作用域及其优先级、DI 差异
- 理解中间件异常的捕获边界（呼应 05 章）

---

## 知识点释义

### 1. 内置异常层：默认行为（实测验证 ✅）

Nest 内置一个全局异常层兜底所有未捕获异常。实测三种形态：

```text
throw new HttpException({ status: 403, error: '自定义错误体' }, 403)
→ {"status":403,"error":"自定义错误体"}        ← 对象体原样透传

throw new HttpException('Forbidden', 403)
→ {"statusCode":403,"message":"Forbidden"}    ← 字符串体只覆盖 message

throw new Error('plain error')                ← 非 HttpException
→ {"statusCode":500,"message":"Internal server error"}  ← 真实错误信息被隐藏
```

最后一条是**安全设计**：未识别异常的真实 message 不暴露给客户端（防止泄露内部细节）。后面自定义 catch-all 过滤器时要记住保持这个纪律。

### 2. `HttpException` 构造参数（含 v12 勘误）

```typescript
throw new HttpException(response, status, options?)
```

- `response`：string（覆盖 message）或 object（**整个响应体**）
- `status`：建议用 `HttpStatus` 枚举
- `options.cause`：错误根因。**实测 ✅：不会序列化进响应**，只供日志/链路追踪
- `options.description`：覆盖默认的 `error` 字段描述

> ⚠️ **官方文档勘误（源码级验证）**：文档声称 `options.errorCode`（机器可读错误码）会序列化进响应体。**实测在 v12.0.1 三种写法（`HttpException` / `BadRequestException` / `ImATeapotException`）下均未出现在响应中**。源码证据：`BadRequestException` 构造函数调用 `HttpException.createBody(objectOrError, description, status)`——**没传第四个 `errorCode` 参数**；`errorCode` 只存到实例属性上。**若要给客户端稳定错误码，在自定义过滤器里读 `exception.errorCode` 自己放进响应体。**（这也恰好说明了为什么生产项目需要自定义过滤器。）

### 3. 内置子类与自定义异常

22 个内置子类（`BadRequestException`、`UnauthorizedException`、`NotFoundException`、`ForbiddenException`、`ConflictException`、`UnprocessableEntityException`、`InternalServerErrorException`……）都在 `@nestjs/common`，语义对应状态码，按需选用即可。

自定义异常继承 `HttpException` 形成层级：

```typescript
export class BusinessException extends HttpException {
  constructor(message: string, errorCode: string) {
    super(message, HttpStatus.BAD_REQUEST);
    this.errorCode = errorCode; // 业务错误码，过滤器里读取
  }
}
```

### 4. 异常过滤器：接管异常响应

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch(HttpException) // 元数据：只捕 HttpException 及其子类
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();       // 切换到 HTTP 上下文
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    res.status(exception.getStatus()).json({
      code: exception.getStatus(),
      message: exception.message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

- `ArgumentsHost` 是平台无关的抽象（HTTP / WebSocket / RPC 通用），`switchToHttp()` 拿到 req/res。
- `@Catch()` **无参数 = 捕获一切**（包括普通 `Error`）。
- Fastify 适配器下用 `response.send()` 替代 `response.json()`；想完全平台无关就注入 `HttpAdapterHost` 用 `httpAdapter.reply()`（见项目里 `catch-all.filter.ts`）。

> ⚠️ **实测坑**：`exception.message` 和 `exception.getResponse()` 不是一回事。对"对象体"的 HttpException，`message` 是由类名生成的通用文案（"Http Exception"），自定义内容在 `getResponse()` 里。过滤器里展示 message 前先想清楚你要哪个。

### 5. 三级作用域与绑定方式（全部实测 ✅）

| 作用域 | 写法 | DI | 实测结论 |
|---|---|---|---|
| 方法级 | `@UseFilters(HttpExceptionFilter)` 在路由方法上 | 传类即可 | ✅ 生效 |
| 控制器级 | `@UseFilters(...)` 在类上 | 传类即可 | ✅ 生效 |
| 全局（main.ts） | `app.useGlobalFilters(new X())` | ❌ **不能注入** | 官方明确 |
| 全局（模块内） | `{ provide: APP_FILTER, useClass: X }` | ✅ **支持 DI** | ✅ 实测注入 LabService 成功 |

**优先级实测** ✅：方法级（具体类型过滤器）与全局（catch-all）同时存在时，**方法级生效**——离异常源更近、类型更具体的赢。

**中间件边界实测** ✅（05 章伏笔兑现）：

- `ConsumerController` 上挂了控制器级过滤器，但中间件（`authProbeMiddleware`）抛的 401 **依然走默认格式**——控制器级过滤器没接管；
- 换成 `APP_FILTER` 全局过滤器后，同一个中间件 401 被接管为自定义格式。

原因回到生命周期图：**过滤器挂在"异常冒泡"的终点，但中间件在路由选定之前执行，方法/控制器级过滤器还没来得及和路由建立关联**。

### 6. 组合使用多个全局过滤器

`@Catch()` 捕获一切的过滤器与具体类型过滤器共存时，官方建议**先声明 catch-all**（`APP_FILTER` 注册顺序即执行顺序）。

### 7. 生命周期图更新

```text
请求 → 中间件 → 路由匹配 → Guard → Interceptor(前) → Pipe → Controller
        │                                                   │
        └────────── 任何环节抛异常 ──────────→ Exception Filter → 响应
                     ↑ 但只有全局过滤器能接到中间件抛的
```

---

## 代码实现

本章实验代码（已建好，已验证 ✅）：

- `src/common/filters/http-exception.filter.ts`——`@Catch(HttpException)`，自定义格式（方法级绑在 `/api/lab/boom`，控制器级绑在 `ConsumerController`）
- `src/common/filters/catch-all.filter.ts`——`@Catch()` 捕获一切，`HttpAdapterHost` 平台无关写法，注入 `LabService` 验证 APP_FILTER 的 DI
- `AppModule` 里 `{ provide: APP_FILTER, useClass: CatchAllFilter }` 全局注册
- `lab.controller.ts` 五个异常探针：`boom`（对象体+cause）、`native`（普通 Error）、`teapot`/`badreq`/`raw`（errorCode 勘误证据）

自测：

```bash
pnpm start:dev
curl http://localhost:3000/api/lab/boom      # HttpExceptionFilter 格式（方法级赢）
curl http://localhost:3000/api/lab/native    # CatchAllFilter 格式，500
curl http://localhost:3000/api/consumer/env  # CatchAllFilter 格式，401（全局接住中间件异常）
```

---

## 动手练习

1. **业务错误码体系**：给 cats 模块定义 `CatNotFoundException extends NotFoundException`，`findOne` 找不到时抛出；在 `CatchAllFilter` 里读取 `exception.errorCode` 放进响应体（解决官方 errorCode 不序列化的问题）。
2. **日志纪律**：给 `CatchAllFilter` 加日志——5xx 用 `logger.error`（带堆栈），4xx 用 `logger.warn`（不带堆栈）。解释为什么这样分级。
3. **格式统一**：把 catch-all 的响应格式改成 `{ code, message, data: null, traceId }`（traceId 可先用随机串）。这就是博客项目阶段的统一错误格式雏形。
4. **概念题**：`app.useGlobalFilters(new X())` 和 `APP_FILTER` 注册都能做全局过滤器，为什么后者是推荐方式？
5. **概念题**：`CatchAllFilter` 里我们向客户端返回了 `exception.message`（实测 D2 暴露了 'plain error'）。这在生产环境有什么问题？正确的折中是什么？

---

## 练习参考答案

**练习 2**：4xx 是**客户端的错**（参数错、没权限），属于正常业务流量，记 warn 足矣，堆栈没有诊断价值还刷屏；5xx 是**服务器的 bug**，必须记 error + 完整堆栈才能定位。这个分级也是告警系统的基础——error 级触发告警，warn 级只做统计。实践中 5xx 还应该带上 traceId 方便串联日志。

**练习 4**：`useGlobalFilters(new X())` 有两个硬伤：① **手动 new，绕过了 DI 容器**——过滤器想注入 Logger/Config 都做不到（本章实测 APP_FILTER 方式 DI 正常）；② 实例在模块体系之外，生命周期不受 Nest 管理（比如 `onModuleDestroy` 钩子不生效）。`APP_FILTER` 把过滤器变回普通 Provider，容器托管一切。代价只是写法稍微绕一点。

**练习 5**：直接暴露 `exception.message` 会把**内部实现细节泄露给客户端**——数据库报错文本、文件路径、第三方服务信息都可能藏在 message 里，是攻击者的情报来源。正确折中（也是内置默认层的策略）：**5xx 对客户端只返回通用文案（"Internal server error"）+ traceId**，真实 message 和堆栈只进服务端日志；**4xx 可以返回具体 message**，因为它本来就是写给调用方看的业务提示。

（练习 1 验证标准：`curl /api/cats/999` 返回的 JSON 含 `errorCode` 字段；练习 3 验证标准：三个探针响应均为新格式。）

---

## 自检清单

- [ ] 能默写默认异常层对三种异常的响应格式
- [ ] 知道 `cause` 不序列化、`errorCode` 在 v12.0.1 实测不序列化（及如何在过滤器里手动暴露）
- [ ] 能手写 `@Catch()` 过滤器并用 `ArgumentsHost` 取 req/res
- [ ] 知道三级作用域 + APP_FILTER 的 DI 差异，知道方法级 > 全局的优先级（实测）
- [ ] 能解释中间件异常为什么只有全局过滤器能接（实测）
- [ ] 能解释 4xx/5xx 对客户端的信息暴露纪律
- [ ] 三条自测 curl 全部符合预期

---

## 下阶段预告

**07 · Pipes**：请求数据的校验与转换。`ParseIntPipe` 解决 02 章遗留的"`@Param` 永远是 string"问题；`ValidationPipe` + class-validator 让 DTO 真正生效——02 章的 `CreateCatDto` 到现在还是"裸奔"的，本章给它装上校验。
