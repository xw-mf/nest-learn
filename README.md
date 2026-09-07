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

## 阶段二：博客 CMS 实战项目（待开始）

```
阶段 3  Prisma 数据层：模型设计、关系、迁移
阶段 4  认证授权：JWT、Refresh Token、RBAC（复用 08 章守卫体系）
阶段 5  工程化能力：配置管理、Swagger、上传、Redis 缓存、分页
阶段 6  测试：Service 单测 + API e2e（项目用 Vitest）
阶段 7  上线：Docker 化、部署
```

## 关键原则

1. 所有知识点先实测验证再落盘（官方文档在 v12 有若干过时/错误描述，均已勘误）
2. 概念配前端类比（学习者背景：前端工程师）
3. 练习留白，概念题附参考答案
