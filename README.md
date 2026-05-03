# IPO Netlify Blobs Tool

## 部署方式

推荐用 GitHub 连接 Netlify 部署整个文件夹：

```text
ipo-netlify-blobs/
  index.html
  package.json
  netlify.toml
  netlify/
    functions/
      ipo-db.mjs
      initial-data.mjs
```

Netlify 会自动安装 `@netlify/blobs`，并把 `netlify/functions/ipo-db.mjs` 部署为：

```text
/.netlify/functions/ipo-db
```

## 管理密码

建议在 Netlify 项目中设置环境变量：

```text
IPO_DB_TOKEN=你自己的管理密码
```

设置位置：

```text
Project configuration -> Environment variables
```

设置后，页面里填写同样的管理密码，才能执行“生成本周 TSV 并加入线上数据库”和“清理重复公司”。

如果不设置 `IPO_DB_TOKEN`，工具仍然能写入 Blobs，但任何知道网址的人都可以改数据库。

## 数据库

线上数据存储在 Netlify Blobs：

```text
store: ipo-tool-db
key: rolling-database
```

首次打开函数时，如果 Blobs 为空，会用 `initial-data.mjs` 里的固定模板数据初始化。

如果早期版本曾经初始化出空白行，重新部署修复版后，在页面里填写管理密码并点击：

```text
重置为固定模板
```

即可把 Blobs 里的数据库恢复成 `initial-data.mjs` 的固定模板数据。
