# Markdown 文档包图片增强解析

## 适用范围

“Markdown 文档包”指一个 ZIP 文件，内部保留原有 Markdown 与图片目录结构，例如：

```text
账户管理模块文档.zip
└── 账户管理模块文档/
    ├── 009_使用权账户操作指引.md
    └── images/
        └── ea948d62261b.png
```

网站导入后会为 ZIP 内每篇 Markdown 创建一条未解析资料。管理员把资料加入现有解析队列后，Agent 领取到的任务 `job_type` 为 `markdown_bundle`。

## Agent 处理流程

1. 按通常方式读取解析队列并领取任务。
2. 如果 `job_type` 是 `markdown_bundle`：
   - 下载 `raw_url`，读取原始 Markdown；
   - 请求 `source_manifest_url`，获取图片清单；
   - 只处理 `assets[].status = ready` 的图片；
   - 对图片提取 OCR 文字，并结合 Markdown 上下文说明截图中的页面、操作、按钮、字段、报错或结果；
   - 将原 Markdown 中的相对图片链接替换成清单中的 `asset_url`，以便网站和后续 Agent 可直接访问图片；
   - 在每张图片后插入简短的“图片说明”和“图片文字”。
3. 仍调用现有 `POST /api/v1/parse-jobs/{job_id}/complete` 回写增强版 Markdown。

不要根据图片臆测无法识别的文字；对于模糊、无权限或损坏的图片，请在 `metadata.images` 标记实际状态并说明原因。

## 任务字段

领取接口 `POST /api/v1/parse-jobs/claim` 与自动领取接口返回的工作项会包含：

```json
{
  "job_type": "markdown_bundle",
  "source_kind": "markdown_bundle",
  "raw_url": "http://server/api/v1/documents/doc_xxx/raw",
  "source_manifest_url": "http://server/api/v1/documents/doc_xxx/source-manifest",
  "output_requirement": "逐张读取图片并生成说明和 OCR 文字"
}
```

图片清单示例：

```json
{
  "markdown_url": "/api/v1/documents/doc_xxx/raw",
  "assets": [
    {
      "id": "asset_xxx",
      "source_ref": "images/ea948d62261b.png",
      "sha256": "...",
      "mime_type": "image/png",
      "status": "ready",
      "asset_url": "/api/v1/documents/doc_xxx/assets/asset_xxx"
    }
  ]
}
```

`status = missing` 表示原 Markdown 引用的资源不存在；不要尝试生成该图片的内容。

## 回写格式

`markdown` 传完整的增强版 Markdown，`text` 传适合索引的纯文本。`metadata.images` 是每张图片的结构化解析结果：

```json
{
  "markdown": "# 标题\n\n![页面](/api/v1/documents/doc_xxx/assets/asset_xxx)\n\n> 图片说明：账户维护页面。\n>\n> 图片文字：账户名称、保存。",
  "text": "标题 账户维护页面 账户名称 保存",
  "metadata": {
    "images": [
      {
        "source_ref": "images/ea948d62261b.png",
        "asset_url": "/api/v1/documents/doc_xxx/assets/asset_xxx",
        "ocr_text": "账户名称 保存",
        "description": "账户维护页面，填写账户信息后点击保存。",
        "status": "ready"
      }
    ]
  },
  "worker": "qoder-work"
}
```

网站会把 `markdown` 保存为 `processed/<document_id>/content.md` 与 `enhanced.md`，并把 `metadata.images` 保存为 `images.json`。解析成功后资料状态变为 `ready`，随后可由已有知识索引流程处理。
