# 10 · Custom Decorators：元编程收官

> 对应官方文档：[Custom decorators](https://docs.nestjs.com/custom-decorators)
> 本章目标：自定义参数装饰器（`createParamDecorator`）、装饰器组合（`applyDecorators`），把前 9 章的能力收敛成优雅的 API。
> ⚠️ 本章所有行为结论均在 **Nest v12 + ESM** 实测验证（实验代码：`src/common/decorators/`）。
> 💡 前端类比先行：`@User()` ≈ **React 的自定义 Hook `useUser()`**——把"从上下文里取数据"这件重复的事封装成一个调用点干净的 API；`applyDecorators` ≈ 把多个 HOC 合成一个。

---

## 本阶段目标

- 掌握 `createParamDecorator` 封装 req 上的数据提取
- 掌握 `applyDecorators` 组合多个装饰器
- 理解自定义装饰器与管道/守卫的协作关系
- 回顾全局：装饰器贯穿了 Nest 的一切

---

## 知识点释义

### 1. 为什么需要自定义参数装饰器

Node/Express 的惯例是把数据挂到 `req` 上（我们的 `AuthGuard` 就把 `user` 挂在 `req.user`）。控制器里每次手写：

```typescript
const user = (req as unknown as Record<string, unknown>).user; // 又丑又重复
```

自定义参数装饰器把它收敛成：

```typescript
// common/decorators/user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const User = createParamDecorator(
  (data: keyof FakeUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    return data ? user?.[data] : user; // 传了 key 就取单个属性
  },
);
```

使用（实测 ✅）：

```typescript
@Get('me')
getMe(@User() user: FakeUser, @User('name') name: string) { ... }
```

```text
GET /api/cats/me (Bearer admin)
→ {"user":{"name":"admin","roles":["admin","user"]},"name":"admin"}
```

**串联旧知识**：注意 `ctx: ExecutionContext`——08 章守卫用的就是它。参数装饰器和守卫、拦截器共享同一个上下文抽象，这就是 Nest 的设计一致性：**一处学会，处处可用**。

> 生命周期位置：参数装饰器在**管道阶段**求值（它产出的就是处理器参数）——所以它也能被管道处理（见第 3 节）。

### 2. 装饰器组合：`applyDecorators`（实测 ✅）

真实项目里"需要 admin 权限"这件事涉及一堆装饰器（角色元数据 + 守卫 + 将来的 Swagger 标注），逐个写既啰嗦又容易漏。`applyDecorators` 把它们合成一个：

```typescript
// common/decorators/auth.decorator.ts
import { applyDecorators, UseGuards } from '@nestjs/common';

export function Auth(...roles: string[]) {
  return applyDecorators(Roles(roles), UseGuards(RolesGuard));
  // AuthGuard 已全局注册（08 章练习 3），无需重复绑
}
```

使用：

```typescript
@Get('admin-zone')
@Auth('admin')  // 一次声明 = 元数据 + 守卫
adminZone() { ... }
```

实测矩阵 ✅：无 token 403（全局 AuthGuard）、`Bearer user` 403（RolesGuard 拒绝）、`Bearer admin` 200。

**设计价值**：`@Auth('admin')` 成了团队的**统一词汇**——新人不用知道背后是哪些装饰器，语义自解释。将来加 Swagger 标注（`ApiBearerAuth()` 等）只需改这一处。这就是 Nest 生态里 `@nestjs/swagger`、认证模块通用的封装套路。

### 3. 与管道协作

自定义参数装饰器和 `@Body()`/`@Param()` 地位平等，**管道同样会处理它的参数**。但注意：`ValidationPipe` 默认**不校验**自定义装饰器的参数，需要显式开启：

```typescript
@Get()
findOne(@User(new ValidationPipe({ validateCustomDecorators: true })) user: FakeUser) { ... }
```

### 4. 踩坑实录：角色继承（实测发现）

本章实验第一次失败暴露了一个真实 RBAC 问题：类级 `@Roles(['user'])` 把 `Bearer admin` 挡在门外——因为假用户 admin 只有 `['admin']` 角色，精确匹配不上 `'user'`。

```text
Bearer admin 访问 @Roles(['user']) 路由 → 403 ❌（反直觉）
```

修复（`auth.guard.ts`）：admin 的角色数组改为 `['admin', 'user']`——**角色继承：高角色持有低角色的全部权限**。真实系统里这通常做成角色层级表（admin ⊇ editor ⊇ user），匹配时展开。做博客项目的 RBAC 时会再遇到它。

### 5. 全景回顾：装饰器如何贯穿了 Nest

十章学完回看，Nest 的一切都是装饰器驱动的元数据 + 容器装配：

| 装饰器 | 本质 |
|---|---|
| `@Module()` | 给类贴元数据包（04 章源码验证） |
| `@Controller()` / `@Get()` | 路由元数据 → RouterExplorer 注册 |
| `@Injectable()` | 触发 TS 发射依赖元数据（01 章实验） |
| `@Roles()` / `@Public()` | 自定义元数据 → Reflector 读取（08 章） |
| `@User()` | 参数求值逻辑封装（本章） |
| `@Auth()` | 以上能力的组合（本章） |

**你自己已经会造装饰器了**——这意味着 Nest 对你不再是黑盒。

---

## 代码实现

本章实验代码（已建好，已验证 ✅）：

- `common/decorators/user.decorator.ts`——`@User()` / `@User('name')`
- `common/decorators/auth.decorator.ts`——`@Auth(...roles)` 组合装饰器
- `cats.controller.ts`——`GET /api/cats/me` 探针
- `app.controller.ts`——`GET /api/admin-zone` 探针（组合装饰器验证）
- `auth.guard.ts`——admin 角色继承 `['admin', 'user']`

自测：

```bash
pnpm start:dev
curl -H 'Authorization: Bearer admin' http://localhost:3000/api/cats/me       # user + name
curl http://localhost:3000/api/admin-zone                                    # 403
curl -H 'Authorization: Bearer user' http://localhost:3000/api/admin-zone    # 403
curl -H 'Authorization: Bearer admin' http://localhost:3000/api/admin-zone   # 200
```

---

## 动手练习

1. **`@TraceId()` 装饰器**：写一个参数装饰器，从 req 上取 06 章中间件挂的 `traceId`，在 lab 的某个路由里返回它。验证：`curl` 带 `X-Request-Id` 头时应返回你传的值。
2. **`@Auth()` 升级**：把 `@Public()` 也纳入组合体系——思考"公开"和"需要角色"能不能共存于一个装饰器（提示：互斥关系，设计上应该分开，想想为什么）。
3. **管道协作实验**：给 `@User('name')` 挂一个自定义管道（比如把 name 转成大写），验证管道对自定义装饰器参数生效。
4. **概念题**：`@Auth('admin')` 和"中间件 + forRoutes 路径配置"两种鉴权声明方式，为什么前者更不易出错？
5. **概念题**：`createParamDecorator` 的工厂函数里能注入 Service 吗（比如想直接返回数据库查出的完整 User 实体）？如果不能，正确做法是什么？

---

## 练习参考答案

**练习 2**：不应合并。`@Public()` 和 `@Auth('admin')` 语义互斥（一个免认证、一个要认证加角色），合并成一个装饰器会造成"同时声明 Public 和 Roles 时谁生效"的歧义。正确的组合体系是**两个正交的装饰器各管各的**：`@Public()` 管认证豁免，`@Auth(...roles)` 管角色要求，守卫里按"先查 Public、再查 Roles"的固定次序读。设计原则：组合装饰器合并的是"总是一起出现"的关注点，互斥的关注点保持分离。

**练习 4**：`@Auth('admin')` 贴在路由上，**跟着路由走**——重构路径、移动控制器都不受影响，且类型/拼写错误编译期就能发现；中间件 + `forRoutes('cats/admin')` 是字符串约定，路由改名时两边失联（05 章你亲身踩过路径匹配的坑）。声明式绑定 > 字符串约定，这是 Nest 全框架反复出现的主题。

**练习 5**：**不能注入**——`createParamDecorator` 的工厂是普通函数，不在 DI 容器里，拿不到 Service。正确做法：参数装饰器只做**轻量提取**（从 req 拿已就绪的数据）；需要查库的场景，让守卫/拦截器先把完整实体查好挂到 `req` 上（它们支持 DI），装饰器再提取。这正是 Node 惯例"数据挂 req"与 Nest DI 体系的正确分工：**有 DI 的机制（守卫/拦截器）负责干活，无 DI 的机制（参数装饰器）负责取值**。

（练习 1 验证标准：响应中的 traceId 与请求头一致；练习 3 验证标准：`Bearer admin` 访问时返回的 name 变成 `ADMIN`。）

---

## 自检清单

- [ ] 能手写 `createParamDecorator` 并解释 data 参数的作用
- [ ] 掌握 `applyDecorators` 组合，理解"团队统一词汇"的封装价值
- [ ] 知道自定义装饰器参数可被管道处理（`validateCustomDecorators`）
- [ ] 理解角色继承问题（实测踩坑）
- [ ] 能说出参数装饰器在生命周期的位置（管道阶段求值）
- [ ] 四条自测 curl 全部符合预期

---

## 基础篇完结

Overview 十章全部拿下。你现在的 `base` 项目已经拥有：完整请求生命周期的每个环节、DI 容器的各种玩法、模块封装与动态配置、统一响应/错误格式、声明式认证授权——而且每个结论都经过亲手验证。

**下一步：博客项目实战**。按最初定的路线（Prisma 数据层 → JWT 认证 → 真实业务能力 → 测试 → Docker 上线），每一站都会复用这十章打下的地基。准备好就说开始。
