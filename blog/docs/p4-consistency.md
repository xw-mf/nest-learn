# P4 · 核心业务与一致性：并发下的正确性

> 项目：blog（Nest v12 + Prisma 7）
> 本章目标：掌握事务、原子操作、N+1 查询优化，建立"一致性思维"。
> ⚠️ 三个硬实验全部实测：嵌套写入原子性 ✅、并发丢更新（50 并发丢 13 次）✅、N+1（4 次 vs 2 次查询）✅。
> 💡 前端类比：并发写冲突 ≈ 两个浏览器标签页同时编辑同一篇文档；N+1 ≈ 列表页每个 item 单独发一次请求（瀑布）vs 一次批量请求。

---

## 本章的后端思维主题：一致性思维

前端处理"状态一致性"靠的是框架的响应式保证（store 更新 → 视图自动同步），单一客户端、单线程，你几乎不用想并发。

后端不同：**同一个数据同时被很多请求读写**。"发文章"涉及文章行 + 标签行 + 中间表行，任何一个环节失败，数据就破了相。一致性思维就是回答：**如何让"一组操作"在多并发下依然保持整体正确？** 工具箱：事务、原子操作、唯一约束、锁。

---

## 知识点释义

### 1. 事务：一组操作"要么全成，要么全不成"（实测 ✅）

**场景**：发文章带标签——文章行、新标签行、中间表关联行，任何一步失败都不能留半截。

**Prisma 的两层事务**：

**① 嵌套写入自带事务（零成本）**：单个 `create/update` 里的嵌套写自动包在一个事务里：

```typescript
prisma.article.create({
  data: {
    title, content, authorId,
    tags: {
      connectOrCreate: tags.map((name) => ({
        where: { name },      // 存在就连上
        create: { name },     // 不存在就顺手建
      })),
    },
  },
});
```

实测 ✅：发文章带 `["nestjs", "web"]`——`nestjs` 复用已有标签（connect），`web` 自动新建（create），中间表自动填充，一次请求完成。

**② 显式事务（跨多个独立操作时）**：改文章的标签（先清空旧标签 → 再挂新标签）是两步独立操作，必须显式包事务：

```typescript
return this.prisma.$transaction(async (tx) => {
  await tx.article.update({ where: { id }, data: { tags: { set: [] } } }); // 先断开
  return tx.article.update({ where: { id }, data: { ...tags: { connectOrCreate: ... } } }); // 再挂上
  // 中途抛错 → 整体回滚，不会留下"标签被清空"的烂摊子
});
```

**何时需要事务的判断标准**：一个业务动作涉及**多行写入**，且"只写了一半"是非法状态 → 需要事务。单一行写入不需要。

> ACID 速记：Atomicity（原子性，全成或全不成）、Consistency（约束不被破坏）、Isolation（并发互不干扰）、Durability（提交后不丢）。事务主要给你 A 和 I。

### 2. 并发丢更新：读-改-写的陷阱（实测：50 并发丢 13 次）

朴素写法：

```typescript
// ❌ 读-改-写分离，并发下丢更新
const article = await prisma.article.findUnique({ where: { id } });
await prisma.article.update({ where: { id }, data: { viewCount: article.viewCount + 1 } });
```

两个并发请求的时间线：

```text
请求A：读 viewCount=10
请求B：读 viewCount=10  ← A 还没写回去，B 读到旧值
请求A：写 viewCount=11
请求B：写 viewCount=11  ← B 把 A 的 +1 覆盖了！丢了 1 次
```

**实测数据**：同一篇文章 50 个并发请求，朴素版最终只有 **37**（丢了 13 次），原子版精确 **50**。

修复——**把"读-改-写"压成一条原子 SQL**：

```typescript
// ✅ 翻译成 UPDATE "Article" SET "viewCount" = "viewCount" + 1 WHERE id = ...
prisma.article.update({ where: { id }, data: { viewCount: { increment: 1 } } });
```

数据库在单行内串行执行，不存在"读到旧值"的窗口。**规则：计数器、库存、余额这类"在旧值基础上变化"的更新，永远用原子操作（`increment`/`decrement`），不读出来算完再写回。**

### 3. N+1 查询（实测：4 次 vs 2 次）

症状：文章列表要显示作者昵称。

```typescript
// ❌ N+1：1 次查文章 + N 次查作者（N = 文章数）
const articles = await prisma.article.findMany();
for (const a of articles) {
  a.author = await prisma.user.findUnique({ where: { id: a.authorId } }); // 每篇一次！
}
```

实测：库里 3 篇文章 → **4 次查询**（1 + 3）。100 篇就是 101 次。

```typescript
// ✅ include：Prisma 批量解决
prisma.article.findMany({ include: { author: true } });
```

实测：**2 次查询**（1 次查文章 + 1 次 `WHERE id IN (...)` 批量查作者），与文章数无关。

**怎么发现 N+1**：开启查询日志 `new PrismaClient({ log: ['query'] })`，盯一个接口的 SQL 条数——条数随列表长度增长就是 N+1。（生产关掉，学习/排障期打开。）

> 冷知识：Prisma 的 `include` 不是 SQL JOIN，而是"分次查询 + 内存拼装"（这也是它 2 次查询的来源）。JOIN 不一定更快（笛卡尔积放大），Prisma 的策略在大多数场景是合理的。

### 4. 本章三个知识点的一以贯之

事务、原子自增、N+1 看似不相关，其实是同一个主题的三个面：**把"正确性/性能"交给数据库的原语，而不是应用层的祈祷**。应用层拼装的"先读后写"在并发下不可靠，数据库的原语（事务、原子 UPDATE、批量 IN）才是可信的。

---

## 代码实现（已建好，全部实测 ✅）

- `articles.service.ts`
  - `create`：嵌套写入 `connectOrCreate` 标签（自动事务）
  - `update`：交互式 `$transaction` 全量替换标签
  - `viewAtomic` / `viewNaive`：并发对照实验
  - `listN1Naive` / `listN1Include`：N+1 对照实验（`GET /articles/n1/naive` 与 `/n1/include`）
- DTO 加了 `tags?: string[]`（`@IsString({ each: true })`）

自测：

```bash
# 并发实验（xargs -P 模拟并发）
seq 1 50 | xargs -P 10 -I{} curl -s -o /dev/null -X POST localhost:3000/articles/4/view-atomic
# 然后 DBeaver 或 psql 看 viewCount 是否正好 +50；换 view-naive 对比

# N+1 实验：先在 PrismaService 开 log: ['query']，对比两个端点的 SQL 条数
```

---

## 动手练习

1. **发布流程事务化**：给文章加"发布"动作（`POST /articles/:id/publish`）——要求：更新 `published: true` + 记录一条"发布日志"（新加一张 `PublishLog` 表：articleId + publishedAt）。用交互式事务实现，并故意在第二步抛错，验证第一步被回滚。
2. **评论计数器**：给 `Article` 加 `commentCount Int @default(0)` 字段，评论增删时用**事务 + increment/decrement** 维护（加评论：创建评论 + 文章计数 +1，一个事务）。迁移、实现、用并发实验验证（20 并发加评论，计数应正好 20）。
3. **概念题**：为什么 `increment` 是原子安全的，而"读出来 +1 写回去"不是？数据库层面分别发生了什么？
4. **概念题**：事务能防止"丢更新"吗？（提示：事务的隔离级别 vs 原子操作是两种不同机制——`SELECT ... FOR UPDATE` 行锁才可以，默认的 READ COMMITTED 隔离级别下事务内的读-改-写照样丢更新）
5. **概念题**：N+1 只有在数据量大时才是问题吗？（提示：延迟、连接池占用）

---

## 练习参考答案

**练习 3**：`increment` 翻译成单条 `UPDATE ... SET viewCount = viewCount + 1`——数据库在**行锁保护下**完成"读当前值、加一、写回"全过程，其他事务对这行的更新要排队，不存在中间窗口。而读-改-写是**两条独立 SQL**：第一个事务读完、锁已释放，第二个事务读到同样的旧值，两个事务都按自己的旧值写回——后写覆盖先写。关键差异：**"读"和"写"是否在同一把锁的保护下**。

**练习 4**：默认隔离级别（READ COMMITTED）下**不能**——事务内读到的还是旧值，两个并发事务照样互相覆盖（事务保证的是"一组操作的原子性"，不是"读到的值最新"）。事务内防丢更新需要 `SELECT ... FOR UPDATE`（行锁，把"读"变成带锁的读）或 SERIALIZABLE 隔离级别。但对计数器场景，**原子 `increment` 永远是更优解**——锁的粒度最小、无死锁风险、性能最好。选型口诀：能用原子操作就不用锁，能用锁就不用串行化。

**练习 5**：不是。即使只有 3 条数据，N+1 的代价也在：① **延迟叠加**——每次查询一次网络往返，N 次就是 N 个 RTT（数据库跨机房时尤其明显）；② **连接池占用**——每个查询占用连接，高并发时连接池被打爆，其他请求排队。N+1 是"模式错误"，数据量只是放大器。

（练习 1 验证标准：故意抛错后 `PublishLog` 和文章的 `published` 都没变；练习 2 验证标准：20 并发后 `commentCount` = 20 且评论数 = 20。）

---

## 自检清单

- [ ] 能说出"何时需要事务"的判断标准（多行写入 + 中间态非法）
- [ ] 理解嵌套写入自带事务 vs 显式 $transaction 的边界
- [ ] 能画"丢更新"的并发时间线，并说出修复手段（原子操作/行锁/串行化）及优先级
- [ ] 会用查询日志发现 N+1
- [ ] 理解 include 的"分次查询+内存拼装"策略
- [ ] 两个并发实验亲手跑过（原子 50/50，朴素 37/50）

---

## 下阶段预告

**P5 · 缓存与性能**：热点文章进 Redis。思维主题：**缓存思维**——缓存和数据库的一致性怎么保（先更库还是先删缓存）、缓存穿透/击穿/雪崩三兄弟各防什么。面试缓存三连问，到时候你全有实操答案。
