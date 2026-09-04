# 04 · Modules：封装边界与可见性规则

> 对应官方文档：[Modules](https://docs.nestjs.com/modules) + [Dynamic modules](https://docs.nestjs.com/fundamentals/dynamic-modules)
> 本章目标：理解模块的真正职责——**封装边界**，掌握 `exports`/`imports` 可见性规则、模块再导出、全局模块、动态模块。
> ⚠️ 本章所有行为结论均在 **Nest v12 + ESM** 环境下实测验证（实验代码：`src/consumer/`、`src/env/`，配合 `src/lab/`）。

---

## 本阶段目标

- 理解模块 = 组织单位 + 封装边界，而不只是"文件分组"
- 掌握 Provider 的可见性规则：默认私有，`exports` 是模块的公共 API
- 理解"重复注册"和"导出共享"的本质区别（实测：实例数量不同）
- 掌握 `@Global()` 全局模块及其使用纪律
- 掌握动态模块：`register`/`forRoot` 模式与 options 注入

---

## 知识点释义

### 1. 模块是什么

每个 Nest 应用至少有一个根模块（`AppModule`），它是 Nest 构建**应用图（application graph）**的起点。`@Module()` 四个属性：

| 属性 | 职责 |
|---|---|
| `providers` | 本模块内可注入的 Provider |
| `controllers` | 本模块的控制器 |
| `imports` | 我依赖哪些模块（导出的东西） |
| `exports` | 我对外开放哪些 Provider（默认全部私有！） |

前三章你已经在用前三个属性，本章的关键是第四个。

### 2. 可见性规则：默认封装（实测验证 ✅）

**Provider 默认只在声明它的模块内可见。** 跨模块注入未导出的 Provider，启动直接失败。实测报错：

```text
UnknownDependenciesException: Nest can't resolve dependencies of the
ConsumerController (?). Please make sure that the argument LabService
at index [0] is available in the ConsumerModule module.
```

注意报错的措辞："available in the **ConsumerModule** module"——容器的查找范围就是模块边界。

开放方式：把 Provider 加进 `exports` 数组，消费方 `imports` 该模块：

```typescript
@Module({
  providers: [CatsService],
  exports: [CatsService], // 模块的"公共 API"
})
export class CatsModule {}
```

官方文档把 `exports` 称为模块的 **public interface**——这个心智模型很重要：写模块时先想"我要对外暴露什么"，其余的都应该是模块内部实现细节。

### 3. 导出共享 vs 重复注册（实测验证 ✅，本章最重要的实验）

想让另一个模块用上 `CatsService`，有两条路，**结果完全不同**：

**路径 A：导出 + 导入（正确姿势）**——全应用共享**同一个实例**：

```text
/api/lab instanceId:      844x80
/api/consumer instanceId: 844x80   ← 相同，跨模块单例
```

**路径 B：两个模块各自 `providers: [CatsService]`**——**各自 new 一个**：

```text
/api/lab instanceId:      dd2i45
/api/consumer instanceId: weetvp   ← 不同！两个独立实例
```

路径 B 的代价：内存翻倍 + **状态分裂**。想象 `CatsService` 里存着数据：A 模块写入的数据，B 模块永远看不到——这是真实项目里极难排查的 bug 类型。所以规则是：**一个能力，一个模块拥有，其他人 import**。

### 4. 模块再导出（re-export）

模块可以把**自己 import 的模块**再 export 出去，做聚合：

```typescript
@Module({
  imports: [CommonModule],
  exports: [CommonModule], // 导入 CoreModule 就等于同时导入了 CommonModule
})
export class CoreModule {}
```

用途：做一个"桶模块"（barrel module），把一组常用基础设施打包，消费方只需 import 一次。

### 5. 模块类自身也能注入（但不能被注入）

```typescript
@Module({ providers: [CatsService], exports: [CatsService] })
export class CatsModule {
  constructor(private catsService: CatsService) {} // ✅ 模块类可以注入 provider
}
```

用途：模块初始化时基于 Provider 做些配置。反过来不行——**模块类不能作为 Provider 注入到别处**（官方说明：会导致循环依赖）。

### 6. 全局模块 `@Global()`（实测验证 ✅）

有些能力到处都要用（配置、日志、数据库连接），每个模块都 import 一遍很烦。`@Global()` 让模块的导出**全局可见，免导入**：

```typescript
@Global()
@Module({
  providers: [CatsService],
  exports: [CatsService],
})
export class CatsModule {}
```

实测：`ConsumerModule` 不 import 任何东西，成功注入 `LabService`（`/api/consumer` 正常返回 instanceId）。

**使用纪律**（官方警告 + 工程共识）：

- 全局模块**只注册一次**（通常在根模块 import）；
- 不要滥用——`@Global()` 本质是在破坏第 2 节的封装边界，依赖关系从"显式 import 可见"变成"隐式全局可得"，模块越多越难追踪依赖来源。真实项目里通常只有 1-2 个全局模块（Config、Logger/DB）。

### 7. 动态模块：运行时可配置的模块（实测验证 ✅）

静态模块的问题：**消费方无法影响被导入模块的行为**。比如 Config 模块，你想告诉它".env 文件在哪个目录"——静态 import 做不到。

**原理深挖（源码级，已核对 `@nestjs/common` 实现）**：`@Module()` 装饰器的全部逻辑就是把配置对象逐个 `Reflect.defineMetadata` 贴到类上——**模块 = 一个类 + 一包元数据**。静态写法和动态写法的区别仅在于元数据的来源：

```text
静态：imports: [EnvModule]                → Nest 从类上读装饰器贴的元数据（写代码时写死）
动态：imports: [EnvModule.register({...})] → Nest 读函数返回的元数据包（运行时算出来）
```

`DynamicModule` 对象（`{ module, providers, exports, ... }`）和 `@Module()` 的配置对象结构完全一致，只多一个 `module` 属性指向模块类。**动态模块不是新物种，是把"写死元数据"变成"用函数算元数据"**——函数有参数，参数就是 options。

options 流进 Service 的桥，就是 03 章的 `useValue`：函数参数包成 Provider 进容器，Service 用 `@Inject()` 正常注入。所以动态模块 = **03 章自定义 Provider + 04 章模块元数据**的组合，零新概念。

**声明与执行的分离（关键认知）**：`register()` 只**生产配置单**，它自己不注册任何东西；`imports: [...]` 只是**提交配置单**（被 `@Module()` 贴进 ConsumerModule 的元数据）；真正的注册、合并、实例化全部发生在 **`NestFactory.create()` 的装配期**——扫描器遍历 imports，读到 DynamicModule 时取 `module` 属性找到目标类，把动态元数据与类的静态元数据合并，然后才实例化 Provider、解析依赖。你的代码全是"声明"，Nest 的装配器才是"执行者"。这也是为什么配置错误在**启动时**就报错而不是请求时：装配期图就建完了，fail fast。

**判断何时自己写动态模块**：写模块时问一句"消费方需要告诉我点什么吗？"——不需要（纯业务能力）用静态模块；需要（目录、连接串、开关、超时）用动态模块。

动态模块 = 模块类上的一个静态方法，返回 `DynamicModule` 对象（比静态模块多一个 `module` 属性）：

```typescript
// env/env.module.ts（本项目实验代码，已验证）
@Module({
  providers: [EnvService],   // 静态部分
  exports: [EnvService],
})
export class EnvModule {
  static register(options: EnvOptions): DynamicModule {
    return {
      module: EnvModule,
      providers: [{ provide: ENV_OPTIONS, useValue: options }], // 动态部分
      exports: [ENV_OPTIONS],
    };
  }
}
```

消费方：

```typescript
@Module({
  imports: [EnvModule.register({ prefix: 'from-dynamic-options' })],
})
export class ConsumerModule {}
```

实测验证了两个关键点：

1. **options 通过 DI 到达 Service**：`EnvService` 用 `@Inject(ENV_OPTIONS)` 拿到 `{ prefix: 'from-dynamic-options' }` ✅。机制就是 03 章的知识——options 被包成 `useValue` Provider 注册进容器。
2. **动态元数据是"扩展"而非"覆盖"**：`@Module()` 里静态声明的 `EnvService` 和 `register()` 动态生成的 `ENV_OPTIONS` **同时可用** ✅。

**命名约定**（社区规范，不是硬性规则）：

| 方法名 | 语义 | 例子 |
|---|---|---|
| `register` | 为调用方做特定配置，各模块可不同 | `HttpModule.register({ baseUrl })` |
| `forRoot` | 全应用只配置一次 | `TypeOrmModule.forRoot(...)` |
| `forFeature` | 复用 forRoot 的配置，做模块级微调 | `TypeOrmModule.forFeature([User])` |
| `*Async` 后缀 | 配置本身需要异步/依赖注入 | `forRootAsync({ useFactory, inject })` |

### 8. 踩坑实录：token 放错文件导致循环引用（实测）

实验 5 第一次失败了，报 `ReferenceError: Cannot access 'EnvService' before initialization`。原因：

```text
env.module.ts  ──import EnvService──→  env.service.ts
     ↑                                    │
     └────── import ENV_OPTIONS ──────────┘   ← 循环！
```

ESM 下循环引用会让先加载的一方拿到 TDZ（暂时性死区）中的绑定，直接运行时崩溃。解法也是官方最佳实践：**token 和接口定义抽到独立的 `*.constants.ts`**（本项目 `src/env/env.constants.ts`），它谁都不 import，循环自然断开。03 章说"token 集中定义在 constants.ts"是风格建议，这里证明了它还有实际功能。

### 9. `ConfigurableModuleBuilder`（了解即可）

手写动态模块（尤其 async 版）样板代码多，Nest 提供 `ConfigurableModuleBuilder` 几行生成 `register`/`registerAsync` 方法。官方 [@nestjs/config](https://docs.nestjs.com/fundamentals/dynamic-modules#configurable-module-builder) 就是用它实现的。学习阶段知道存在即可，到博客项目接配置模块时如需再展开。

---

## 代码实现

### A. 实验资产（已建好，已验证 ✅）

- `src/consumer/`：模块边界实验（无导出注入报错 → 导出共享 → 重复注册 → @Global）
- `src/env/`：动态模块实验（`EnvModule.register()` + options 注入 + constants.ts 拆分）

### B. cats 收编进 CatsModule（你已经完成 ✅）

你在练习中已经建了 `CatsModule`，确认最终形态：

```typescript
// cats/cats.module.ts
@Module({
  controllers: [CatsController],
  providers: [CatsService /*, CATS_STORAGE_LIMIT provider */],
  exports: [CatsService], // 如果其他模块要用 CatsService 才加
})
export class CatsModule {}
```

```typescript
// app.module.ts
@Module({
  imports: [ObserveModule.forRoot({...}), CatsModule, LabModule, ConsumerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

原则：**根模块只做组装，不写业务**。`AppController`/`AppService` 这种脚手架遗留物，真实项目里会删掉或改成健康检查端点。

---

## 动手练习

1. **边界实验复现**：把 `LabModule` 的 `exports: [LabService]` 删掉（保留 `@Global()`），重启——还能注入吗？然后再把 `@Global()` 也删掉重启，对比两次结果。用实验回答：`@Global()` 和 `exports` 缺了哪个都不行？

   - 删 `exports`（保留 `@Global()`）→ 报错 ✅

   - 再删 `@Global()` → 同样报错 ✅

2. **再导出实践**：创建一个 `InfrastructureModule`，import 并 re-export `EnvModule`，让 `ConsumerModule` 改为只 import `InfrastructureModule`，验证 `/api/consumer/env` 依然可用。

3. **动态模块改造**：给 `EnvOptions` 加可选属性 `fallbackPrefix`（类型定义在 `env.constants.ts`），当 `options.prefix` 为空字符串时 `EnvService.describe()` 返回 fallback。注意体会：**配置项进 options 对象是 Nest 生态惯例**（参考 `ConfigModule.register({ folder })`），不要为它单开一个标量参数——双通道（接口属性 + 独立参数）会造成"两处都能传、合并时互相覆盖"的歧义。

4. **概念题**：03 章讲过"Provider 默认单例"，本章实验 3 却出现了两个实例。两句话内的解释是什么？

5. **概念题**：官方为什么不推荐滥用 `@Global()`？它破坏了什么具体的东西？

---

## 练习参考答案

**练习 1**：删掉 `exports`（保留 `@Global()`）→ **报错**。`@Global()` 的作用是"免除消费方的 import 义务"，不是"免除导出义务"——全局模块的 Provider 依然要在 `exports` 里声明才对外可见。两个都删 → 同样报错（回到实验 1 的状态）。结论：**`exports` 决定"可见"，`@Global()`/`imports` 决定"可达"，两者是正交的两个维度**。

**练习 4**：单例的前提是"**同一个 token 在同一个模块上下文中**"。重复注册本质是在两个模块各建了一个独立的 token→实例映射，容器看来它们是两个互不相干的 Provider，只是恰好用了同一个类。

**练习 5**：它破坏了**依赖关系的显式性**。普通模块想知道"这个 Service 从哪来的"，看 `imports` 数组即可；全局 Provider 可以出现在任何构造函数里而不留痕迹，模块间的依赖图从"可读的有向图"退化成"谁都可以摸任何人的暗箱"，重构和测试（替换 Provider 时不知道影响面）都因此变难。这也是官方建议优先用 `imports` 显式声明的原因。

（练习 2 验证标准：`/api/consumer/env` 正常返回；练习 3 验证标准：`register({ prefix: '', fallbackPrefix: 'fb' })` 时接口返回 `fb`。）

---

## 自检清单

- [ ] 能解释 `exports` 是模块的公共 API，默认一切私有
- [ ] 能说出"导出共享 vs 重复注册"的实例数量差异及后果（状态分裂）
- [ ] 知道 `@Global()` 不免除 `exports` 义务（练习 1 实测）
- [ ] 能手写一个带 options 注入的动态模块（register 模式）
- [ ] 知道 register / forRoot / forFeature 的命名语义
- [ ] 知道 token 为什么要放 constants.ts（循环引用 TDZ 实测）
- [ ] `pnpm start` 全绿，`/api/lab`、`/api/consumer`、`/api/consumer/env`、`/api/cats` 全部可用

---

## 下阶段预告

**05 · Middleware**：请求进入 Controller 之前的第一道关卡。它和 Guard/Interceptor 的位置关系是理解 Nest 请求生命周期的关键拼图，学完后你会拿到一张完整的"请求处理顺序图"——后面 Pipes、Guards、Interceptors、Filters 都是往这张图上挂。
