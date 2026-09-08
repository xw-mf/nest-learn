# Nest.js 学习路线

> 学习方式：每章 = 官方文档 + 本项目实测验证 + 动手练习。所有结论以实测为准（含多处官方文档勘误）。

## 阶段一：官方文档基础篇（base/ 项目）

| 章 | 文档 | 主题 | 状态 |
|---|---|---|---|
| 01 | [first-steps](base/docs/01-first-steps.md) | 项目结构与启动原理 | ✅ |
| 02 | [controllers](base/docs/02-controllers.md) | 请求输入/输出工具箱 | ✅ |
| 03 | [providers](base/docs/03-providers.md) | DI 容器、自定义 Provider | ✅ |
| 04 | [modules](base/docs/04-modules.md) | 封装边界、动态模块 | ✅ |
| 05 | [middleware](base/docs/05-middleware.md) | 请求生命周期第一站 | ✅ |
| 06 | [exception-filters](base/docs/06-exception-filters.md) | 异常层、统一错误格式 | ✅ |
| 07 | [pipes](base/docs/07-pipes.md) | 校验与转换 | ✅ |
| 08 | [guards](base/docs/08-guards.md) | 鉴权、ExecutionContext | ✅ |
| 09 | [interceptors](base/docs/09-interceptors.md) | RxJS 响应流包装 | ✅ |
| 10 | [custom-decorators](base/docs/10-custom-decorators.md) | 元编程收官 | ✅ |

**核心资产**：请求生命周期全图（中间件→守卫→拦截器→管道→控制器→过滤器）、DI 容器（四种自定义 Provider）、模块封装与动态模块、声明式鉴权体系。

## 阶段二：博客 CMS 实战项目（blog/ 项目，Nest v12 + Prisma 7 + PostgreSQL）

> 主线：**后端思维转变**（前端 → 后端），每阶段一个思维主题 + 一块真实功能。

| 阶段 | 文档 | 思维主题 | 状态 |
|---|---|---|---|
| P1 | [数据建模](blog/docs/p1-data-modeling.md) | 持久化思维：关系设计、范式取舍、迁移 | ✅ 数据库已通 |
| P2 | 认证体系（JWT 双 token） | 信任边界：客户端不可信 | ⬜ |
| P3 | 授权体系（RBAC + 资源归属） | 越权思维：横向/纵向越权 | ⬜ |
| P4 | 核心业务（文章/评论/标签） | 一致性思维：事务、N+1 | ⬜ |
| P5 | 缓存性能（Redis） | 缓存思维：穿透/击穿/雪崩 | ⬜ |
| P6 | 可靠性（幂等/限流/异步） | 并发思维 | ⬜ |
| P7 | 上线（日志/Swagger/Docker） | 运维思维 | ⬜ |

## 关键原则

1. 所有知识点先实测验证再落盘（官方文档在 v12 有若干过时/错误描述，均已勘误）
2. 概念配前端类比（学习者背景：前端工程师）
3. 练习留白，概念题附参考答案
