# P6 · 可靠性与并发：来几次都一样

> 项目：blog（Nest v12 + BullMQ + @nestjs/throttler）
> 本章目标：实现幂等点赞、接口限流、异步任务队列，建立"重复是常态"的可靠性思维。
> ⚠️ 全部实测：20 并发点赞仅 1 行 ✅、登录超限 429 ✅、发布 30ms 返回任务异步完成 ✅。
> 💡 前端类比：前端的防重是 `button.disabled = true`（防抖/节流）；后端的防重必须假设**按钮会被绕开**——双击、网络重试、刷新重提，同一个请求到达两次是常态。

---

## 本章的后端思维主题：重复是常态，幂等是设计

前端防重复提交靠禁用按钮；但后端的世界里重复不可避免：

```text
用户双击 → 两个请求
网络超时 → 客户端重试 → 两个请求
负载均衡健康检查、消息队列至少一次投递 → 重复是协议的一部分
```

**幂等（idempotent）= 同一操作执行一次和执行 N 次，最终状态一样。** 后端接口的默认假设应该是"会被重复调用"，然后为每个接口回答：重复的代价是什么？怎么设计让重复无害？

---

## 知识点释义

### 1. 幂等的三层实现（从弱到强）

**① 利用操作天然幂等**（首选）：

```typescript
// 取消点赞：deleteMany 删 0 行也不报错——天然幂等
await this.prisma.like.deleteMany({ where: { articleId, userId } });
// PUT 全量更新、DELETE 删除，通常天然幂等
```

**② 唯一约束 + upsert**（本章点赞方案，实测 ✅）：

```prisma
@@unique([articleId, userId]) // 幂等的物理保证在数据库层
```

```typescript
await this.prisma.like.upsert({
  where: { articleId_userId: { articleId, userId } },
  create: { articleId, userId },
  update: {}, // 已存在 → 空操作，照样成功
});
```

实测：**20 并发点赞 → Like 表只有 1 行**。注意设计哲学：**幂等不是"代码里小心判断"，而是用数据库唯一约束做物理保证**——判断有并发窗口，约束没有（数据库串行处理冲突）。

**③ 幂等键（Idempotency-Key，支付级操作）**：客户端为每个操作生成 UUID 放请求头，服务端用该键去重（第一次执行存结果，重复请求直接返回缓存的结果）。用于"转账、下单"这种不能靠唯一约束表达的场景。

**POST vs PUT 的语义提醒**：POST 创建天然不幂等（每次创建新资源），所以点赞这种"状态切换"场景，设计上要么用 upsert 兜底，要么改 PUT 语义（`PUT /articles/:id/like` = "确保点赞状态存在"）。

### 2. 限流：保护系统的闸门（实测 ✅）

`@nestjs/throttler` 全局 + 局部双层：

```typescript
// app.module：全局兜底 60s/60 次
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],

// 登录接口收紧：60s/5 次（防密码爆破）
@Throttle({ default: { ttl: 60_000, limit: 5 } })
@Post('login')
```

实测：前 5 次 401（密码错误），第 6、7 次 **429 Too Many Requests**。

**哪里该限流**（按攻击面排）：登录/注册（爆破）、发短信验证码（烧钱）、公开搜索接口（爬虫）、一切写操作。**限流的目标不是"限制用户"，是让"恶意请求的边际成本变高"**。

### 3. 异步队列：慢操作移出请求链路（实测 ✅）

发布文章要做的事分两类：**必须同步完成的**（写库、事务）和**可以稍后的**（发通知、生成摘要、推送）。后者进队列：

```text
同步路径：publish → 事务提交 → 投递任务 → 响应（30ms ✅）
异步路径：Worker 从队列取任务 → 执行 3 秒的"发通知" → 完成
```

```typescript
// 生产侧（publish 事务提交后）
await this.notifyQueue.add('send-publish-notification', { articleId: id });

// 消费侧（Worker，@Processor 注册）
async process(job: Job) { /* 耗时操作在这里 */ }
```

实测：publish 响应 **30ms** 返回，3 秒后任务完成——用户不用等发通知。

**队列名 = 三方汇合的频道名**（三个 `notifications` 必须一致）：

```text
┌─ 生产侧 ──────────────────┐      ┌─ Redis（存储/信道）───────┐      ┌─ 消费侧 ─────────────────┐
│ registerQueue({name})     │      │ bull:notifications:*      │      │ @Processor('notifications')│
│  → 队列句柄注册进 DI       │      │ （任务真实存放处，          │      │  → Worker 监听同名队列，    │
│ @InjectQueue('notifications')     │  队列名是 key 前缀）       │      │    process(job) 逐个消费   │
│  → 取出句柄，queue.add() ──┼─────►│──任务入队────────────────►│─────►│                          │
└───────────────────────────┘      └───────────────────────────┘      └──────────────────────────┘
```

- `registerQueue({ name })`：注册——把队列句柄放进 DI 容器（token：`BullQueue_<name>`）；
- `@InjectQueue('<name>')`：生产——按名取句柄放任务；
- `@Processor('<name>')`：消费——按名监听并执行。

改名三处必须同步改，否则任务进"无人收件的信箱"（`redis-cli KEYS 'bull:*'` 可见堆积）。
与前端 Web Worker 对照：`postMessage`/`onmessage` 是内存信道；BullMQ 同模型，信道换成 Redis——所以任务**跨进程、跨机器、重启不丢**。

**队列带来的三个能力**（BullMQ 基于 Redis 持久化）：

1. **削峰**：突发 1000 个发布，请求快速返回，任务排队慢慢消化；
2. **重试**：任务失败自动重试（BullMQ 自带 attempts/backoff 配置）；
3. **解耦**：通知逻辑挂了不影响发布主流程。

### 5. 场景速查：异步需求该找哪个库

遇到"这个操作要不要让请求等它"的需求，按这张表决策：

| 场景 | 选什么 | 理由 |
|---|---|---|
| **Nest/Node 的异步任务/定时任务/发通知**（默认答案） | **BullMQ**（Redis 底座） | Nest 官方 Queues 章节就是 BullMQ；项目已有 Redis 时零额外设施 |
| 极轻量、无 Redis 的进程内任务 | `setImmediate` / Bree（cron 风格） | 不必上队列 |
| 跨服务消息广播、复杂路由 | RabbitMQ / Kafka | 任务队列（后台干活）≠ 消息流（系统间通信），别混 |
| 云托管 / Serverless | AWS SQS / GCP Pub/Sub | 免运维、按量付费 |
| 大数据事件流（日志管道、CDC） | Kafka | 高吞吐流，不是任务队列 |
| 分布式锁/幂等键等并发原语 | Redis 手写（`SET NX EX`）或 **redlock** 库 | 临界区长/多节点/资损级 → redlock；短临界区 → 手写够用 |

口诀：**Node 项目异步任务先想 BullMQ；需求超出"后台干活"变成"系统间消息流"才看 RabbitMQ/Kafka；云上托管看 SQS。**

其他生态对照：Go = `singleflight`（进程内请求合并）、Java = Redisson（分布式锁）/ Celery（Python 任务队列）——同一思想，各语言一个代表作。

### 6. 踩坑实录：队列注册的模块归属（04 章再现）

第一次接入报 `UnknownDependenciesException: BullQueue_notifications`。原因：`BullModule.registerQueue()` 注册在 `QueuesModule` 里，而注入方是 `ArticlesModule`——**模块边界**。正确模式（官方 forRoot/forFeature 约定）：

```typescript
// BullModule.forRoot()：全局一次（连接配置），放 QueuesModule
// BullModule.registerQueue()：每个【消费队列的模块】各自注册（forFeature 语义）
imports: [BullModule.registerQueue({ name: 'notifications' })]
```

"谁消费谁注册"，和 TypeORM 的 `forFeature([Entity])` 是同一个模式（04 章命名约定的真实应用）。

---

## 代码实现（已建好，全部实测 ✅）

- `Like` 模型（`@@unique([articleId, userId])`）+ `like`/`unlike`（upsert/deleteMany 幂等）
- `@nestjs/throttler`：全局 60/60 + 登录 60/5
- `src/queues/`：`notifications` 队列 + `NotificationProcessor`（消费端）
- `publish`：事务提交后 `queue.add()` 投递异步任务

自测：

```bash
# 幂等：20 并发点赞，Like 表应为 1 行
seq 1 20 | xargs -P 10 -I{} curl -s -o /dev/null -X POST localhost:3000/articles/4/like -H "Authorization: Bearer $TOKEN"

# 限流：连续 7 次登录，后两次应 429
# 队列：publish 后看控制台 [Queue] 日志（响应 30ms，任务 3s 后完成）
```

---

## 动手练习

1. **收藏功能**：给博客加收藏（`Favorite` 模型），要求接口幂等，且文章详情返回"当前用户是否已收藏"（提示：详情查询加 `_count` 或按 userId 过滤）。
2. **评论通知**：评论文章时给作者发通知（异步任务）。注意队列任务的 data 应该放" commentId"还是整个评论对象？为什么？（提示：任务可能延迟执行，数据会变）
3. **限流维度**：现在的限流按 IP。已登录用户的接口想按用户 ID 限流怎么做？（提示：ThrottlerGuard 可继承重写 `getTracker`）
4. **概念题**：为什么说"唯一约束做幂等"比"代码里先查再插"可靠？（提示：并发窗口）
5. **概念题**：队列任务的"至少一次投递"语义意味着消费者也可能收到重复任务——消费者该怎么设计？（提示：本章主题）

---

## 练习参考答案

**练习 1（收藏功能，已实测落地）**：幂等部分与点赞同构（`Favorite` 模型 + `@@unique([articleId, userId])` + upsert/deleteMany）。重点是详情的 `isFavorited`，涉及三个关键设计：

**① 缓存陷阱：共享缓存 vs 用户态数据**

文章详情走共享缓存（`article:detail:{id}`，全员共用）。如果把 `isFavorited` 塞进缓存对象，用户 A 的收藏状态会泄露给用户 B。**分层原则：共享缓存只放"全员一致"的数据，用户态数据在缓存外单独查、响应前合并**：

```typescript
async findOne(id: number, userId?: number) {
  const article = await this.getArticleDetail(id); // 缓存逻辑全在这，纯数据
  const isFavorited = userId
    ? !!(await this.prisma.favorite.findUnique({
        where: { articleId_userId: { articleId: id, userId } },
      }))
    : false;
  return { ...article, isFavorited }; // 单一出口合并
}
```

**② 多出口后处理 → 收敛到单一出口**

详情缓存有四个返回分支（HIT/双检/持锁回源/兜底），第一版只在兜底分支加了合并——其余三条全部漏掉（实测：HIT 时字段直接消失）。**教训：一个方法有多个 return 又要统一加工返回值时，把取数收进私有方法，加工在最外层只做一次。** 这是"洋葱最外层做横切"的方法内版本。

**③ 可选认证（Optional Auth）**

详情是 `@Public()` 的，但登录用户需要识别身份才能算收藏状态。改造全局 `AuthGuard` 的 Public 分支——**放行但尝试解析 token**：

```typescript
if (isPublic) {
  const token = this.extractToken(req);
  if (token) {
    try {
      (req as any).user = await this.jwtService.verifyAsync(token); // 有就挂上
    } catch { /* 无效 token 当未登录，不阻断公开内容 */ }
  }
  return true;
}
```

**验收矩阵（全部实测通过 ✅）**：未登录 `false` / 收藏者 `true` / 未收藏者 `false` / Redis 缓存对象不含该字段。

**练习 2**：放 **commentId**（引用），不放整个对象（快照）。任务可能几秒甚至几分钟后才执行，快照数据会过期（评论被编辑/删除了，通知内容还是旧的）；消费者执行时按 id 查最新数据。这也是队列设计的通用原则：**任务载荷放"找数据的钥匙"，不放"数据本体"**（钥匙小、不过期；本体可能已变）。

**练习 4**："先查再插"是两个操作，并发下两个请求都查到"没有"→ 都插 → 重复（P4 的读-改-写陷阱复现）。唯一约束把判断和写入压成数据库层的**一个原子操作**——数据库串行处理插入冲突，后到的请求要么报错（可捕获转成功）要么被 upsert 吸收。**并发安全的规则必须在数据库层 enforce，应用层的检查总有窗口。**

**练习 5**：消费者同样要**幂等设计**——因为队列至少投递一次，重复消费是必然。手段和本章一致：任务携带业务唯一键（如 commentId+notificationType），消费时先查"这个通知发过了吗"（唯一约束/状态标记），发过就跳过。**"至少一次 + 幂等消费 = 恰好一次"的效果**，这是分布式系统的标准等式。

（练习 1 验证标准：同一用户重复收藏不重复插行，详情返回 isFavorited 字段；练习 3 的思考标准：能说出"按用户 ID 作 tracker key，未登录回落到 IP"。）

---

## 自检清单

- [ ] 能解释幂等的三种实现层级及适用场景
- [ ] 理解"唯一约束 > 先查再插"的并发理由
- [ ] 知道限流的双层配置（全局兜底 + 高危收紧）
- [ ] 理解队列的三大收益（削峰/重试/解耦）与"载荷放钥匙不放本体"
- [ ] 理解"至少一次投递 + 幂等消费 = 恰好一次"
- [ ] 三个自测实验亲手跑过

---

## 下阶段预告

**P7 · 上线**：把 blog 部署成一个真正可访问的服务。思维主题：**运维思维**——环境分离（配置外置）、健康检查、Docker 多阶段构建、日志与可观测性。你的博客将拥有一个真实的部署流程。
