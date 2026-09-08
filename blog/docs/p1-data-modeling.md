# P1 · 数据建模：后端思维第一课——持久化

> 项目：blog（Nest v12 + ESM + Prisma 7 + PostgreSQL@Docker）
> 本章目标：完成博客的数据模型设计并落地到数据库，建立"持久化思维"。
> ⚠️ 全链路已实测：Docker PostgreSQL → Prisma migrate → Client 读写（`scripts/smoke.ts` 可重跑）。
> 💡 前端类比：schema 设计 ≈ 给全局 store 设计 state 结构——但有一个残酷差异：**state 可以随便重构，数据库里的数据不能丢**。

---

## 本章的后端思维主题：持久化思维

前端的世界里，状态是"易失"的——刷新页面，Pinia 里的东西全没了，重新拉就是。所以前端对"数据结构设计错了"的容忍度很高：改一版代码，用户刷新即修复。

后端相反：**数据比代码长寿**。进程重启、代码重构、框架换代，数据库里的数据都必须还在、还得能读。这决定了后端的一系列思维方式：

1. **改结构要有迁移（migration）**，不能手改——数据库也要"版本控制"；
2. **删除要三思**——所以流行"软删除"（标记删除而非物理删行）；
3. **设计时要想查询**——表结构是为查询模式服务的，不是为"看起来整齐"服务的。

---

## 知识点释义

### 1. 关系建模：1:N 与 N:M

博客的实体关系：

```text
User 1───N Article      一个作者多篇文章
User 1───N Comment      一个用户多条评论
Article 1───N Comment   一篇文章多条评论
Article N───M Tag       文章和标签互相关联（需要中间表）
```

N:M 在关系型数据库里**无法直接表达**，必须拆成两张 1:N + 一张中间表。Prisma 的隐式写法 `tags Tag[]` 会自动生成中间表——实测迁移后数据库里出现了 `_ArticleToTag` 表（自己 `docker exec` 进去 `\dt` 可见）。

### 2. 范式 vs 反范式：`viewCount` 的取舍

**范式化**的严格做法是：浏览量 = 浏览记录表的 `COUNT(*)`。每次读取都聚合，数据永远一致，但**每次查询都要扫一堆行**。

**反范式**：在 `Article` 表上直接放一个 `viewCount` 字段，浏览一次 `+1`。读的时候 O(1)，但引入了**不一致风险**——如果加浏览量和别的写操作不是原子的，数据就"对不上账"。

```prisma
viewCount  Int  @default(0) // 反范式计数字段：用一致性换读性能
```

**思维点**：这不是"对错"问题，是"权衡"问题。判断依据：读多写少（博客首页疯狂读、浏览量允许短暂不准）→ 反范式划算。钱（账户余额）→ 绝不反范式。P4 会讲怎么用**事务**把不一致的窗口关到最小。

### 3. 软删除：`deletedAt`

```prisma
deletedAt DateTime? // null = 活着，有时间戳 = 已删除
```

前端思维是"删了就删了"；后端思维是"**数据一旦物理删除就永远消失**"——误删无法恢复、审计无据可查、关联数据变孤儿。软删除用"标记"代替"删除"，查询时统一过滤 `deletedAt: null`。代价：所有查询都要记得带过滤条件（P4 会用 Prisma 的扩展机制统一处理）。

### 4. 索引：为什么加 `@@index` 就能快

```prisma
@@index([authorId])            // "某作者的文章列表" 高频
@@index([published, createdAt]) // 首页："已发布 + 按时间倒序"
```

前端类比：没有索引的查询 ≈ **在数组里 `find`**（逐行扫描，全表扫描）；有索引 ≈ **在 Map 里 `get`**（B-tree，直接定位）。区别在数据量大了之后是毫秒 vs 秒。

**后端思维**：索引不是"性能优化技巧"，是**数据模型的一部分**——设计表的时候就要回答"这张表会被怎么查"。代价是写入变慢（每次写都要维护索引），所以索引也不是越多越好。

### 5. 迁移：数据库的版本控制

```bash
npx prisma migrate dev --name init
```

实测产出：`prisma/migrations/20260907073425_init/migration.sql`——一份**可重复执行、可审查、可回滚**的 SQL 文件，进 git。这就是后端对"改表结构"的纪律：永远通过迁移文件，永不在生产库上手敲 `ALTER TABLE`。

前端类比：`package-lock.json` 锁定依赖版本 ≈ migrations 锁定数据结构版本——让"任何环境重建出同样的状态"成为可能。

### 6. Prisma 7 的新形态（和老教程都不一样）

本章实测踩出的 Prisma 7 要点：

| 变化 | 说明 |
|---|---|
| 配置文件 | `prisma7.config.ts`（不再是 package.json 里的 prisma 字段），datasource 的 url 在这里接环境变量 |
| 生成器 | `prisma-client`（新），生成到自定义目录 `src/generated/prisma` |
| 驱动适配器 | Client 不再内置 Rust 引擎直连，需要适配器：`new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` |
| ESM | 生成物是 TS 文件、内部 import 带 `.js` 后缀——跑脚本用 `tsx`，别用 `node --experimental-strip-types`（不解析生成物内部的 .js 引用） |

### 7. 踩坑实录：localhost 的 5432 到底连的是谁（实测）

第一次 migrate 报 `P1010: User was denied access`。排查链：

1. 容器内 `psql` 直连 → 正常，用户是超级用户 → 排除权限问题
2. 容器日志没有任何拒绝记录 → **连接根本没到过 Docker 容器**
3. `lsof -iTCP:5432` → 宿主机 Homebrew 装的 PostgreSQL 占着 `127.0.0.1:5432` 和 `[::1]:5432`，Docker 映射的是 `*:5432`，`localhost` 优先解析到 `::1` → **连到了宿主机那个没有 blog 用户的库**

修复：Docker 端口映射改成 `5433:5432`，`DATABASE_URL` 同步改。**通用教训：端口冲突时，你以为连的和你实际连的可能不是同一个东西——先用日志证明连接到达了哪里。**

### 8. Prisma 的日常开发循环（流程总结）

**核心心智：`prisma/schema.prisma` 是数据层的单一事实来源（SSOT）**。模型、关系、索引都只在 schema 里改，数据库结构和 TS 类型都由它派生——永远反方向不动手。

```text
日常循环（改结构时）：

① 编辑 schema.prisma（加模型/字段/索引）
        ↓
② npx prisma migrate dev --name <描述>
   （生成迁移 SQL + 应用到开发库 + 自动重新生成 Client，一步到位）
        ↓
③ 代码里立刻获得新类型（prisma.category.findMany() 直接可补全）
```

**命令速查表**：

| 命令 | 用途 | 时机 |
|---|---|---|
| `prisma init` | 生成 schema/config/.env 骨架 | 新项目一次 |
| `prisma migrate dev --name xxx` | 生成并应用迁移（开发） | 每次改 schema |
| `prisma migrate deploy` | 应用已有迁移（不生成新的） | 生产/CI 部署 |
| `prisma generate` | 只重新生成 Client | 极少手动用（migrate dev 已包含） |
| `prisma db push` | 直接把 schema 推给数据库，**不产生迁移文件** | 原型期尝鲜，正式项目别用 |
| `prisma studio` | 起一个可视化的数据库浏览界面 | 开发期看数据 |

**关键规则**：

1. **版本对齐**：`prisma`（CLI）和 `@prisma/client` 必须同版本（本项目都锁 `7.10.0`）。裸跑 `npx prisma` 会去拉最新 RC 版，混用必出怪问题——永远用项目内的 `npx prisma`（node_modules 里的那份）；
2. **引入路径由生成器决定**：Prisma 7 的 `prisma-client` 生成器把 TS 源码生成到项目里（`output` 指定的目录），所以从 `src/generated/prisma/client.js` 引入；旧项目（如你的 Nest 10 项目）用老生成器 `prisma-client-js`，生成物塞进 node_modules，所以从 `@prisma/client` 引入——**差异来自生成器，不是 Nest 版本**；
3. **生成物进不进 git**：惯例是**不进**（`.gitignore` 掉 `src/generated/`），任何环境 `pnpm install` 后跑一次 `prisma generate` 即可重建——和 `node_modules` 同待遇。

---

## 代码实现

已建好并验证 ✅：

- `docker-compose.yml`——PostgreSQL 17（注意端口是 **5433**，避开宿主机占用）
- `prisma/schema.prisma`——User / Article / Tag / Comment 四张表 + Role 枚举
- `prisma7.config.ts` + `.env`——连接配置
- `scripts/smoke.ts`——冒烟脚本（创建用户+文章+标签级联写入，查询已发布文章），`npx tsx scripts/smoke.ts` 可重跑

**你动手：把 Prisma 接进 Nest 的 DI 体系**（03/04 章知识的实战应用）：

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }
  async onModuleInit() { await this.$connect(); }     // 启动时连
  async onModuleDestroy() { await this.$disconnect(); } // 关闭时断
}
```

```typescript
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global() // 数据层是全应用的基础设施（04 章：少数合理的全局模块之一）
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

注册进 `AppModule` 的 imports。验证：`pnpm start:dev` 启动无报错即连通（生命周期钩子在装配期执行）。

---

## 动手练习

1. **写出迁移 SQL 的对应关系**：打开 `prisma/migrations/*/migration.sql`，找到 `_ArticleToTag` 的建表语句，理解隐式 N:M 中间表的真实结构（两个外键 + 唯一约束）。
2. **加模型**：给博客加 `Category`（分类）模型——一篇文章只能属于一个分类（1:N），一个分类有多篇文章。改 schema → `migrate dev --name add-category` → 观察新的迁移文件。**注意体会：这次迁移和 init 的关系是什么？（增量）**
3. **索引实验**：在 `User.email` 上已经有 `@unique`（自带索引）。用 `\di` 命令（docker exec 进 psql）查看所有索引，找出每个索引分别是被哪条 schema 规则创造出来的。
4. **概念题**：为什么"博客文章的浏览量"适合反范式（viewCount 字段），而"用户余额"绝对不适合？
5. **概念题**：如果不用迁移工具，直接在生产数据库上手改表，会埋下什么雷？（至少说出两个）

---

## 练习参考答案

**练习 4**：核心差异是**不一致的代价**。浏览量错几个，没有任何人受损（容忍度高），而它的读频率极高（每篇文章展示都读）——用一致性换读性能划算。余额错一分钱都是资损事故（容忍度为零），必须永远精确——宁可每次算/用事务保护，也绝不接受"大概对"。判断框架：**"错了会怎样" + "读的频率有多高"**。

**练习 5**：① **不可重复/不可回滚**：手改的表没有记录，新环境（测试库、新同事、灾备重建）无法重建出同样结构，出问题也无法精确回到改之前；② **代码与库结构失联**：应用代码期望的 schema 和实际 schema 产生偏差时，错误会以各种诡异的形式在运行时才暴露；③ 多人协作时无人能 review 这次变更。迁移工具把"改结构"变成了有版本、有审查、可回滚的工程行为。

（练习 2 验证标准：迁移后 `\dt` 能看到 Category 表且 Article 表多出 `categoryId` 列——想想 Prisma 对已存在数据的表加非空外键会怎么处理？这是下一题的引子，做的时候观察。）

---

## 自检清单

- [ ] 能画出博客的 ER 关系（1:N / N:M）并解释 N:M 为什么需要中间表
- [ ] 能解释范式/反范式的权衡框架（错了会怎样 + 读多还是写多）
- [ ] 理解软删除的动机和代价
- [ ] 理解索引 ≈ Map.get vs 全表扫描 ≈ Array.find
- [ ] 理解迁移 = 数据库的版本控制
- [ ] PrismaService 接入完成，`pnpm start:dev` 无报错
- [ ] 能复述 5432 端口冲突的排查思路（先证明连接到了哪）

---

## 下阶段预告

**P2 · 认证体系**：注册/登录/JWT。思维主题：**信任边界——客户端不可信**。密码为什么必须哈希加盐、JWT 为什么是"签名而非加密"、双 token（Access + Refresh）解决什么问题。会大量复用基础篇的 Guard/`@Public()`/`@User()` 体系。
