# P2 · 认证体系：信任边界——客户端不可信

> 项目：blog（Nest v12 + Prisma 7 + @nestjs/jwt + bcryptjs）
> 本章目标：完成注册/登录/JWT 认证全链路，建立"客户端不可信"的后端安全思维。
> ⚠️ 全链路实测通过（T1-T6 见文末自测矩阵），含一次真实踩坑记录。
> 💡 前端类比：前端存的 token 是"自我保管的通行证"；后端的责任是**永远假设这张通行证可能是伪造的**，每次都要验。

---

## 本章的后端思维主题：信任边界

前端的安全模型是"保护用户"（XSS 防护、CSP）；后端的安全模型是"**防着调用方**"——HTTP 请求可以来自任何地方：你的前端、Postman、curl、恶意脚本。由此推出一系列后端本能：

1. **一切输入都要校验**（所以 DTO + ValidationPipe 是标配，不是可选项）；
2. **敏感数据永不出境**（密码哈希存库、返回时剥离）；
3. **错误信息也是情报**（登录失败不区分"邮箱不存在"还是"密码错误"）；
4. **身份凭证必须可验证且不可伪造**（JWT 签名）。

---

## 知识点释义

### 1. 密码为什么用 bcrypt 哈希（实测 ✅）

数据库实测，密码字段存的是：

```text
$2b$10$IMVvp1MfwbAC2...
│   │   └ 盐 + 哈希值（盐嵌在结果里，验证时自取）
│   └ cost 因子 10（计算 2^10 轮）
└ bcrypt 算法标识
```

三个设计决策的"为什么"：

- **哈希而不是加密**：加密可逆（有密钥就能解），密钥泄露 = 全部明文泄露。哈希不可逆，数据库泄露了攻击者拿到的也是哈希——连你自己都不知道用户密码是什么，这才叫不存密码；
- **为什么不用 MD5/SHA256**：它们是**快哈希**，一秒钟能试几十亿个候选密码（彩虹表/GPU 暴力破解）。bcrypt 是刻意的**慢哈希**，cost 因子让每次计算耗时可控地慢（~100ms）——正常登录无感，暴力破解直接绝望；
- **盐（salt）**：相同密码每次哈希结果不同（盐随机），攻击者无法"一份彩虹表走天下"。

> 依赖选择说明：项目用 `bcryptjs`（纯 JS 实现）而非 `bcrypt`（原生 C++）——因为 pnpm 默认拦截依赖的 postinstall 脚本，bcrypt 的预编译二进制下载会被静默拦截导致运行时报错。生产对性能敏感可换 `bcrypt` 并在 pnpm 里 approve 其构建脚本。

### 2. 防用户枚举：统一错误文案（实测 ✅）

```typescript
// ❌ 泄露情报
if (!user) throw new UnauthorizedException('邮箱不存在');
if (!bcrypt.compare(...)) throw new UnauthorizedException('密码错误');

// ✅ 统一（实测 T3 返回）
throw new UnauthorizedException('邮箱或密码错误');
```

"邮箱不存在"这句话等于告诉攻击者**这个邮箱注册过**——攻击者可以批量试邮箱，枚举出注册用户名单，再针对性撞库。同类设计：注册时也不能回"邮箱已注册"以外的细节（T2 的 409 是业务需要，可以接受）。

### 3. JWT：签名，不是加密（实测 ✅）

登录成功返回的 token 长这样（T6 实测）：

```text
eyJhbGciOi...  .  eyJzdWI6MiwiZW1haWwiOi...  .  SflKxwRJSM...
   header            payload（明文！）              signature
```

**payload 只是 Base64Url 编码，不是加密**——任何人拿到 token 都能解出内容（你可以把 T6 的 token 贴到 [jwt.io](https://jwt.io) 里亲眼看）。所以：

- **payload 里绝不放敏感信息**（密码、手机号）；
- 安全性的来源是**签名**：服务器用密钥对 header.payload 签名，篡改任何字符 → 签名对不上 → 验签失败（401）。攻击者能看，但改不了。

**无状态的意义**：服务器不用存 session，验签就能确认身份——水平扩展友好（多台服务器共享同一个密钥即可）。代价：**签出去就收不回**（想强制下线？得引入黑名单/短过期+refresh，见练习 4）。

### 4. 体系串联：全是基础篇的复用

本章没有新机制，全是前 10 章知识的组合：

```text
@Public() 装饰器（SetMetadata）          ← 08 章
全局 AuthGuard（APP_GUARD + Reflector）  ← 08 章练习 3 的原型落地
req.user 挂载                            ← 05 章 req 突变模式
@CurrentUser() 参数装饰器                ← 10 章
DTO + ValidationPipe（whitelist+transform） ← 07 章
UsersModule exports UsersService         ← 04 章模块边界
```

请求流：`POST /auth/register`（@Public 放行）→ 管道校验 DTO → bcrypt 哈希 → 入库 → 返回（剥密码）；之后每个请求 → 全局守卫验签 → payload 挂 req.user → 控制器 `@CurrentUser()` 直取。

### 5. 踩坑实录：`import type` 擦掉 DTO，校验全部静默失效（实测）

本章第一次全链路测试时，注册接口对任何 body 都返回 500，深挖发现：

```typescript
// ❌ 错误写法（我第一版就这么写的）
import type { RegisterDto } from './dto/auth.dto.js';
```

`import type` 在编译时被完全擦除 → TS 发射的 `design:paramtypes` 元数据里 metatype 变成 **`Function`**（产物里实测可见）→ `ValidationPipe` 拿到错误的 metatype → `plainToInstance(Function, body)` 产出空壳 → **所有字段丢失、校验不执行**。

**规则：被管道消费的 DTO，永远用常规 `import`，不用 `import type`**。官方 Validation 文档明确警告过这条（"type-only import 运行时会被擦除"），这次算用 500 交的学费。

---

## 代码实现（已建好，全部实测 ✅）

```text
src/
├── auth/
│   ├── auth.module.ts       # JwtModule.register(global) + APP_GUARD 全局守卫
│   ├── auth.service.ts      # register（哈希入库+剥密码）/ login（比对+签 token）
│   ├── auth.controller.ts   # /auth/register /auth/login（@Public）/auth/profile
│   ├── auth.guard.ts        # 验签 + @Public 短路 + req.user 挂载
│   ├── decorators/
│   │   ├── public.decorator.ts        # @Public()
│   │   └── current-user.decorator.ts  # @CurrentUser() + JwtPayload 类型
│   └── dto/auth.dto.ts      # RegisterDto / LoginDto（class-validator）
├── users/                   # UsersService（Prisma 查询），exports 给 AuthModule
└── prisma/                  # P1 的 PrismaModule（@Global）
```

环境变量：`.env` 加 `JWT_SECRET`（**绝不硬编码进仓库**；生产用密钥管理服务）。

---

## 自测矩阵（全部实测通过 ✅）

```bash
pnpm start:dev
# T1 注册（返回无 password 字段）
curl -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"a@b.com","password":"password123","nickname":"x"}'
# T2 重复注册 → 409
# T3 错误密码 → 401 "邮箱或密码错误"
# T4 非法 DTO → 400 详细错误数组
# T5 无 token 访问 /auth/profile → 401
# T6 带 token 访问 /auth/profile → {"sub":2,"email":"...","role":"USER","iat":...,"exp":...}
```

---

## 动手练习

1. **token 拆解**：把 T6 拿到的 token 贴到 jwt.io（或 `Buffer.from(payload, 'base64url').toString()` 本地解），回答：payload 里有什么？改掉其中一个字符再访问 profile，观察结果。
2. **过期验证**：把 `expiresIn` 改成 `'5s'`，登录后等 6 秒再访问 profile，观察守卫的哪一行接住了过期（提示：`verifyAsync` 抛什么）。
3. **管理员注册门**：现在任何人都能注册成 USER。如果产品要支持 ADMIN，怎么设计才不让人注册时传 `role: 'admin'` 直接提权？（提示：whitelist 已经在防了，验证它——POST 注册时带 `"role":"ADMIN"` 看结果；再思考真正需要管理员时怎么办）
4. **概念题**：JWT 无状态意味着"签发后服务器无法主动作废"。用户点了"退出登录"或"修改密码后踢掉所有设备"，怎么实现？（说出至少两种方案及代价）
5. **概念题**：token 存在前端的 localStorage vs HttpOnly Cookie，各自防什么、怕什么？（这是前端主场题，向后端视角过渡的关键一问）

---

## 练习参考答案

**练习 3**：whitelist 实测会把 `role` 字段剥掉（DTO 里没声明它）——这就是 07 章防批量赋值攻击的实战价值。真正需要管理员时的正解：**管理员不通过公开注册产生**——第一个管理员用 seed 脚本/数据库直接写入，后续管理员由现有管理员在后台接口提升（该接口本身要 ADMIN 角色权限，P3 授权体系展开）。

**练习 4**：两种主流方案：
- **短过期 + Refresh Token**：access token 只活几分钟~几小时，refresh token 活几天且**存数据库**（可作废）。退出登录 = 删掉 refresh token。代价：多一张表 + 刷新接口；
- **黑名单**：把要作废的 token（jti）写进 Redis，守卫验签时多查一次。代价：每次请求多一次存储查询，牺牲部分无状态性。
共同思想：**用一点服务器状态换回"可作废"的能力**，纯无状态和可作废不可兼得。

**练习 5**：localStorage——防不了 XSS（恶意脚本随便读 token），但天然免疫 CSRF（不随请求自动携带）；HttpOnly Cookie——JS 读不到（防 XSS 窃取），但浏览器自动携带（要防 CSRF：SameSite/CSRF token）。现代建议：**refresh token 放 HttpOnly Cookie + access token 放内存（不落地）**，各取所长。

---

## 自检清单

- [ ] 能解释 bcrypt 的三个设计（不可逆/慢/盐）分别防什么
- [ ] 能解释 JWT "能看不能改"（签名 vs 加密）
- [ ] 理解防用户枚举的统一文案原则
- [ ] 知道 DTO 禁用 `import type`（实测踩坑）
- [ ] 能画出完整认证流程图（注册/登录/守卫/装饰器各司其职）
- [ ] 自测矩阵 T1-T6 全部通过

---

## 下阶段预告

**P3 · 授权体系**：登录解决"你是谁"，授权解决"你能干什么"。RBAC 落地到博客：管理员能删任何文章，作者只能改自己的——**横向越权（IDOR）**防护登场，`ArticleOwnershipGuard` 带你理解"资源归属校验"为什么必须在服务端做。
