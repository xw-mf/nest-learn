# 08 · Guards：鉴权与 ExecutionContext

> 对应官方文档：[Guards](https://docs.nestjs.com/guards) + [Execution context](https://docs.nestjs.com/fundamentals/execution-context)
> 本章目标：掌握守卫的职责与写法、`ExecutionContext` 的威力、元数据驱动的角色鉴权（RBAC 雏形）。
> ⚠️ 本章所有行为结论均在 **Nest v12 + ESM** 实测验证（实验代码：`src/common/guards/` + `src/common/decorators/`）。
> 💡 前端类比先行：Guard ≈ **Vue Router 的 `beforeEach` 导航守卫**——跳转（请求）到达页面前先过一道关卡，返回 `false` 就中止；`@Roles` 元数据 ≈ `route.meta.roles`，`Reflector` ≈ 守卫里读 `route.meta` 的那一步。

---

## 本阶段目标

- 理解守卫的职责：授权（"你能不能来"），与管道的"数据合不合法"区分开
- 掌握 `canActivate` 与 `ExecutionContext`
- 掌握元数据 + `Reflector` 驱动的声明式鉴权
- 掌握守卫的绑定级别（方法/控制器/全局 `APP_GUARD`）
- 实测确认执行顺序：中间件 → **守卫** → 拦截器 → 管道

---

## 知识点释义

### 1. 守卫是什么

守卫 = 实现 `CanActivate` 接口的类，唯一方法 `canActivate(context)` 返回布尔值（支持同步 / Promise / Observable）：

- `true` → 放行，请求进入后续环节
- `false` → Nest 自动抛 `ForbiddenException`（实测响应 ✅：`403 Forbidden resource`）
- 也可以自己抛更精确的异常（如 `UnauthorizedException`）——抛出的异常走异常层（06 章过滤器能接，实测 ✅）

**认证 vs 授权**（前端也要分清的一对概念）：

- **认证（Authentication）**：你是谁？——解析 token、拿到用户。本章的 `AuthGuard` 干这个（解析后把 user 挂到 `req` 上，≈ 前端登录后把 user 存进 Pinia）；
- **授权（Authorization）**：你能干什么？——拿用户角色和路由要求的角色比对。`RolesGuard` 干这个。

### 2. 为什么认证授权不放中间件（05 章练习 4 的答案兑现）

官方文档原话：中间件是**"上下文盲"**——它不知道 `next()` 之后是哪个处理器要执行。守卫拿得到 `ExecutionContext`，确切知道接下来执行什么。

实测 T5 还证明了一个排序事实：

```text
无 token 请求 /api/cats/abc：
  守卫先执行 → 403（授权失败）
  而不是 ParseIntPipe 先报 400（参数非法）
```

**守卫在管道之前**——先问"你能不能来"，再看"你带的东西合不合法"。顺序很符合直觉：门口的保安先查证件，安检仪才扫包。

### 3. `ExecutionContext`：守卫的超能力来源

`ExecutionContext` 继承 `ArgumentsHost`（06 章过滤器里见过的 `host`），新增两个关键方法：

```typescript
context.switchToHttp().getRequest(); // HTTP 上下文取 req（和过滤器一样）
context.getHandler();                 // 即将执行的路由方法（如 create）
context.getClass();                   // 方法所属的控制器类（如 CatsController）
```

**`getHandler()` / `getClass()` 是核心**——它们让守卫能读到"贴在路由上的元数据"，这就是声明式鉴权的地基。

前端类比：`beforeEach((to, from) => ...)` 里的 `to` 对象——知道要去哪个路由，才能读 `to.meta` 做判断。中间件没有这个 `to`。

### 4. 元数据 + Reflector：声明式角色控制（实测 ✅）

三步走：

**① 定义装饰器**（强类型方式）：

```typescript
// common/decorators/roles.decorator.ts
import { Reflector } from '@nestjs/core';

export const Roles = Reflector.createDecorator<string[]>();
```

**② 贴在路由上**（控制器级 + 方法级可以叠加）：

```typescript
@Controller('cats')
@UseGuards(AuthGuard, RolesGuard)  // 顺序有意义：先认证挂 user，再鉴权查 roles
@Roles(['user'])                    // 类级：整个控制器至少要求 user
export class CatsController {
  @Post()
  @Roles(['admin'])                 // 方法级：覆盖类级
  create(@Body() dto: CreateCatDto) { ... }
}
```

**③ 守卫里读取并判断**：

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {} // Reflector 由框架内置提供

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true; // 没贴 @Roles → 无角色要求

    const req = context.switchToHttp().getRequest();
    const user = req.user; // AuthGuard 挂上的
    return !!user && roles.some((r) => user.roles.includes(r));
  }
}
```

**实测验证的元数据规则** ✅：

| 请求 | 类级 | 方法级 | `getAllAndOverride` 结果 |
|---|---|---|---|
| GET /api/cats | `['user']` | 无 | `['user']`（取类级） |
| POST /api/cats | `['user']` | `['admin']` | `['admin']`（方法级覆盖，就近优先） |

另有 `getAllAndMerge()`（合并两级而非覆盖），按业务语义选择。

### 5. 绑定级别与 DI（老模式第三次出现）

```typescript
// 方法级 / 控制器级：传类，框架实例化，支持 DI（实测：Reflector 注入成功 ✅）
@UseGuards(AuthGuard, RolesGuard)

// 全局（main.ts）：手动 new，无 DI
app.useGlobalGuards(new AuthGuard());

// 全局（模块内，支持 DI）——和 APP_FILTER / APP_PIPE 完全同一套
{ provide: APP_GUARD, useClass: AuthGuard }
```

注意一个细节（官方提示）：`APP_GUARD` 注册的守卫是框架引导期消费的"伪 provider"，不能用 `app.get()` 获取或注入到别处。

### 6. 底层写法 `@SetMetadata()`（了解）

`Reflector.createDecorator` 是强类型的推荐写法；底层还有 `@SetMetadata('roles', ['admin'])`——直接操作元数据键值对。官方建议不要直接在路由上用它，而是封装成自定义装饰器（10 章的主题）。两者区别：`createDecorator` 读取时传**装饰器引用**，`SetMetadata` 读取时传**键字符串**。

### 7. 生命周期图（全链路已实测）

```text
请求 → 中间件 → [Guard] → Interceptor(前) → Pipe → Controller
                ↑ 你在这里：你能不能来？
        实测：无 token 访问 /api/cats/abc → 403（Guard）
             而非 400（ParseIntPipe）——守卫先于管道 ✅
```

---

## 代码实现

本章实验代码（已建好，已验证 ✅）：

- `common/guards/auth.guard.ts`——认证守卫：`Bearer admin`/`Bearer user` 解析成假用户挂到 `req.user`
- `common/guards/roles.guard.ts`——授权守卫：`Reflector.getAllAndOverride` 读角色元数据并比对
- `common/decorators/roles.decorator.ts`——`Roles = Reflector.createDecorator<string[]>()`
- `cats.controller.ts`——控制器级 `@UseGuards(AuthGuard, RolesGuard)` + `@Roles(['user'])`，`create` 方法级 `@Roles(['admin'])`

自测矩阵：

```bash
pnpm start:dev
curl http://localhost:3000/api/cats                                   # 403 无 token
curl -H 'Authorization: Bearer user' http://localhost:3000/api/cats   # 200（user 可读）
curl -X POST -H 'Authorization: Bearer user' ... /api/cats            # 403（create 要 admin）
curl -X POST -H 'Authorization: Bearer admin' ... /api/cats           # 200
curl http://localhost:3000/api/cats/abc                               # 403（守卫先于管道）
```

---

## 动手练习

1. **假用户升级**：现在 `AuthGuard` 里用户是写死的。改成从 token 里解析：" `Bearer user:{"name":"x","roles":["user"]}` "——即把 JSON 编码进 token 字符串（学习用，别当真 JWT）。体会：守卫只负责"解析+校验"，用户数据格式是可替换的。
2. **公开路由**：现在整个 CatsController 都要登录。加一个 `@Public()` 元数据装饰器（`SetMetadata('isPublic', true)` 或 `createDecorator<boolean>()`），让 `RolesGuard`/`AuthGuard` 读到它就直接放行，并把 `GET /cats/breeds` 标为公开。（这是真实项目里登录接口的标配模式。）
3. **全局化改造**：把 `AuthGuard` 改成 `APP_GUARD` 全局注册（全应用都要登录），配合练习 2 的 `@Public()` 放行公开路由——这就是博客项目阶段认证模块的架构原型。
4. **概念题**：`@UseGuards(A, B)` 的顺序为什么重要？如果写反成 `@UseGuards(RolesGuard, AuthGuard)`，本章的代码会发生什么？
5. **概念题**：守卫返回 `false`（403）和自己 `throw new UnauthorizedException()`（401），语义上有什么区别？分别该在什么时候用？

---

## 练习参考答案

**练习 4**：`@UseGuards` 数组按声明顺序执行。本章 `RolesGuard` 依赖 `req.user`，而 `user` 是 `AuthGuard` 挂上去的——写反了之后 `RolesGuard` 先执行，`req.user` 是 `undefined`，所有带 `@Roles` 的路由全部 403（永远拒绝），没带 `@Roles` 的路由反而放行——**鉴权逻辑整个颠倒**。这类 bug 没有报错提示，只能靠理解执行顺序避免。这也是"认证先行、授权在后"作为固定编排的原因。

**练习 5**：`false` → 403 Forbidden 的语义是"**我知道你是谁，但你没权限**"；`throw UnauthorizedException` → 401 的语义是"**我认不出你是谁**"（token 缺失/无效）。HTTP 语义规范里这两个状态码的分工就在于此。所以：`AuthGuard`（认证关）认不出身份时应该抛 401 而不是返回 false；`RolesGuard`（授权关）确认身份后权限不足，返回 false（403）或抛 `ForbiddenException` 都是对的。本章实验代码里 AuthGuard 返回 false 其实语义不精确——练习 1 改造时可以顺手改成抛 `UnauthorizedException`。

（练习 2 验证标准：无 token 访问 `/api/cats/breeds` 返回 200，其他路由仍 403；练习 3 验证标准：`/api/lab` 也要求 token 了，说明守卫全局生效。）

---

## 自检清单

- [ ] 能区分认证（你是谁）与授权（你能干什么），及 401 vs 403 的语义分工
- [ ] 能解释中间件"上下文盲"与守卫 `ExecutionContext` 的差异
- [ ] 掌握 `Reflector.createDecorator` + `getAllAndOverride` 的元数据读写闭环
- [ ] 知道守卫返回 false → 403，以及自行抛异常的选择
- [ ] 掌握三级绑定 + `APP_GUARD` 的 DI 差异（同 APP_FILTER/APP_PIPE）
- [ ] 实测记住执行顺序：中间件 → 守卫 → 管道（403 vs 400 实验）
- [ ] 自测矩阵五条 curl 全部符合预期

---

## 下阶段预告

**09 · Interceptors**：请求生命周期的最后一块拼图。RxJS 正式登场——拦截器包装的是**处理器返回的 Observable**，统一响应格式、耗时统计、日志、缓存都长在这里。05 章那个用 `writeHead` 黑魔法实现的计时中间件，本章用拦截器三行重写，你会直观感受到"机制选对了位置，代码就简单了"。
