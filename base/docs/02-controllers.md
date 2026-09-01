# 02 · Controllers：接收请求的完整工具箱

> 对应官方文档：[Controllers](https://docs.nestjs.com/controllers)
> 本章目标：掌握控制器处理请求的**全部输入方式**（参数、查询、请求体、请求头）和**全部输出方式**（返回值、状态码、响应头、重定向），并搭起贯穿基础阶段的 `cats` 练手模块。

---

## 本阶段目标

- 理解控制器的职责边界：只负责"接"和"回"，不写业务逻辑
- 掌握路由定义：前缀、HTTP 方法、参数、通配符
- 掌握两种响应模式：标准模式（推荐）vs 库特定模式
- 理解为什么 DTO 必须用 **class** 而不是 interface
- 建立 cats 模块，后续章节（Providers/Modules/Pipes/Guards…）都在它上面叠加

---

## 知识点释义

### 1. 控制器是什么

控制器负责**接收请求、返回响应**。路由机制（哪个 URL 由哪个方法处理）通过装饰器声明。一个控制器 = 一个类 + `@Controller()` 装饰器：

```typescript
import { Controller, Get } from '@nestjs/common';

@Controller('cats') // 路径前缀：这个控制器下所有路由都以 /cats 开头
export class CatsController {
  @Get() // → GET /cats（本项目有全局前缀，实际是 /api/cats）
  findAll(): string {
    return 'This action returns all cats';
  }
}
```

要点：

- **方法名没有语义**：`findAll` 叫什么都可以，Nest 只看装饰器。
- **路径 = 控制器前缀 + 方法装饰器路径**：`@Controller('cats')` + `@Get('breed')` → `GET /cats/breed`。
- 默认状态码：普通请求 **200**，POST **201**。

### 2. 两种响应模式（重要设计决策）

Nest 处理返回值有两种方式，理解这个分野很重要：

**① 标准模式（Standard，推荐）**

直接 `return`，Nest 帮你序列化：返回对象/数组 → 自动转 JSON；返回字符串/数字/布尔 → 原样发送。

**② 库特定模式（Library-specific）**

用 `@Res()` 注入底层平台（Express）的原生响应对象，自己调 `res.json()`：

```typescript
import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

@Controller('cats')
export class CatsController {
  @Get()
  findAll(@Res() res: Response) {
    res.status(HttpStatus.OK).json([]);
  }
}
```

**为什么推荐标准模式？** 库特定模式有三个代价：

1. 代码绑死在 Express 上，换 Fastify 就要改；
2. 测试时必须 mock 响应对象，很麻烦；
3. **失去 Nest 的后续处理能力**——后面要学的 Interceptor（统一响应包装）、`@HttpCode()` 等都建立在标准模式之上，用了 `@Res()` 它们就失效了。

如果既要碰原生响应对象（比如设 cookie）又想保留标准模式，用 **passthrough**：

```typescript
@Get()
findAll(@Res({ passthrough: true }) res: Response) {
  res.cookie('key', 'value'); // 自己操作的部分
  return [];                   // 返回值仍由 Nest 处理
}
```

> ⚠️ 用了 `@Res()`（不带 passthrough）就必须自己发送响应，否则请求会**永远挂起**——这是个经典坑。

### 3. 请求数据的提取：装饰器速查表

原则上你**不需要**碰原生 `req` 对象，每个常用数据都有专用装饰器：


| 装饰器                         | 取的是什么             | 例子                     |
| --------------------------- | ----------------- | ---------------------- |
| `@Param('id')`              | 路径参数 `req.params` | `/cats/42` → `'42'`    |
| `@Query('page')`            | 查询字符串 `req.query` | `/cats?page=2` → `'2'` |
| `@Body()`                   | 请求体 `req.body`    | POST 的 JSON            |
| `@Headers('authorization')` | 请求头               |                        |
| `@Ip()`                     | 客户端 IP            |                        |
| `@Req()` / `@Res()`         | 原生 req/res 对象     | 尽量不用                   |
| `@Session()`                | `req.session`     |                        |
| `@HostParam()`              | host token        | 子域路由用                  |


注意一个反直觉的点：`**@Param('id')` 拿到的永远是 `string`**。URL 里没有类型，`/cats/42` 里的 `42` 是字符串 `'42'`。想要 `number`？那是第 07 章 Pipes 干的事（`ParseIntPipe`），现在先记住这个问题存在。

### 4. 路由参数与声明顺序

```typescript
@Get(':id')
findOne(@Param('id') id: string) {
  return `This action returns a #${id} cat`;
}
```

**静态路由必须声明在参数路由之前**，否则会被"遮蔽"：

```typescript
@Controller('users')
export class UsersController {
  @Get(':id')
  findOne() {}        // ← 先声明了 :id

  @Get('me')
  findMe() {}         // ← 永远到不了：/users/me 先匹配上了 :id（id='me'）
}
```

Express 适配器是**顺序敏感**的，先注册先匹配，而且默认**启动时不给任何警告**。这是新手高频 bug。

**Nest v12 给出了官方解法**（本项目是 v12，可以直接用）：

```typescript
// main.ts
const app = await NestFactory.create(AppModule, {
  // 启动时诊断路由冲突：duplicate(完全重复) / shadow(互相遮蔽)
  routeConflictPolicy: { duplicate: 'error', shadow: 'warn' },

  // 或者干脆改变注册策略：最具体的路由永远优先（字面量 > 参数 > 通配符）
  routeResolutionStrategy: 'specificity',
});
```

> Fastify 适配器天然按特异性排序，不存在这个问题。这又是"平台差异被 Nest 暴露出来"的一个例子。

### 5. 状态码、响应头、重定向

```typescript
@Post()
@HttpCode(204)                    // 改状态码（默认 POST 是 201）
@Header('Cache-Control', 'no-store') // 加响应头
create() {}

@Get('docs')
@Redirect('https://docs.nestjs.com', 302) // 重定向
getDocs(@Query('version') version?: string) {
  // 返回 { url } 对象可以动态覆盖装饰器里的配置
  if (version === '5') {
    return { url: 'https://docs.nestjs.com/v5/' };
  }
}
```

动态状态码的场景（如根据结果返回 200 或 206）要么用 `@Res()`，要么**抛异常**——后者是 Nest 的惯用法，第 06 章专门讲。

### 6. 异步：Promise 和 Observable 都行

```typescript
@Get()
async findAll(): Promise<any[]> {  // 最常用：Nest 自动 await
  return [];
}

@Get()
findAllStream(): Observable<any[]> { // 也可以返回 RxJS Observable
  return of([]);                     // Nest 自动订阅并取最终值
}
```

返回 Observable 现在只需要知道"可以"，它的真正威力在第 09 章 Interceptors 里体现（Nest 的响应管道本身就是 RxJS 流）。

### 7. DTO：为什么必须用 class

接收请求体：

```typescript
// dto/create-cat.dto.ts
export class CreateCatDto {
  name: string;
  age: number;
  breed: string;
}
```

```typescript
@Post()
async create(@Body() createCatDto: CreateCatDto) {
  return 'This action adds a new cat';
}
```

**为什么不用 interface？** 这是 Nest 里最重要的"运行时 vs 编译时"问题：

- TypeScript 的 `interface` 在编译后**被完全擦除**，运行时不存在；
- Nest 的很多功能（第 07 章的 ValidationPipe、Swagger 文档生成）需要在**运行时**拿到"这个参数是什么类型"的信息；
- `class` 编译后是真实存在的构造函数，运行时可以通过元数据引用它。

一句话：**interface 只在写代码时约束你，class 在运行时还活着**。所有需要被 Nest 运行时"看到"的类型（DTO、实体），都用 class。

### 8. 控制器必须注册到模块

写完控制器什么都不会发生，直到把它登记进某个模块的 `controllers` 数组：

```typescript
// app.module.ts
@Module({
  controllers: [CatsController],
})
export class AppModule {}
```

忘记注册 = 路由不存在 = 404，这是第二个经典坑。

---

## 代码实现

在 `base/` 下创建 cats 模块（本章先不接 Service，逻辑写在控制器里返回假数据，第 03 章再抽出去）：

```
src/
└── cats/
    ├── dto/
    │   └── create-cat.dto.ts
    └── cats.controller.ts
```

`**src/cats/dto/create-cat.dto.ts**`

```typescript
export class CreateCatDto {
  name: string;
  age: number;
  breed: string;
}

export class UpdateCatDto {
  name?: string;
  age?: number;
  breed?: string;
}
```

`**src/cats/cats.controller.ts**`

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateCatDto, UpdateCatDto } from './dto/create-cat.dto.js'; // 注意 .js 后缀

@Controller('cats')
export class CatsController {
  @Post()
  create(@Body() createCatDto: CreateCatDto) {
    return `This action adds a new cat: ${createCatDto.name}`;
  }

  @Get()
  findAll(@Query('limit') limit?: string) {
    return `This action returns all cats (limit: ${limit ?? 'none'})`;
  }

  // 静态路由在前
  @Get('breeds')
  findBreeds() {
    return ['Persian', 'Siamese', 'Maine Coon'];
  }

  // 参数路由在后
  @Get(':id')
  findOne(@Param('id') id: string) {
    return `This action returns a #${id} cat`;
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateCatDto: UpdateCatDto) {
    return `This action updates a #${id} cat`;
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    // 204 No Content：成功但不返回body
  }
}
```

**注册到 `app.module.ts`**：在 `controllers` 数组里加上 `CatsController`（import 路径 `./cats/cats.controller.js`）。

验证：

```bash
pnpm start:dev

curl http://localhost:3000/api/cats
curl http://localhost:3000/api/cats?limit=10
curl http://localhost:3000/api/cats/breeds
curl http://localhost:3000/api/cats/42
curl -X POST http://localhost:3000/api/cats \
  -H 'Content-Type: application/json' \
  -d '{"name":"Tom","age":3,"breed":"Persian"}'
curl -X DELETE -i http://localhost:3000/api/cats/42   # 看返回是不是 204
```

> 也可以用 CLI 生成骨架：`nest g controller cats`。后面学完整 CRUD 时还有更强的 `nest g resource cats`，会连 Service、DTO、测试一起生成。

---

## 动手练习

1. **顺序实验**：把 `findBreeds()`（`/cats/breeds`）挪到 `findOne()`（`/cats/:id`）**后面**，`curl /api/cats/breeds` 看返回了什么；然后用 `routeResolutionStrategy: 'specificity'` 修复它，再观察一次。
2. **通配符**：加一条 `@Get('files/*')` 路由，验证 `/api/cats/files/a/b/c` 能匹配，并用 `@Param()` 打印出通配符匹配到的内容。
3. **分页接口**：给 `findAll` 加 `@Query('page')` 和 `@Query('pageSize')`，返回格式为 `{ list: [], page, pageSize }` 的对象（假数据即可）。
4. **概念题**：`@Get()` 和 `@All()` 有什么区别？什么真实场景适合用 `@All()`？
5. **概念题**：为什么说用了 `@Res()` 就"失去 Nest 的后续处理能力"？结合本章内容至少说出两个失去的东西。

---

## 练习参考答案

**练习 4（`@Get` vs `@All`）**

`@Get()` 只匹配 GET 方法；`@All()` 匹配该路径下的**所有** HTTP 方法（GET/POST/PUT/DELETE/…）。`@All()` 的典型场景是**需要捕获任意方法请求的基础设施型端点**：

- Webhook 接收端——有些第三方服务的回调方法不固定；
- 健康检查/探活端点——不管负载均衡器用什么方法探都返回 200；
- 反向代理/转发入口——方法要透传给上游，本地不关心是哪个方法。

业务 CRUD 接口几乎不该用 `@All()`——HTTP 方法本身就是 API 语义的一部分（GET 读、POST 增），全放开等于放弃了这层语义。

**练习 5（`@Res()` 失去什么）**

- **拦截器（Interceptors）**：它们包装的是"处理器返回的值/Observable"，你自己 `res.json()` 之后，Nest 层面已经没有"返回值"可包装了，第 09 章学的统一响应格式就做不了；
- `**@HttpCode()` / `@Header()` 这类声明式装饰器**：状态码和响应头你已经手动设置了，装饰器失效；
- **自动序列化**：返回值→JSON 的转换没了；
- **可测试性**：单测必须 mock 整个 Express `Response` 对象，而标准模式只需断言返回值。

（练习 1 的验证标准：`specificity` 策略下 `/cats/breeds` 无论在前后都返回品种列表；练习 2 中通配符捕获的内容，在本项目（Nest v12 + Express 5 适配器）下实测位于 **`params['path']`，类型是 `string[]`（按 `/` 分段）**——匿名 `*` 被框架默认归到 `path` 这个键下。更明确的写法是命名通配符 `@Get('files/*path')` + `@Param('path') path: string[]`，效果相同但意图清晰。注意老版本 Express 4 时代是 `params[0]`，这也是平台差异的实例。）

---

## 自检清单

- 能默写出 `@Param` `@Query` `@Body` `@Headers` 四个装饰器的用途和取值类型
- 能解释"标准模式 vs 库特定模式"的取舍，以及 passthrough 解决什么问题
- 能解释 DTO 为什么用 class 不用 interface（运行时元数据）
- 知道路由声明顺序的坑，以及 v12 的两种解法
- 知道 `@Param('id')` 拿到的是 string，类型转换留给 Pipes
- 练习 1-3 完成，cats 模块的 6 条路由全部 curl 验证通过

---

## 下阶段预告

**03 · Providers**：现在业务逻辑（虽然是假的）写在控制器里，这是坏味道。下一章把逻辑抽进 `CatsService`，真正搞懂 `@Injectable()`、构造函数注入背后的 DI 容器工作原理，以及 Provider 的几种注册方式（useClass / useValue / useFactory）——这是 Nest 区别于普通 Express 的核心武器。