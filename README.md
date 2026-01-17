# Cloudflare Worker Proxy

一个基于 Cloudflare Workers 的 Web 代理。

修改自 [ymyuuu/Cloudflare-Workers-Proxy](https://github.com/ymyuuu/Cloudflare-Workers-Proxy)。

## 部署指南

创建 `wrangler.jsonc` 并填写以下环境变量：

| 变量名            | 示例值             | 说明                                             |
| :---------------- | :----------------- | :----------------------------------------------- |
| `SECRET_PATH`     | `/my-super-secret` | 前缀路径，建议设置复杂字符串                     |
| `ALLOW_COUNTRIES` | `CN,US` 或 `*`     | 接受的客户端来源地区，逗号分格，`*` 代表允许所有 |

执行 `bun run deploy` 部署。

## 使用方法

访问 `https://${WORKER_HOST}/${SECRET_PATH}/${TARGET_URL}`
