# 03 · Providers：依赖注入容器的完全体

> 对应官方文档：[Providers](https://docs.nestjs.com/providers) + [Custom providers](https://docs.nestjs.com/fundamentals/custom-providers)
> 本章目标：把业务逻辑从控制器抽进 Service，并彻底搞懂 Nest 的 DI 容器——注册、解析、单例、四种自定义 Provider。
> ⚠️ 本章所有行为结论均在 **Nest v12 + ESM** 环境下实测验证（实验代码保留在 `src/lab/`，可随时重跑）。

---

## 本阶段目标

- 理解 Provider 是什么，为什么控制器不该写业务逻辑
- 掌握标准注册与 `useClass` 完整写法的等价关系
- 掌握四种自定义 Provider：`useValue` / `useClass` / `useFactory` / `useExisting`
- 掌握非类 token（字符串 / Symbol）与 `@Inject()` 的使用场景
- 实测验证：单例、`@Optional()`、异步工厂、别名同一性

---

## 知识点释义

### 1. Provider 是什么

Provider 是 Nest 的核心概念：**任何可以被注入的东西**。Service、Repository、Factory、Helper、配置对象、数据库连接——都是 Provider。

回看 01 章的三件套，职责分离的原因是：

- **Controller 的职责是 HTTP 层**：解析请求、调用服务、返回响应。它不该知道业务规则；
- **Service（Provider）的职责是业务逻辑**：可测试、可复用、可被多个消费者注入。

这就是控制反转（IoC）：**对象不自己创建依赖，而是声明"我需要什么"，由容器装配**。好处是换实现（测试时换 mock、生产换真实服务）时，消费者代码一行不改。

### 2. DI 的三步流程

```text
① 声明可被管理：  @Injectable() class CatsService { ... }
② 声明需要什么：  constructor(private catsService: CatsService) {}
③ 注册到容器：    @Module({ providers: [CatsService] })
```

关键机制（01 章实验已验证）：

- 容器靠 TypeScript 发射的 `design:paramtypes` 元数据知道构造函数每个参数的类型，按类型去找已注册的 Provider；
- 解析是**传递的**：CatsController 依赖 CatsService，CatsService 如果依赖别的东西，容器自底向上逐级解析；
- 注册与类型不匹配 → 启动时报 `UnknownDependenciesException`（fail fast）；
- 类上没有任何装饰器 → 元数据不发射 → 依赖静默变 `undefined`（**所有 Provider 无条件加 `@Injectable()`**）。

### 3. 标准注册与完整写法的等价性

```typescript
providers: [CatsService]

// 完全等价于：

providers: [
  {
    provide: CatsService,  // token：注入时按它查找
    useClass: CatsService, // 解析方式：new 这个类
  },
];
```

简写只是语法糖。理解这个等价关系是理解一切自定义 Provider 的基础：**所有 Provider 注册的本质都是"token → 解析方式"的映射**。

### 4. 单例（实测验证 ✅）

Provider 默认是 **单例**：整个应用中同一个 token 只实例化一次，所有注入点共享同一实例。

实测结果（`src/lab/` 探针，GET `/api/lab`）：

```json
{
  "sameTokenTwice": true,          // 同 token 注两次，=== 成立
  "aliasIsSameInstance": true,     // useExisting 别名与本体 === 成立
  "propagation": "mutated-via-alias" // 往别名写属性，从本体读得到
}
```

> ⚠️ **本项目特有的坑（实测发现，官方文档没有）**：脚手架预装的 `@nestjs/observe` 探针（`main.ts` 里的 `instrument: ObserveInstrument`）会把每个 Provider 实例**包一层追踪 Proxy**。Proxy 会转发属性读写（所以 `instanceId` 相同、突变能传播），但**跨 token 的 `===` 比较会失败**——本体和别名是两个不同的 Proxy 壳。去掉 `instrument` 选项后一切恢复正常。**结论：学习/调试阶段做实例同一性判断时，要知道这层 Proxy 的存在；生产如果要精确比较实例，留意它。**

### 5. 四种自定义 Provider

**① `useValue`：注入现成值**

适合：常量、配置对象、外部库实例、测试 mock。

```typescript
{ provide: 'APP_CONFIG', useValue: { port: 3000, env: 'dev' } }
```

**② `useClass`：按条件决定用哪个类**

适合：同一抽象、不同环境不同实现。

```typescript
{
  provide: ConfigService,
  useClass: process.env.NODE_ENV === 'development'
    ? DevConfigService
    : ProdConfigService,
}
```

**③ `useFactory`：用工厂函数动态创建（实测验证 ✅）**

最强大的一种。返回值就是注入值；`inject` 数组声明工厂需要的依赖，**按数组顺序**传入：

```typescript
{
  provide: 'DB_CONNECTION',
  useFactory: async (config: AppConfig, missing?: string) => {
    // 支持 async：Nest 会等 Promise resolve 后才完成启动装配（实测 ✅）
    return createConnection(config);
  },
  inject: [
    'APP_CONFIG',
    // 可选依赖：没注册时传 undefined 而不是报错（实测 ✅）
    { token: 'OPTIONAL_LOGGER', optional: true },
  ],
}
```

适合：需要异步初始化的资源（数据库连接）、需要根据其他 Provider 计算的值。

**`inject` 数组的作用（重点展开）**：它是**工厂的依赖清单**——告诉容器："调用 `useFactory` 之前，先从容器里把这些 token 解析出来，按数组顺序当参数传进去"。映射关系一对一：

```typescript
useFactory: (val, missing) => { ... }
//            ↑              ↑
inject: ['LAB_VALUE',   { token: 'NOT_REGISTERED', optional: true }]
//        第 1 个参数              第 2 个参数
```

**为什么构造函数注入不用写 `inject`，工厂却必须写？** 类的依赖靠 TypeScript 发射的 `design:paramtypes` 元数据自动推断（第 2 节）；而 `useFactory` 是**普通函数**，不是类，没有装饰器、没有元数据，容器无法推断它要什么，只能显式声明。

两个容易踩的点（结合 `src/lab/` 实测）：

1. **顺序敏感**：`inject` 数组顺序必须和工厂参数顺序一一对应，写反了就是类型错乱的静默 bug；
2. **token 不受类型约束**：参数左边的类型标注只是 TS 层面的自我约束，容器只按 token 找值，不做类型检查——标错了运行时才知道。

**④ `useExisting`：创建别名（实测验证 ✅）**

```typescript
{ provide: 'LoggerAlias', useExisting: LoggerService }
```

两个 token 解析到**同一个实例**（上面实测的 `aliasIsSameInstance: true` + 突变传播证明）。适合：老代码用旧 token、新代码用新 token 的迁移期。

### 6. 非类 token：什么时候必须 `@Inject()`

构造函数注入靠 TS 类型元数据，但有两种情况元数据帮不上忙：

**情况 A：token 不是类**（字符串 / Symbol）→ 必须显式 `@Inject()`：

```typescript
// 推荐集中定义在 constants.ts
export const APP_CONFIG = Symbol('APP_CONFIG'); // Symbol 比字符串更安全：运行时唯一，不怕撞名

@Injectable()
export class CatsService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
}
```

**情况 B：想用接口当契约**。接口编译后被擦除，运行时不存在，**不能作 token**（和 02 章 DTO 必须 class 是同一个原理）。两个解法：

```typescript
// 解法 1：接口 + Symbol token + @Inject（类型靠左边标注，运行时靠右边 token）
constructor(@Inject(LOGGER) private readonly logger: LoggerService) {}

// 解法 2：抽象类 —— 编译后真实存在，可直接当 token，不用 @Inject
export abstract class LoggerService { abstract log(msg: string): void; }
// providers: [{ provide: LoggerService, useClass: PinoLoggerService }]
constructor(private readonly logger: LoggerService) {}
```

### 7. `@Optional()` 与属性注入（实测验证 ✅）

- `@Optional()`：依赖未注册时注入 `undefined` 而非启动报错。实测：`optionalMissingIsUndefined: true`。适合"有就用、没有拉倒"的可选能力（如可选的日志上报器）。
- **属性注入**：`@Inject() private readonly x: T` 写在属性上而非构造函数。官方建议：只有"继承场景下不想层层 `super()` 传参"才用；普通类优先构造函数注入——构造函数的参数列表就是这个类的依赖说明书，一目了然。

### 8. 调试技巧：`NEST_DEBUG`

依赖解析出问题（启动报 can't resolve）时：

```bash
NEST_DEBUG=true pnpm start:dev
```

容器会打印每个模块解析了哪些 Provider、谁依赖谁，定位缺失注册非常快。

---

## 代码实现

本章两件代码资产：

### A. `src/lab/`（已建好，已验证 ✅）

我为了验证本章结论建的探针模块，`GET /api/lab` 返回全部验证结果。你可以读这三个文件对照本章知识点：`lab.module.ts`（五种注册方式）、`lab.service.ts`（instanceId 单例探针）、`lab.controller.ts`（各种注入方式 + 同一性断言）。

### B. 把 cats 的业务逻辑抽进 Service（你动手）

现在 `CatsController` 里直接返回写死的字符串，把它改成标准结构：

**`src/cats/cats.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { CreateCatDto } from './dto/create-cat.dto.js';

export interface Cat {
  name: string;
  age: number;
  breed: string;
}

@Injectable()
export class CatsService {
  private readonly cats: Cat[] = [];

  create(cat: CreateCatDto): Cat {
    const newCat = { ...cat };
    this.cats.push(newCat);
    return newCat;
  }

  findAll(): Cat[] {
    return this.cats;
  }

  findOne(id: number): Cat | undefined {
    return this.cats[id];
  }
}
```

**改造 `cats.controller.ts`**：构造函数注入 `CatsService`，`create`/`findAll` 委托给它。

**`app.module.ts`**：`providers: [AppService, CatsService]`。

验证（注意内存数组，重启清空）：

```bash
curl -X POST http://localhost:3000/api/cats \
  -H 'Content-Type: application/json' \
  -d '{"name":"Tom","age":3,"breed":"Persian"}'
curl http://localhost:3000/api/cats   # 应能看到刚才创建的 Tom
```

> 试试 CLI：`nest g service cats` 会自动生成文件并注册进模块。第 04 章学模块后我们会把 cats 收进独立的 `CatsModule`。

---

## 动手练习

1. **单例实证**：连续 POST 两只猫再 GET，确认数据在；然后重启服务再 GET，数据没了。解释：这说明单例的状态存活于什么时间范围？
2. **mock 替换**：在 `AppModule` 里用 `useValue` 把 `CatsService` 替换成一个假实现（`findAll` 永远返回一只叫 Mock 的猫），不改动控制器代码，curl 验证生效。体会：为什么这就是"可测试性"的来源？
3. **工厂注册**：给 cats 模块加一个 `CATS_STORAGE_LIMIT` provider，用 `useFactory` 根据环境变量 `NODE_ENV` 返回 `100`（生产）或 `5`（开发），并在 `CatsService.create` 里注入它、超限时抛错。
4. **概念题**：`useExisting` 和 `useClass` 都能让两个 token 关联到同一个类，它们的本质区别是什么？（提示：实例数量）
5. **概念题**：属性注入官方为什么不推荐作为首选？它破坏了什么？

---

## 练习参考答案

**练习 1**：单例 Provider 的生命周期**与应用进程一致**——启动时实例化，进程退出时销毁。内存数组不是持久化，重启即失。这正是第 04 章之后要引入数据库的原因。另外注意：单例意味着**不能在 Provider 里存请求级状态**（比如"当前用户"），多请求并发会互相污染——请求级状态要用 request-scoped provider（Injection Scopes 章节的内容，进阶阶段再学）。

**练习 4**：`useClass` 会让两个 token **各自实例化一次**（两个实例）；`useExisting` 只是给已有实例起别名，**全程只有一个实例**（本章已实测：别名与本体突变互相可见）。判断标准：想"同一个东西两个名字"用 `useExisting`；想"同一套实现两份独立状态"用 `useClass`。

**练习 5**：构造函数注入让这个类的依赖在**签名处完整可见**——调用方（和读代码的人）看一眼构造函数就知道它需要什么，实例化时必须满足。属性注入把依赖藏进了类体内部，签名说谎（看起来零依赖，实际有依赖），且属性在构造函数执行后才被赋值，构造函数里访问是 `undefined`。继承场景下层层 `super(deps)` 传参确实繁琐，官方才留了属性注入这个出口。

（练习 2、3 的验证标准：练习 2 改完 curl 返回 Mock 猫即成功，注意改完记得恢复；练习 3 用 `NODE_ENV=development pnpm start:dev` 后连续 POST 6 只猫应看到第 6 次报错。）

---

## 自检清单

- [ ] 能默写 DI 三步流程，并解释 `design:paramtypes` 元数据在其中的角色
- [ ] 能解释 `providers: [CatsService]` 和 `{ provide, useClass }` 的等价关系
- [ ] 四种自定义 Provider 各自能说出适用场景
- [ ] 知道接口为什么不能当 DI token，以及两个解法（Symbol token / 抽象类）
- [ ] 知道 `@Optional()` 和 `inject: [{ token, optional: true }]` 的行为差异点（注入点 vs 工厂参数）
- [ ] 知道本项目 observe 探针会包 Proxy，做实例同一性判断时留意
- [ ] cats 模块完成 Service 抽取，POST → GET 链路 curl 验证通过

---

## 下阶段预告

**04 · Modules**：现在所有东西都塞在 `AppModule` 里，已经有点乱了。下一章学模块的真正职责——封装边界、`exports`/`imports` 的可见性规则、全局模块、动态模块（`forRoot`/`register` 模式），并把 cats 收进独立的 `CatsModule`。
