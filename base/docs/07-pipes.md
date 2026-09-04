# 07 · Pipes：输入的校验与转换

> 对应官方文档：[Pipes](https://docs.nestjs.com/pipes) + [Validation](https://docs.nestjs.com/techniques/validation)
> 本章目标：掌握管道的两大职责（转换/校验）、内置管道、`ValidationPipe` + class-validator 的完整玩法、绑定级别。
> ⚠️ 本章所有行为结论均在 **Nest v12 + ESM** 实测验证（实验代码：`src/cats/` + 全局 `APP_PIPE`）。
> 💡 前端类比先行：Pipe ≈ **zod 的 schema.parse**——数据进业务逻辑前先过一道 schema，不合法直接抛错，合法的可能被"转型"后放行。

---

## 本阶段目标

- 理解管道的两大职责：transformation（转换）与 validation（校验）
- 掌握内置 `Parse*` 系列管道
- 掌握 `ValidationPipe` + class-validator 的 DTO 校验体系
- 理解 `whitelist` / `transform` 等关键选项的实际行为（实测）
- 掌握管道的绑定级别（参数级/方法级/全局）

---

## 知识点释义

### 1. 管道是什么

管道 = 实现 `PipeTransform` 接口的类，在**控制器方法执行前**介入，对参数做两件事：

| 职责 | 干什么 | 例子 |
|---|---|---|
| **transformation** 转换 | 把输入变成需要的形态 | `'42'` → `42`；补上默认值 |
| **validation** 校验 | 不合法就抛异常 | `age: 99` 超过上限 → 400 |

**关键位置特性**：管道运行在"异常区"（exceptions zone）——抛出的异常直接被异常层接管（06 章的过滤器能接住，实测 ✅），**控制器方法根本不会执行**。所以管道是"在系统边界挡住脏数据"的正解。

前端类比：就是表单提交前的 zod 校验——不通过就根本不调 submit 回调，错误信息统一走错误展示层。

### 2. 内置 `Parse*` 管道：解决 02 章的遗留问题（实测 ✅）

02 章说过"`@Param('id')` 永远是 string"，现在收账：

```typescript
@Get(':id')
findOne(@Param('id', ParseIntPipe) id: number) { ... }
```

实测：

```text
GET /api/cats/42   → id 是 number 42，正常进入业务逻辑
GET /api/cats/abc  → 400 {"message":"Validation failed (numeric string is expected)"}
                     ↑ 控制器没执行，异常被全局过滤器接住格式化
```

内置管道全家桶：`ParseIntPipe` / `ParseFloatPipe` / `ParseBoolPipe` / `ParseUUIDPipe` / `ParseEnumPipe` / `ParseArrayPipe` / `ParseDatePipe` / `DefaultValuePipe`（提供默认值，放在其他管道**前面**串联）。

管道可以**串联**，按声明顺序执行：

```typescript
@Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number
//          先补默认值            → 再转 number
```

### 3. `ValidationPipe` + class-validator：DTO 校验体系（实测 ✅）

02 章说 DTO 必须用 class，本章兑现原因：**class 上的装饰器是运行时可读的校验元数据**。

```typescript
// dto/create-cat.dto.ts
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class CreateCatDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(0)
  @Max(30)
  age: number;

  @IsString()
  breed: string;
}
```

前端类比：每个装饰器 ≈ zod 的一条规则——`@IsString()` ≈ `z.string()`，`@Min(0) @Max(30)` ≈ `z.number().min(0).max(30)`。区别是 zod 的 schema 独立存在，class-validator 的规则直接长在 DTO 类上（单一事实来源）。

实测非法请求：

```text
POST /api/cats  {"name":123,"age":99}
→ 400 {"message":["name must be a string","age must not be greater than 30","breed must be a string"], ...}
```

**原理**（为什么 DTO 必须 class 的完整答案）：网络反序列化得到的是**纯 JS 对象**，身上没有任何类型信息。`ValidationPipe` 内部用 `plainToInstance(metatype, value)` 把纯对象转成 DTO 类的实例，再跑 class-validator。`metatype` 来自 TS 元数据——interface 编译后消失，传不了；class 才能。

### 4. 三个关键选项（全部实测 ✅）

**`whitelist: true`——剥离多余字段**

实测对比：

```text
不开 whitelist：POST {"name":"Tom",...,"evil":"injected"}
  → evil 字段原样进入存储（数据污染！）

开 whitelist：同样的请求
  → {"name":"Tom","age":3,"breed":"Persian"}  evil 被静默剥掉
```

**安全意义**：防止"批量赋值"攻击——客户端偷偷塞个 `role: 'admin'`、`isVip: true`，没开 whitelist 就可能直接落库。生产环境建议常开；想更严格用 `forbidNonWhitelisted: true`（多余字段直接 400 报错而不是静默剥离）。

**`transform: true`——自动类型转换**

实测：开启后 `@Body()` 拿到的是 **DTO 类的真实例**（`instanceof CreateCatDto === true`），路径/查询参数也会按声明类型自动转（`id: number` 不用 ParseIntPipe 也能转）。代价是有一点运行时开销。

**`disableErrorMessages: true`**——生产环境可关掉详细错误文案（呼应 06 章的信息暴露纪律）。

### 5. 绑定级别（与过滤器同一套模式）

```typescript
// 参数级
@Body(new ValidationPipe()) dto: CreateCatDto

// 方法级
@Post()
@UsePipes(new ValidationPipe())
create(...) {}

// 全局（main.ts，无 DI）
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

// 全局（模块内，支持 DI——和 APP_FILTER 同一套逻辑）
{ provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) }
```

06 章的结论直接平移：**要 DI 就 `APP_PIPE`，不要就 `useGlobalPipes`**。本项目当前用的 `APP_PIPE` + `useValue`（选项对象不需要 DI，所以 useValue 传实例）。

### 6. 自定义管道

```typescript
import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class TrimPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (typeof value === 'string') return value.trim();
    return value;
  }
}
```

`transform(value, metadata)` 的**返回值完全替换原参数值**（转换职责的实现方式）。`metadata` 里有三个信息：`type`（body/query/param）、`metatype`（参数类型）、`data`（装饰器传入的 key，如 `@Param('id')` 的 `'id'`）。

### 7. Zod / Standard Schema（给你的前端直觉留个接口）

Nest 内置 `StandardSchemaValidationPipe`，支持 zod 等标准 schema 库，schema 可以直接挂在装饰器上：

```typescript
@Post()
create(@Body({ schema: createCatSchema }) body: CreateCatDto) { ... }
```

如果你前端已经深度用 zod，这是可选项；但 Nest 生态（Swagger 文档生成等）对 class-validator 的支持最成熟，**主线建议 class-validator**。

### 8. Mapped Types：DTO 的复用工具

`UpdateCatDto` 手写三个可选字段太啰嗦，官方工具函数：

```typescript
import { PartialType } from '@nestjs/mapped-types';

export class UpdateCatDto extends PartialType(CreateCatDto) {}
// 等价于所有字段变可选，且继承全部校验装饰器
```

还有 `PickType`（挑字段）、`OmitType`（排字段）、`IntersectionType`（合并）。需要 `pnpm add @nestjs/mapped-types`。

### 9. 生命周期图更新

```text
请求 → 中间件 → Guard → Interceptor(前) → [Pipe] → Controller → ...
                                           ↑ 你在这里
                          参数进控制器前的最后一道关
```

---

## 代码实现

本章对 cats 模块的改造（已验证 ✅）：

- `dto/create-cat.dto.ts`：`CreateCatDto` 加上 class-validator 装饰器
- `cats.controller.ts`：`findOne` 用 `ParseIntPipe`（替换了手写 `parseInt`）；`create` 方法级绑了 `ValidationPipe`（与全局管道叠加，先执行方法级）
- `app.module.ts`：`APP_PIPE` 全局注册 `ValidationPipe({ whitelist: true, transform: true })`
- `catch-all.filter.ts`：修复了 message 提取逻辑——**校验失败的详细信息在 `exception.getResponse().message` 里，不在 `exception.message` 上**（06 章埋的坑，本章兑现）

自测：

```bash
pnpm start:dev
curl http://localhost:3000/api/cats/abc                              # 400 ParseIntPipe
curl -X POST http://localhost:3000/api/cats -H 'Content-Type: application/json' \
  -d '{"name":123,"age":99}'                                          # 400 详细错误数组
curl -X POST http://localhost:3000/api/cats -H 'Content-Type: application/json' \
  -d '{"name":"Tom","age":3,"breed":"Persian","evil":"x"}'           # 成功，evil 被剥离
```

---

## 动手练习

1. **PartialType 重构**：装 `@nestjs/mapped-types`，用 `PartialType(CreateCatDto)` 重写 `UpdateCatDto`，删掉手写字段。
2. **自定义 TrimPipe**：实现上面第 6 节的 `TrimPipe`，应用到 `CreateCatDto.name`（参数级绑定到 `@Body()` 不行——想想为什么？提示：Body 拿到的是整个对象）。改成：写一个作用于整个 DTO 的管道，遍历对象的字符串字段统一 trim。
3. **分页参数**：给 `GET /cats` 加 `page`/`pageSize` 查询参数，用 `DefaultValuePipe` + `ParseIntPipe` 串联，默认值 1 和 10。
4. **概念题**：`whitelist`（静默剥离）和 `forbidNonWhitelisted`（报错拒绝），从 API 设计的角度各适合什么场景？
5. **概念题**：为什么校验放管道而不是中间件？（提示：05 章生命周期图 + 本章第 1 节）

---

## 练习参考答案

**练习 2 的关键坑**：`@Body()` 参数是整个 DTO 对象，`TrimPipe` 若只处理 string 就直接放行了。正确思路是管道内递归/遍历对象字段 trim，或者更工程化的做法：利用 `transform: true` 后 DTO 是类实例的特点，用 class-transformer 的 `@Transform(({ value }) => value.trim())` 装饰器直接写在 DTO 字段上——声明式，跟着字段走。

**练习 4**：`whitelist` 静默剥离适合**对外开放的公共 API**——兼容性好，客户端多传字段不报错，服务端只取认识的；`forbidNonWhitelisted` 报错适合**内部系统/强契约场景**——多传字段通常意味着调用方理解错了契约，尽早报错比静默丢弃更利于联调排错。安全角度两者都防住了批量赋值攻击，差别只在"对调用方友不友好"。

**练习 5**：两个原因。① **中间件拿不到执行上下文**：它不知道这个请求对应哪个处理器、参数的类型是什么（DTO metatype），也就无法做类型感知的校验；管道在路由匹配之后执行，有完整上下文。② **职责**：中间件处理的是"请求"（HTTP 层），管道处理的是"参数"（应用层）——校验 DTO 是应用层的事。这也是为什么 `whitelist` 这类能力只能做在管道里。

（练习 1 验证标准：`PUT /api/cats/1` 只传 `{ "age": 5 }` 不报缺字段错误；练习 3 验证标准：`GET /api/cats`、`GET /api/cats?page=2` 都能拿到正确的 number 类型参数。）

---

## 自检清单

- [ ] 能说出管道的两大职责，知道转换是"返回值替换原参数"
- [ ] 掌握 `ParseIntPipe` 及管道串联（`DefaultValuePipe` 在前）
- [ ] 理解 ValidationPipe 原理：plainToInstance + class-validator，以及这和"DTO 必须 class"的关系
- [ ] 实测理解 `whitelist` 的安全意义（批量赋值攻击）
- [ ] 知道 `useGlobalPipes` vs `APP_PIPE` 的 DI 差异
- [ ] 能画出生命周期图：中间件 → Guard → Interceptor → Pipe → Controller
- [ ] 三条自测 curl 全部符合预期

---

## 下阶段预告

**08 · Guards**：鉴权登场。管道回答"数据合不合法"，守卫回答"你能不能来"。05 章练习 4 留的问题（JWT 校验为什么不放中间件）本章给出完整答案，并且 `ExecutionContext` 这个 Nest 最重要的抽象之一正式登场。
