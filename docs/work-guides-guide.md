# 工作指引目录维护说明

网站左侧的“工作指引”面向所有局域网用户开放。内容直接读取 Windows 台式机上的：

```text
F:\kb-data\work-guides
```

修改 Markdown 或替换图片后，刷新“工作指引”页面即可看到变化，不需要修改代码、执行 `git pull` 或重新构建 Docker。

## 推荐目录结构

每份工作指引使用一个独立文件夹，正文固定命名为 `index.md`，截图和正文放在同一目录：

```text
F:\kb-data\work-guides\
├── 资金计划填报规范\
│   ├── index.md
│   ├── 填报页面.png
│   └── 审批流程.png
└── 银行账户开立流程\
    ├── index.md
    └── 开户页面.png
```

也支持把单个 Markdown 直接放在 `work-guides` 根目录，但需要展示图片时，建议使用独立文件夹，避免不同指引的图片重名。

## Markdown 模板

```markdown
---
title: 资金计划填报规范
summary: 资金计划填报口径、时间要求和常见问题
categories:
  - 操作流程
  - 资金管理
version: V1.2
effective_date: 2026-07-10
updated_at: 2026-07-10
status: active
pinned: false
---

# 资金计划填报规范

这里填写工作指引正文。

## 填报步骤

1. 打开资金计划填报页面。
2. 按规定口径填写计划金额。
3. 检查后提交审批。

![资金计划填报页面](./填报页面.png)
```

## 字段说明

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `title` | 否 | 卡片标题；不填时读取正文中的一级标题 |
| `summary` | 否 | 卡片内容概要；不填时读取正文第一段 |
| `categories` | 否 | 可以填写一个或多个分类，页面会自动汇总分类筛选项 |
| `version` | 否 | 当前规范版本号 |
| `effective_date` | 否 | 生效日期 |
| `updated_at` | 否 | 更新时间；不填时使用 Markdown 文件修改时间 |
| `status` | 否 | 默认 `active`；填写 `archived` 后不在默认列表出现 |
| `pinned` | 否 | 填写 `true` 后置顶显示 |

也兼容单分类写法：

```yaml
category: 操作流程
```

没有填写分类的文档会自动归入“未分类”。只有 `status: active` 的文档参与列表展示和动态分类统计。

## 图片规则

正文图片使用相对路径：

```markdown
![图片说明](./填报页面.png)
```

支持 PNG、JPG、JPEG、GIF、WEBP、BMP 和 AVIF。网站会限制图片访问范围，Markdown 不能读取当前工作指引目录之外的文件。

## 更新一份指引

1. 修改对应目录中的 `index.md` 和图片。
2. 更新 Front Matter 中的 `version`、`updated_at` 等信息。
3. 浏览器打开“工作指引”，点击刷新按钮或刷新网页。
4. 检查卡片概要、分类、正文格式和图片是否正确。

过期规范建议把 `status` 改为 `archived`，不要直接覆盖后继续沿用旧版本号。

## Agent 发布接口

Agent 可以使用与解析队列相同的 Token 发布或覆盖一份工作指引：

```http
PUT /api/v1/work-guides/{工作指引名称}
Authorization: Bearer <Agent Token>
Content-Type: application/json

{
  "markdown": "# 工作指引标题\n\n这里填写正文。"
}
```

接口会把正文写入 `F:\kb-data\work-guides\{工作指引名称}\index.md`。工作指引名称不能包含路径分隔符或 Windows 文件名非法字符。
