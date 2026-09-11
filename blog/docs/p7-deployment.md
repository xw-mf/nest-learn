# P7 · 上线：运维思维——环境分离与不可变产物

> 项目：blog（Nest v12 + Docker Compose 全栈编排）
> 本章目标：把博客打包成 Docker 镜像并全栈跑起来（app + PostgreSQL + Redis），建立运维思维。
> 💡 前端类比：前端的"上线"是 build 出静态文件扔 CDN；后端的上线是**带着状态依赖（DB/缓存/密钥）的可执行环境**——复杂性不在打包，在环境。

---

## 本章的后端思维主题：运维思维

前端的产物是静态文件，扔到任何 CDN 都一样跑。后端服务是"活"的：要连数据库、要密钥、要能被监控、挂了要能被拉起。运维思维的四条主线：

1. **环境分离**：代码不变，配置外置——同一个镜像跑开发/测试/生产，差异全在环境变量；
2. **不可变产物**：构建一次镜像，到处运行——杜绝"我机器上能跑"；
3. **可观测**：健康检查、日志——系统必须能"说出"自己的状态；
4. **生命周期管理**：启动时迁移、崩溃自动重启、优雅关闭。

---

## 知识点释义

### 1. Docker 多阶段构建（本项目的 Dockerfile）

```dockerfile
FROM node:22-alpine AS builder   # 阶段一：编译（需要全部 devDependencies）
RUN pnpm install --frozen-lockfile
RUN npx prisma generate && pnpm build   # generate 显式跑（CI 纪律）

FROM node:22-alpine AS runner    # 阶段二：运行（只要运行必需的）
COPY --from=builder /app/dist ./dist
# ...
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

**为什么多阶段**：builder 阶段的 TypeScript、vitest、源码全部不进最终镜像——镜像更小、攻击面更小、启动更快。

**启动命令的深意**：`migrate deploy && node dist/main.js`——**先迁移再启动**（P1 的迁移纪律在部署链路上兑现：用 `deploy` 只应用已有迁移，绝不生成新的）。

### 2. 容器网络：localhost 不再是 localhost（实测相关）

容器里每个服务有自己的网络命名空间——app 容器里的 `localhost:5432` 是**它自己**，不是数据库。Compose 网络里用**服务名互联**：

```yaml
# app 服务的环境变量
DATABASE_URL: postgresql://blog:blog123@postgres:5432/blog  # postgres = 服务名
REDIS_URL: redis://redis:6379                               # redis = 服务名
```

对照 P1 的端口冲突坑：那是"宿主机的 localhost 到底是谁"，这是"容器里的 localhost 是谁"——**先搞清楚网络边界，再谈连不连得上**。

### 3. 环境分离：配置外置

```text
本地开发：.env 文件（dotenv 加载）
容器编排：docker-compose 的 environment 段
生产：K8s Secret / 密钥管理服务（Vault、云厂商 Secrets Manager）
```

**代码一行不改，三层环境三种注入方式**。判别标准：把一个值"改"到另一个环境需要重新构建镜像吗？需要 = 配置没外置。

⚠️ 注意优先级：compose 的 `environment` 会覆盖容器内 `.env` 的值（镜像里本来就不该带 `.env`——`.dockerignore` 排不掉的话要在 Dockerfile 层面注意，密钥文件永远不进镜像）。

### 4. 健康检查：让系统能"说出"自己的状态

```typescript
@Public() // 关键：LB/编排系统没有 token，健康检查必须免登录
@Get('health')
async check() {
  // 真实探活依赖：数据库 SELECT 1 + Redis PING
  return { status: 'ok', database: 'up', redis: 'up' };
}
```

**两个等级**：liveness（进程活着吗——挂了重启）vs readiness（能接流量吗——依赖没好先别导流）。我们的 `/health` 做的是 readiness 雏形（探依赖）。K8s/云 LB 靠这类端点做流量切换——没有它，发版时用户就会打到"还没连上数据库"的实例上。

### 5. Swagger：API 文档是自给的

`@nestjs/swagger` 在 `/docs` 起文档站（`addBearerAuth()` 支持文档里带 token 调试）。DTO 上的校验装饰器会自动变成文档里的字段约束——07 章"DTO 用 class"的红利之一。

### 6. 优雅关闭（了解）

Nest 的 `app.enableShutdownHooks()` + 各模块的 `OnModuleDestroy`（我们的 `PrismaService.$disconnect`、`CacheService.quit` 都挂了）——收到 SIGTERM（K8s 滚动更新时）先停收新请求、收尾旧请求、断开连接再退出。不加这个，滚动更新会掐断进行中的请求。

### 7. 踩坑实录：@nestjs/mau 引发的类型双实例

Swagger 接入时报"INestApplication 类型不兼容"，根因：脚手架自带的 `@nestjs/mau`（部署 CLI，我们没用）没有声明 `class-validator` 等 peer 依赖 → pnpm 为它单独存了一份"bare"变体的 `@nestjs/common` → **两个物理副本的类型互不兼容**（`unique symbol` 名义类型）。

修复：`pnpm remove @nestjs/mau`（顺手清理）。教训同 P5：**依赖树里出现同一包的两个物理实例时，类型系统会用最晦涩的报错提醒你**——看到 "类型 X 不能赋给类型 X（同名）"时，先查 `ls node_modules/.pnpm | grep 包名` 是不是有多个变体。

### 8. 踩坑实录：corepack 的 pnpm 版本漂移

镜像第一次构建成功、后来却莫名失败在 `pnpm install --frozen-lockfile`。根因：`package.json` 没有 `packageManager` 字段 → 容器里 corepack 拉**最新版** pnpm，与本地 10.32.1 生成的 lockfile 格式不兼容。

修复（双锁死）：

```json
// package.json
"packageManager": "pnpm@10.32.1"
```

**教训：可重复构建要求"工具链版本"也进版本控制**——语言版本（node:22-alpine 的 tag）、包管理器版本（packageManager）、依赖版本（lockfile）三层都要锁，缺一层就是"上次能 build 这次不能"的玄学故障。

---

## 代码实现（已建好）

- `Dockerfile`：多阶段构建（builder 编译 → runner 运行，启动前 migrate deploy）
- `.dockerignore`：node_modules/dist/generated/docs 不进镜像上下文
- `docker-compose.yml`：app + postgres + redis 三服务编排（depends_on 健康条件、服务名互联、宿主 3001 → 容器 3000）
- `src/health/`：健康检查（DB + Redis 探活）
- `main.ts`：Swagger 挂载 `/docs`

---

## 动手练习

1. **全栈起停**：`docker compose up -d --build`，验证：`localhost:3001/health`、`localhost:3001/docs`、注册/登录/发文章全链路走通（数据落在哪个库里？和本地开发的是同一个吗？观察卷的设计）。
2. **环境变量优先级实验**：compose 的 `environment` 里改 `PORT: 4000`（或不改），容器里 `docker exec nest-blog-app printenv PORT` 看实际生效值，理解"compose 环境 > 镜像内 .env > 代码默认值"的优先级链。
3. **故障演练**：`docker compose stop postgres`，访问 `/health` 看 `database: down`；`docker compose start postgres` 恢复。体会健康检查对运维的价值。
4. **概念题**：为什么启动命令是 `migrate deploy && node main.js` 而不是进了容器再手动迁移？（提示：不可变产物 + 启动纪律）
5. **概念题**：生产环境为什么不该用 `pnpm start:dev`（watch 模式）？容器里的 NODE_ENV=production 影响什么？

---

## 练习参考答案

**练习 4**：三个原因。① **不可变产物原则**：镜像 = 代码 + 依赖 + 迁移文件，启动行为也应该是确定的、自动的——"进容器手动操作"破坏了"同样的镜像同样的行为"；② **多实例**：水平扩展时同时起 N 个容器，不可能逐台手动迁移（migrate deploy 是幂等的，N 个实例并发执行也安全——数据库迁移表有锁）；③ **CI/CD 自动化**：发布流水线里没有人肉步骤，回滚/重建都全自动。

**练习 5**：watch 模式为开发设计——文件监听常驻、每次变更重新编译（内存翻倍）、错误处理宽松（崩了靠 nodemon 拉起）。生产的 `NODE_ENV=production` 影响：Express 关详细错误栈、模板缓存开启、多数库切到性能模式。**生产跑开发模式 = 性能打折 + 错误信息泄露 + 资源浪费**。

---

## 自检清单

- [ ] 能解释多阶段构建的收益（镜像大小/攻击面/启动速度）
- [ ] 理解容器网络的服务名互联（localhost 的边界）
- [ ] 理解配置外置的三层注入（.env / compose / secrets 管理）
- [ ] 理解健康检查的 liveness vs readiness 分工
- [ ] 理解启动纪律：migrate deploy → 再启动
- [ ] `docker compose up` 全栈跑通，练习 1-3 完成

---

## 完结

至此博客 CMS 拥有完整的生产形态：可构建的镜像、可编排的依赖、可观测的健康检查、可读的 API 文档。**从 01 章的 Hello World 到这里，你走完了一个后端服务的完整生命周期**——剩下的路（真实云部署、CI/CD、监控告警）都是这套骨架上的延伸。
