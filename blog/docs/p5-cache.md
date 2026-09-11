# P5 · 缓存与性能：副本就有一致性问题

> 项目：blog（Nest v12 + Redis 7 + ioredis）
> 本章目标：落地文章详情缓存（Cache-Aside），实测缓存三大经典问题，建立"缓存思维"。
> ⚠️ 全部实测：MISS→HIT ✅、穿透哨兵 ✅、更新后失效 ✅、TTL 抖动（代码级）✅。含一次依赖装错目录的踩坑实录。
> 💡 前端类比：缓存 ≈ 前端的 SWR/React Query——但前端的缓存只影响"这一个用户看到旧数据"，后端的缓存影响**所有用户**，而且数据库不像后端接口那样"永远是最新真源"的假设由你来保证。

---

## 本章的后端思维主题：缓存思维

缓存的本质是**副本**。前端的缓存（SWR、React Query）过期了顶多一个用户看到旧数据；后端的缓存是全局共享的，一旦和数据库不一致，**所有用户**都看到错的数据。所以后端用缓存必须同时回答两个问题：

1. **什么时候信缓存**（命中率、TTL 设计）；
2. **什么时候不信**（失效/一致性策略）。

面试的"缓存三连问"（穿透/击穿/雪崩）全是围绕这两个问题的极端场景。

---

## 知识点释义

### 1. Cache-Aside（旁路缓存）：最常用的缓存模式（实测 ✅）

```text
读：缓存有 → 直接用（HIT）
    缓存没有 → 查库（MISS）→ 写回缓存 → 返回
写：更新数据库 → 删掉缓存
```

代码（`articles.service.ts` 的 `findOne`）：

```typescript
const cached = await this.cache.getJson(key);
if (cached) return cached;              // HIT
const article = await this.queryFromDb(id); // MISS，回源
await this.cache.setJson(key, article, 60); // 回填
```

实测日志：`MISS article:detail:3，回源数据库` → 第二次 `HIT`。

**为什么写操作是"删缓存"而不是"更新缓存"**：① 缓存的值可能是多表拼装/计算过的（比如带 author、tags 的详情），重写成本高还容易算错；② 删掉后下一个读请求按需重建，永远以数据库为准（懒加载思想）。**删比重写安全。**

### 2. 一致性顺序：先更库，后删缓存（实测 ✅）

实测链路：读（建缓存）→ 更新标题 → 缓存被删 → 再读 MISS 拿到新标题 ✅。

为什么不反过来（先删缓存再更库）？时序漏洞：

```text
线程A：删缓存
线程B：读 → MISS → 查到【旧值】→ 回填缓存   ← 在 A 更新数据库之前完成
线程A：更新数据库
结果：缓存里是旧值，且这次没人再删它 → 长时间不一致
```

"先更库后删缓存"也有理论上的小窗口（删缓存失败），但概率低得多，配 TTL 兜底（就算删除失败，最多脏 60 秒）。**一致性没有银弹，是"把错误窗口压到最小 + TTL 兜底"**。

### 3. 缓存穿透：查不存在的数据（实测 ✅）

**攻击/事故场景**：有人故意刷 `GET /articles/99999`（不存在的 id）——缓存永远 MISS，每个请求都打库，数据库被拖死。

防线（本章实现）：**空值哨兵**——库里没有也写缓存（`__NULL__`，短 TTL 30s）：

```text
第一次查 9999：MISS → 库里没有 → 写哨兵 → 404
第二次查 9999：哨兵命中 → 直接 404，不碰数据库 ✅（实测：日志无 MISS）
```

进阶方案（了解）：布隆过滤器——把"所有存在的 id"放进一个概率数据结构，不存在的请求在内存里就被拦掉。哨兵防"少量恶意 id"，布隆防"海量随机 id"。

### 4. 缓存击穿：热点 key 过期瞬间的并发回源（已实测 ✅）

**场景**：爆款文章的缓存 key 过期那一瞬，1000 个并发请求同时 MISS → 同时回源 → 数据库瞬间 1000 次相同查询（dogpile 效应）。

防线：**互斥重建（singleflight）**——第一个 MISS 的请求拿锁重建，其他请求等它。已落地在 `articles.service.ts` 的 `findOne`：

```typescript
// MISS → 抢锁重建：SET lockKey 1 EX 5 NX（抢到='OK'，没抢到=null）
const lockKey = `article:lock:${id}`;
const gotLock = await this.cache.client.set(lockKey, '1', 'EX', 5, 'NX');

if (gotLock === 'OK') {
  try {
    // 双检：等锁期间可能已被别的请求重建好
    const recheck = await this.cache.getJson(key);
    if (recheck) return recheck;

    const article = await this.queryFromDb(id);   // 全系统只有一个回源
    await this.cache.setJson(key, article, 60);
    return article;
  } finally {
    await this.cache.del(lockKey); // 必须释放（异常也要放）
  }
}

// 没抢到锁：等 100ms 重读一次，还没有就兜底回源（不死等）
await new Promise((r) => setTimeout(r, 100));
const retry = await this.cache.getJson(key);
if (retry) return retry;
return this.rebuildFromDb(id); // 兜底：永远可用
```

**并发时间线**（实测：20 并发打刚删的 key，只有 1 次回源）：

```text
时刻   请求A                    请求B                    请求C
─────────────────────────────────────────────────────────────────
t0    getJson → MISS          getJson → MISS          getJson → MISS
t1    set(lock,NX) → 'OK' ✅   set(lock,NX) → null ❌    set(lock,NX) → null ❌
t2    双检 → 仍 null           sleep(100ms) 等待        sleep(100ms) 等待
t3    回源（3条SQL）→ 回填      …等待中                  …等待中
      finally: del(lock)
t4    返回                     重读 → 命中 ✅            重读 → 命中 ✅
```

**六层防御（每层都假设上一层会失效）**：

| 层 | 机制 | 防什么 |
|---|---|---|
| 1 | 缓存 HIT | 99% 请求根本不走锁逻辑 |
| 2 | `SET NX` 抢锁 | 并发里只放行 1 个回源 |
| 3 | 双检 | 抢锁间隙已被别人重建 → 不做重复劳动 |
| 4 | `EX 5` 锁过期 | 持锁进程崩溃 → 锁自动消失，不死锁 |
| 5 | 等待重读 | 没抢到的请求不添乱（≈ React Query 的 deduping） |
| 6 | 兜底回源 | 等待也没等到 → 降级成无锁模式，系统永远可用 |

**两个易错点**：① finally 和 EX 缺一不可——finally 管正常/异常路径释放，EX 管进程被 `kill -9`（finally 不执行）的死锁；② 锁的 key 和数据的 key 别写混。

**等待策略的取舍**：为什么只等一次不循环？① 重建只要几毫秒，100ms 足够，等不到说明持锁者出事了，再等没意义；② 等待中的请求占连接，循环等待在极端并发下会压垮 Node 进程；③ 兜底回源保证"永远有进展"。**慢重建场景**（聚合报表等秒级计算）才用循环重试：

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  await new Promise((r) => setTimeout(r, 100));
  const retry = await this.cache.getJson(key);
  if (retry) return retry;
}
return this.rebuildFromDb(id); // 出口永远存在
```

**实测数据**：20 并发打刚删除的 key → 1 个 MISS 持锁回源（3 条 SQL：include 的作者+标签各一条，呼应 P4）+ 9 个等待后命中 + 10 个直接命中。没有锁时是 20 次回源（60 条 SQL）。

前端类比：≈ React Query 的 **deduping**（相同 key 的并发请求合并成一次）。区别：这里的锁在 Redis 里，**多实例部署也有效**（Node 进程级锁只能管单实例）。

### 5. 缓存雪崩：大量 key 同时过期

**场景**：所有缓存 TTL 都设 60s，同一时刻批量写入 → 60 秒后集体过期 → 集体回源 → 数据库被打满 → 更多请求堆积，恶性循环。

防线（本章已实现）：**TTL 加随机抖动**——`ttl + random(0~30)`，让过期时间散开：

```typescript
const jitter = Math.floor(Math.random() * 30);
await this.client.set(key, value, 'EX', ttlSeconds + jitter);
```

### 6. 三兄弟速记（面试标准答案）

| 问题 | 一句话 | 本章防线 |
|---|---|---|
| **穿透** | 查"不存在"的数据，缓存形同虚设 | 空值哨兵（布隆过滤器进阶） |
| **击穿** | "一个"热点 key 过期，并发回源 | 互斥重建（singleflight） |
| **雪崩** | "一堆"key 同时过期，集体回源 | TTL 随机抖动 |

### 7. 踩坑实录：依赖装错目录 → peer 解析失败 → 元数据静默丢失

本章实验中 PUT 更新"成功"（200）但字段没变，排查链：

1. `updatedAt` 变了但 `title` 没变 → 更新执行了，但 data 是空的 → `whitelist` 剥掉了 title；
2. 隔离测试 `PartialType` → 装饰器元数据全丢；
3. `ls node_modules/@nestjs` → **blog 项目里根本没有 mapped-types**；
4. 真相：P3 安装时命令跑在了**根目录**（cwd 没切到 blog），包装进了父目录；blog 通过 Node 向上查找“借”到了它，但 mapped-types 自己的 peer 依赖 `class-validator` 从它的位置（根目录）找不到 → **跳过元数据继承，静默产出一个裸类**。

**三条教训**：

1. `pnpm add` 前先确认 cwd（monorepo/多项目目录尤其）；
2. **peerDependencies 的解析位置陷阱**：包 A 找不到它的 peer 依赖时可能不会报错，而是降级成"静默不工作"（pnpm 的严格结构放大了这个问题）；
3. 症状（校验失效）离根因（装错目录）隔了四层——**排查时逐层验证假设，别在中间层猜**。

---

## 代码实现（已建好，全部实测 ✅）

- `docker-compose.yml`：加 Redis 7（`nest-blog-redis`，6379）
- `src/redis/`：`CacheService`（getJson/setJson/setNull/del + TTL 抖动）+ `RedisModule`（@Global）
- `articles.service.ts`：
  - `findOne`：Cache-Aside + 空值哨兵
  - `update` / `remove`：先更库（事务内）→ `.then` 里删缓存

自测：

```bash
docker compose up -d   # postgres + redis
pnpm start:dev
curl localhost:3000/articles/3   # 第一次 MISS，第二次 HIT（看控制台 [Cache] 日志）
curl localhost:3000/articles/9999 # 两次：第一次 MISS+404，第二次直接 404 无 MISS 日志
```

---

## 动手练习

1. **击穿防线实现**：给 `findOne` 加互斥重建——MISS 时先 `SET article:lock:{id} 1 NX EX 5` 抢锁，抢到的回源重建，没抢到的 `sleep 100ms` 后重读缓存（最多重试 3 次，超时回源）。用 `xargs -P` 并发压同一个【刚被删掉的】key，看数据库查询日志是不是只有 1 次。
2. **列表页缓存**：给 `GET /articles`（公开列表）加缓存（key 带分页参数）。然后发现问题：发新文章/改标题后列表缓存怎么失效？列出你的方案（提示：列表 key 的失效粒度比详情难——这就是"列表缓存难做"的原因）。
3. **概念题**：为什么是"删缓存"而不是"更新缓存"？为什么"先更库后删缓存"而不是反过来？
4. **概念题**：空值哨兵和布隆过滤器都防穿透，各自的适用规模是什么？
5. **概念题**：如果业务要求"文章详情必须实时"（比如股价页），缓存还能用吗？怎么用？

---

## 练习参考答案

**练习 1**：完整实现与六层防御解析已并入第 4 节（互斥重建已落地在 `articles.service.ts` 的 `findOne`）。核心四步：`SET NX EX` 抢锁 → 双检 → finally 释放 → 等待重读 + 兜底回源。

**练习 2（版本号 key 方案，已实测落地）**：核心三件套——

```typescript
private readonly LIST_VERSION_KEY = 'articles:list:version';

// 读：key 里带当前版本号
const version = (await this.cache.getJson<number>(this.LIST_VERSION_KEY)) ?? 0;
const key = `articles:list:v${version}`; // 走 Cache-Aside

// 写：create/update/remove 三处数据变更，只做一件事
await this.cache.client.incr(this.LIST_VERSION_KEY);
```

**三个踩坑点（全部实测踩过）**：

1. **版本号必须存 Redis，不能存进程内存**——进程重启归零（旧缓存复活）、多实例各自计数（缓存错乱）。版本号 key 方案的全部意义就是版本号是全局共享、持久的状态；
2. **数据变更时只 INCR，不要主动写列表缓存**——把单篇文章塞进列表 key 会得到"数组期待收到对象"的脏数据；INCR 后旧 key 自然作废，列表由下一个读请求懒重建；
3. **INCR 是 Redis 服务端单命令自增**（并发安全，和 P4 的 `increment` 同理），key 名不变、值单调递增；列表 key 是"版本值的快照"，计数器一动旧快照集体作废。

**练习 3**：① 删优于更新：缓存值常是多源拼装（作者、标签、计数），重新组装成本高且容易算错；删掉后按需重建，永远以库为准，逻辑简单可靠。② 顺序：先删缓存再更库有"回填旧值"的时序窗口（见第 2 节时间线）；先更库后删缓存的最坏情况只是"删失败，脏一个 TTL 周期"——两害相权取其轻，再加 TTL 兜底。

**练习 4**：哨兵防"**已知的少量**恶意 key"（每个不存在的 id 占一个短 TTL 缓存位，可控）；布隆过滤器防"**海量随机**不存在的 key"（比如扫号攻击，id 完全随机，哨兵根本缓存不过来）——布隆用极小内存（约 1 亿 key 只需十几 MB）在入口直接拦掉"肯定不存在"的请求。代价：布隆有误判率（说不存在的其实存在，需设计兜底）且不支持删除（需定期重建）。

**练习 5**：能，但形态不同——**极短 TTL（1~5 秒）**。它的目标不是"数据最新"，而是"**把突发流量挡在数据库外**"：1 秒内 1 万次请求只回源一次。这叫"用极短的陈旧换系统的存活"。股价/秒杀库存这类场景的真实方案往往就是"短 TTL 缓存 + 最终一致"，而不是完全不用缓存硬扛。

（练习 1 验证标准：并发压刚删的 key，Prisma 查询日志只有 1 条 SELECT；练习 2 的思考标准：能说出"列表 key 无法在数据变更时精确失效，只能整体失效或用版本号 key"这层矛盾。）

---

## 自检清单

- [ ] 能手画 Cache-Aside 的读写流程
- [ ] 能解释"先更库后删缓存"的时序理由
- [ ] 穿透/击穿/雪崩三连问各有实操答案
- [ ] 理解 TTL 抖动防雪崩的原理
- [ ] 能复述 mapped-types 踩坑的排查链（peer 解析 + 静默降级）
- [ ] 自测 MISS/HIT/哨兵/失效四种日志都亲眼见过

---

## 下阶段预告

**P6 · 可靠性与并发**：点赞防重（幂等）、接口限流、异步任务队列。思维主题：**幂等与并发控制**——用户双击、网络重试、前端重复提交，同一请求到达两次是常态而不是异常，接口必须"来几次都一样"。
