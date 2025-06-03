以下方案基于 **Gmail API + 自建后端**，通过\*\*轮询（Polling）\*\*的方式定期检测并处理 Gmail 邮件，实现自动打标签、归档、生成备忘录等功能。方案不包含推送（Push）相关内容，仅聚焦于轮询机制。整套流程可分为以下几个部分：

1. 准备工作
2. 后端架构与环境搭建
3. OAuth2 授权流程（获取并保存 Token）
4. 轮询逻辑：定时拉取未读邮件并处理
5. 处理流程示例：打标签、归档、生成备忘录
6. 错误处理与优化要点
7. 部署与运维注意事项

---

## 一、准备工作

1. **创建 Google Cloud 项目并启用 Gmail API**

   * 登录 [Google Cloud Console](https://console.cloud.google.com/)。
   * 新建一个项目（或使用已有项目），进入 “APIs & Services → Library” 页，搜索并启用 “Gmail API”。
   * 进入 “APIs & Services → OAuth 同意屏幕（OAuth consent screen）”：

     * 选择用户类型（若仅自己使用，可选“内部”或“测试用户”），填写应用名称、支持邮箱、开发者联系邮箱。
     * 在“范围（Scopes）”里至少添加：

       ```
       https://www.googleapis.com/auth/gmail.modify
       ```

       该范围允许对用户 Gmail 邮箱进行“读写并修改标签”的操作。
     * 保存并将自己的 Google 账号加入“测试用户”列表。

2. **创建 OAuth2 客户端 ID**

   * 在 “APIs & Services → Credentials” 下点击 “Create Credentials → OAuth client ID”。
   * 选择应用类型：

     * 如果后端是在本地调试，可选 “Desktop app”；
     * 如果部署为网络服务（会有回调 URL），可选 “Web application”，并在“Authorized redirect URIs”中填写如：

       ```
       http://localhost:3000/oauth2callback
       ```
   * 创建后会生成一份 `credentials.json`，其中包含 `client_id`、`client_secret`、`redirect_uris` 等信息。将此文件下载并保存在后端项目中（**切勿泄露到公共仓库**）。

3. **本地测试环境准备**

   * 确保已安装 Node.js（建议 v14+）并能正常运行。
   * 准备一个空目录作为项目根目录。

---

## 二、后端架构与环境搭建

本示例以 **Node.js + Express** 为后端技术栈。你也可以按需选择 Python/Flask、Java/Spring 等，但整体思路相同。

### 2.1 项目目录结构

假设项目根目录为 `gmail-polling-app/`，其主要文件及目录如下：

```
gmail-polling-app/
├── credentials.json        # 从 Google Cloud 下载的 OAuth2 client_id & client_secret
├── token.json              # 存储用户授权后获取到的 access_token & refresh_token（首次运行后自动生成）
├── package.json            # Node.js 依赖配置
├── package-lock.json       # 由 npm 自动生成
├── app.js                  # 主入口文件，包含 OAuth 流程和轮询逻辑
└── utils/
    └── gmailHelper.js      # 封装 Gmail API 相关操作（可选）
```

### 2.2 依赖安装

在项目根目录下执行：

```bash
npm init -y
npm install express googleapis body-parser
```

* `express`：搭建 HTTP 服务，用于完成 OAuth 回调等。
* `googleapis`：Google 官方提供的 Node.js 客户端库，用于与 Gmail API 通信。
* `body-parser`：用于解析请求体（JSON / URL-encoded）。

最终 `package.json` 中会类似：

```jsonc
{
  "name": "gmail-polling-app",
  "version": "1.0.0",
  "description": "Gmail API 轮询示例，通过 Node.js + Express 实现自动打标签、归档、生成备忘录",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "dependencies": {
    "body-parser": "^1.20.0",
    "express": "^4.18.2",
    "googleapis": "^115.0.0"
  }
}
```

### 2.3 参数与环境变量

* `credentials.json`：包含了 `client_id`、`client_secret`、`redirect_uris`，必须置于项目根目录。
* `token.json`：由程序在首次成功授权后生成，包含 `access_token`、`refresh_token` 等信息。
* 如需配置：可通过环境变量（或某个配置文件）指定轮询间隔、日志级别等，例如：

  ```bash
  export POLLING_INTERVAL_MIN=1    # 轮询间隔（单位：分钟），如果不指定，默认为 1 分钟
  export PORT=3000                # Express 服务监听端口
  ```

---

## 三、OAuth2 授权流程（获取并保存 Token）

首先，我们需要让用户完成 OAuth2 授权，将 `access_token` 和 `refresh_token` 保存到本地（token.json）或数据库，以便后续脚本可直接复用，不必每次都打开浏览器授权。

### 3.1 载入 `credentials.json` 并创建 OAuth2 客户端

在 `app.js` 中，首先读取 `credentials.json`，并初始化一个 `google.auth.OAuth2` 实例：

```javascript
// app.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const {google} = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

let oAuth2Client = null;

// 1. 读取 credentials.json，初始化 OAuth2 客户端
function loadCredentials() {
  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    const credentials = JSON.parse(content);
    // credentials 可能是 { installed: { client_id, client_secret, redirect_uris } }
    // 或者 { web: { client_id, client_secret, redirect_uris } }
    const {client_id, client_secret, redirect_uris} = credentials.installed || credentials.web;
    oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );
  } catch (err) {
    console.error('读取 credentials.json 失败，请检查文件路径和格式。', err);
    process.exit(1);
  }
}
```

### 3.2 检查 `token.json`，如不存在则引导用户授权

```javascript
// app.js（续）
/**
 * 如果 token.json 已存在，则加载并设置到 oAuth2Client；
 * 否则，生成一个授权 URL 并在控制台输出，用户复制后访问即可完成授权。
 */
function authorize() {
  if (fs.existsSync(TOKEN_PATH)) {
    // 已有 token.json，直接加载
    const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf8');
    oAuth2Client.setCredentials(JSON.parse(tokenContent));
    console.log('已加载 token.json，OAuth2 客户端已授权。');
    // 授权成功后，开始轮询逻辑
    startPolling();
  } else {
    // 没有 token.json，需要用户手动授权
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',       // 获取 refresh_token
      scope: SCOPES,
    });
    console.log('请在浏览器中访问以下 URL 完成授权：');
    console.log(authUrl);
    console.log('\n授权后会跳转到一个包含 code 的 URI，如： http://localhost:3000/oauth2callback?code=XXXX');
  }
}
```

### 3.3 搭建 Express 路由，处理 OAuth2 回调并保存 `token.json`

还需要在 `app.js` 中加上一个 `/oauth2callback` 路由，用来接收 Google 授权服务器发回的授权码 `code`，然后用它换取 `access_token` 和 `refresh_token`，并将它存到 `token.json` 里：

```javascript
// app.js（续）
const app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    res.status(400).send('缺少授权码 (code)。');
    return;
  }

  try {
    const {tokens} = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    // 将获取到的 token 写入本地文件
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('授权成功，已将 token 保存至 token.json。');
    res.send('授权成功！你可以关闭此页面。');

    // 授权完成后，启动轮询处理
    startPolling();
  } catch (err) {
    console.error('通过 code 换取 token 时出错：', err);
    res.status(500).send('授权失败，请查看服务器日志。');
  }
});
```

### 3.4 启动 Express 服务并调用 `authorize()`

在 `app.js` 最末尾，启动 HTTP 服务器，监听指定端口，然后调用 `loadCredentials()` 与 `authorize()`：

```javascript
// app.js（续）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器已启动，监听端口 ${PORT}。`);
  loadCredentials();
  authorize();
});
```

此时，如果第一次运行 `node app.js`：

* 控制台会输出一条指导用户访问的授权 URL。
* 用户在浏览器中访问该 URL，登录 Google 并同意授权后，会跳转到 `http://localhost:3000/oauth2callback?code=...`，最终在网页上看到 “授权成功！你可以关闭此页面。”
* 同时，服务器会把换取到的 `tokens` （包含 `access_token`、`refresh_token`、失效时间等信息）保存到 `token.json`，并立即调用 `startPolling()`。
* 此后再次重启服务器，就可以直接加载 `token.json`，无需再次授权（除非用户主动在 Google 安全设置中撤销了授权）。

---

## 四、轮询逻辑：定时拉取未读邮件并处理

当 OAuth 客户端已经具备有效凭证后（`oAuth2Client` 中包含可用的 `access_token`，且会自动使用 `refresh_token` 刷新过期的 Token），我们就可以使用 Gmail API 来周期性地获取“收件箱里所有未读邮件”，并对其进行自定义处理（打标签、归档、生成备忘录等）。整个轮询的核心流程如下：

1. 设置一个定时器（例如 `setInterval`），每隔一段时间（如 1 分钟）执行一次拉取/处理逻辑。
2. 在拉取时，调用：

   ```js
   gmail.users.messages.list({
     userId: 'me',
     q: 'in:inbox is:unread',
     maxResults: 50       // 最多一次取 50 条记录（可根据需求调整，但一般不宜过大）
   });
   ```

   该接口返回的是一组邮件 ID。
3. 遍历这些邮件 ID，逐条调用：

   ```js
   gmail.users.messages.get({
     userId: 'me',
     id: messageId,
     format: 'full'
   });
   ```

   以获取邮件的完整信息（包含所有 Header、Body-part、标签等）。
4. 对解析出来的邮件做自定义判断（如发件人是否在某个白名单、主题是否包含关键词、正文是否匹配某条规则）。根据判断结果，决定是否要：

   * **打标签**（调用 `gmail.users.messages.modify`，在 `addLabelIds` 中指定已有或新建标签 ID；）
   * **归档**（在 `modify` 时，将 `removeLabelIds: ['INBOX']`，即可把邮件从收件箱移除；）
   * **标记已读/星标/删除** 等；
   * **生成备忘录**（下面会示例如何调用 Google Tasks API 或写入自建数据库）。
5. 最后，务必将该邮件标记为“已读”（`removeLabelIds: ['UNREAD']`），以防止下次轮询重复处理同一邮件。

### 4.1 在 `app.js` 中实现 `startPolling()` 函数

以下代码示例演示了一个完整的轮询流程。假设在项目根目录已安装并引入了 `googleapis`：

```javascript
// app.js（续：在 loadCredentials() 与 authorize() 之后定义）

/**
 * 获取 Gmail 客户端实例
 */
function getGmailClient() {
  return google.gmail({version: 'v1', auth: oAuth2Client});
}

/**
 * 解析邮件的纯文本正文（递归处理 multipart）
 */
function extractPlainText(payload) {
  if (!payload) return '';

  // 如果是单个 part，且是 text/plain，就直接返回解码后的内容
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    const buff = Buffer.from(payload.body.data, 'base64');
    return buff.toString('utf8');
  }

  // 如果有多个子 part，则递归查找 text/plain
  if (payload.parts && payload.parts.length) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }

  return '';
}

/**
 * 轮询并处理未读邮件
 */
async function pollAndProcess() {
  const gmail = getGmailClient();

  try {
    // 1. 拉取收件箱中最新的 50 封“未读”邮件
    const resList = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox is:unread',
      maxResults: 50
    });

    const messages = resList.data.messages || [];
    if (messages.length === 0) {
      console.log(`[${new Date().toISOString()}] 没有未读邮件。`);
      return;
    }

    console.log(`[${new Date().toISOString()}] 检测到 ${messages.length} 封未读邮件，开始逐条处理。`);

    // 2. 遍历邮件 ID
    for (const msgInfo of messages) {
      const msgId = msgInfo.id;

      try {
        // 3. 获取邮件详情
        const resGet = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'full'   // “full” 格式可以拿到所有 header & parts
        });

        const msg = resGet.data;
        const headers = msg.payload.headers;
        // 从 headers 中提取 Subject、From、Date 等信息
        const subjectHeader = headers.find(h => h.name === 'Subject');
        const fromHeader = headers.find(h => h.name === 'From');
        const dateHeader = headers.find(h => h.name === 'Date');

        const subject = subjectHeader ? subjectHeader.value : '(无主题)';
        const from = fromHeader ? fromHeader.value : '(未知发件人)';
        const dateStr = dateHeader ? dateHeader.value : '';
        const snippet = msg.snippet || '';
        const bodyText = extractPlainText(msg.payload);

        console.log(`-- 处理邮件：ID=${msgId}`);
        console.log(`   发件人：${from}`);
        console.log(`   主题：${subject}`);
        console.log(`   日期：${dateStr}`);
        // console.log(`   摘要：${snippet}`);
        // console.log(`   正文（前200字）：${bodyText.substring(0, 200)}...`);

        // 4. 根据业务逻辑判断：示例规则
        let needArchive = false;
        let needLabelVIP = false;
        let needCreateMemo = false;

        // 示例一：如果发件人是 boss@example.com，就打 VIP 标签并归档
        if (/boss@example\.com/i.test(from)) {
          needArchive = true;
          needLabelVIP = true;
        }

        // 示例二：如果正文包含 “提醒” 或 “待办” 等关键词，就生成待办备忘录
        if (/提醒|待办/.test(bodyText)) {
          needCreateMemo = true;
        }

        // TODO：在此处可根据实际需求，加入更多自定义规则

        // 5. 如果需要打“VIP”标签，先确保该标签存在，不存在就创建
        let vipLabelId = null;
        if (needLabelVIP) {
          // 5.1 获取已有标签列表，看看是否存在 “VIP”
          const labelRes = await gmail.users.labels.list({userId: 'me'});
          const allLabels = labelRes.data.labels || [];
          const vipLabelObj = allLabels.find(l => l.name === 'VIP');

          if (vipLabelObj) {
            vipLabelId = vipLabelObj.id;
          } else {
            // 如果没有“VIP”标签，则创建一个
            const createLabelRes = await gmail.users.labels.create({
              userId: 'me',
              requestBody: {
                name: 'VIP',
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show'
              }
            });
            vipLabelId = createLabelRes.data.id;
            console.log(`   已创建标签 “VIP”，ID=${vipLabelId}`);
          }

          // 5.2 给当前邮件添加标签
          await gmail.users.messages.modify({
            userId: 'me',
            id: msgId,
            requestBody: {
              addLabelIds: [vipLabelId]
            }
          });
          console.log(`   已为邮件添加 “VIP” 标签。`);
        }

        // 6. 如果需要归档：移除 INBOX 标签即可
        if (needArchive) {
          await gmail.users.messages.modify({
            userId: 'me',
            id: msgId,
            requestBody: {
              removeLabelIds: ['INBOX']
            }
          });
          console.log(`   已归档（移出收件箱）。`);
        }

        // 7. 如果需要生成备忘录：这里以“写入 Google Tasks”举例
        if (needCreateMemo) {
          // 7.1 首先确保已在 Google Cloud Console 中启用 “Google Tasks API”，
          //     并且在 OAuth 同意屏幕中添加了对应 scope：
          //     https://www.googleapis.com/auth/tasks

          // 7.2 由于 oAuth2Client 已经以 scope “gmail.modify” 授权，
          //     此处示例直接调用 Tasks API 可能拿不到权限，实际使用时需要在 SCOPES 中一并加入：
          //     'https://www.googleapis.com/auth/tasks'
          //     并在 OAuth 流程时重新授权。

          // （此处仅做示例，如果你决定使用 Tasks，请在 SCOPES 中加入 tasks 范围并重新授权）
          try {
            const tasks = google.tasks({version: 'v1', auth: oAuth2Client});
            const title = `邮件备忘：${subject}`;
            const notes = `发件人：${from}\n日期：${dateStr}\n\n节选正文：\n${bodyText.substring(0, 200)}...`;
            await tasks.tasks.insert({
              tasklist: '@default',
              requestBody: {
                title,
                notes,
                due: null   // 如果需要设置到期时间，可自行拼接 ISO String
              }
            });
            console.log(`   已在 Google Tasks 中创建一条任务备忘`);
          } catch (tasksErr) {
            console.warn(`   生成备忘录（Google Tasks）时出错：`, tasksErr.message);
            // 如果不想使用 Tasks，也可以改为写入自建数据库或其他第三方待办服务
          }
        }

        // 8. 最后，将该邮件标记为已读，防止下次重复处理
        await gmail.users.messages.modify({
          userId: 'me',
          id: msgId,
          requestBody: {
            removeLabelIds: ['UNREAD']
          }
        });
        console.log(`   已标记为已读。`);

      } catch (msgErr) {
        console.error(`   处理邮件 ID=${msgId} 时出错：`, msgErr.message);
        // 即使该邮件处理失败，也不要影响其他邮件的处理
      }
    }

  } catch (err) {
    console.error(`[${new Date().toISOString()}] 拉取未读邮件时出错：`, err.message);
    // 如果因 Token 过期等导致 401，可在此处做相应重试或重新授权逻辑
  }
}

/**
 * 启动轮询任务：
 *  - 轮询间隔可通过环境变量 POLLING_INTERVAL_MIN 指定，默认 1 分钟
 */
function startPolling() {
  const intervalMin = parseInt(process.env.POLLING_INTERVAL_MIN) || 1;
  const intervalMs = intervalMin * 60 * 1000;
  console.log(`已启动轮询任务，每 ${intervalMin} 分钟检查一次未读邮件。`);
  // 立即执行一次
  pollAndProcess();
  // 然后每隔 intervalMs 继续执行
  setInterval(pollAndProcess, intervalMs);
}
```

**说明：**

* `extractPlainText(payload)`：递归遍历 `payload.parts`，优先取出 `mimeType === 'text/plain'` 的文本内容。如果邮件只有 `text/html`，可基于此再做 HTML 转纯文本，但上例为简化起见只取纯文本。
* 在判断逻辑部分（第 4 步），可根据需要自定义任意规则，包括发件人白名单、主题匹配正则、正文关键词、附件类型等。
* “生成备忘录”示例使用了 Google Tasks API，需要在 `SCOPES` 中加入 `'https://www.googleapis.com/auth/tasks'`，并让用户重新授权一次（以便获取 tasks 范围的权限）。如果不想用 Google Tasks，也可改为写入自建数据库、调用第三方待办服务的 RESTful API。
* 每封邮件处理完毕后，务必执行 `removeLabelIds: ['UNREAD']`，否则下次轮询会再次拉到相同的邮件，重复处理。

---

## 五、处理流程示例详解

以下展开说明第 4 节中“根据邮件内容做判断并执行操作”的常见做法与注意事项。

### 5.1 常见判断逻辑示例

1. **发件人规则**

   * **白名单**：如 `boss@example.com`、`hr@company.com` 等，符合即优先处理。

     ```js
     if (/boss@example\.com/i.test(from)) {
       // 标记 VIP、归档
     } else if (/hr@company\.com/i.test(from)) {
       // 标记 HR、生成备忘录
     }
     ```
   * **黑名单/垃圾邮件**：如发件人包含某些域名或 IP 段时，直接删除或标记为垃圾。

     ```js
     if (/@spamdomain\.com$/i.test(from)) {
       // 直接放到垃圾箱
       await gmail.users.messages.modify({
         userId: 'me',
         id: msgId,
         requestBody: { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] }
       });
       continue; // 跳过后续判断
     }
     ```

2. **主题规则**

   * 主题以 `[重要]`、`[通知]` 开头自动打标签：

     ```js
     if (/^\[重要\]/.test(subject)) {
       needLabelImportant = true;
     } else if (/^\[通知\]/.test(subject)) {
       needLabelNotification = true;
     }
     ```
   * 主题中包含某些关键词（如“发票”、“报销”）时归档到对应文件夹（标签）：

     ```js
     if (/发票|报销/.test(subject)) {
       needLabelInvoice = true;    // “发票”标签
       needArchive = true;
     }
     ```

3. **正文规则**

   * 正文中含关键字“提醒”、“待办”、“会议”等时，自动在备忘录里生成待办：

     ```js
     if (/提醒|待办|会议/.test(bodyText)) {
       needCreateMemo = true;
     }
     ```
   * 结合正则+大小写忽略、关键词组合、甚至简单的 NLP 处理，如果要更精细可引入第三方自然语言处理服务，不过对多数场景来说，用正则匹配足够。

4. **标签与归档**

   * **打标签**：

     * 首先调用 `gmail.users.labels.list` 拉取现有标签列表，判断目标标签是否存在；
     * 如果不存在，则调用 `gmail.users.labels.create` 创建；
     * 最后调用 `gmail.users.messages.modify` 的 `addLabelIds` 字段，将标签 ID 加到邮件上。
   * **归档**：

     * 归档的本质就是移除邮件的 `INBOX` 标签，因此只需：

       ```js
       await gmail.users.messages.modify({
         userId: 'me',
         id: msgId,
         requestBody: { removeLabelIds: ['INBOX'] }
       });
       ```
   * **标记已读**：

     * 同样使用 `modify`，执行：

       ```js
       await gmail.users.messages.modify({
         userId: 'me',
         id: msgId,
         requestBody: { removeLabelIds: ['UNREAD'] }
       });
       ```
   * 如果要**同时**做“打标签、归档、标记已读”，可以把这些操作合并到一次 `modify` 调用中，例如：

     ```js
     await gmail.users.messages.modify({
       userId: 'me',
       id: msgId,
       requestBody: {
         addLabelIds: [labelId1, labelId2],
         removeLabelIds: ['INBOX', 'UNREAD']
       }
     });
     ```

### 5.2 生成备忘录的可选机制

在第 4 节里，我们仅示例了“往 Google Tasks 插入一条任务”的做法。这里再补充几种常见的生成备忘录（或待办）方式，供参考：

1. **Google Tasks API**

   * 在 `SCOPES` 中加入：

     ```
     'https://www.googleapis.com/auth/tasks'
     ```
   * OAuth 授权时一并让用户同意该范围。
   * 直接调用：

     ```js
     const tasks = google.tasks({version: 'v1', auth: oAuth2Client});
     await tasks.tasks.insert({
       tasklist: '@default',
       requestBody: {
         title: '邮件待办：' + subject,
         notes: `发件人：${from}\n内容摘要：${bodyText.substring(0,200)}...`,
         due: null  // 如需设置到期时间，可拼接 ISO String
       }
     });
     ```

2. **写入自建数据库（MySQL/SQLite/PostgreSQL 等）+ 前端展示**

   * 后端在解析到需要“生成备忘录”时，将标题、发件人、摘要、日期等字段插入数据库表（如 `memos`）。
   * 并在项目中提供一个简单的前端（或单纯的 RESTful API），让用户可以访问 `/memos`，查看所有待办列表，标记完成或删除。
   * 示例数据库表结构（MySQL）：

     ```sql
     CREATE TABLE memos (
       id INT AUTO_INCREMENT PRIMARY KEY,
       subject VARCHAR(255),
       sender VARCHAR(255),
       snippet TEXT,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       is_done TINYINT(1) DEFAULT 0
     );
     ```
   * 插入示例（Node.js + mysql2）：

     ```js
     // 假设已使用 mysql2 创建了 pool
     const title = subject;
     const sender = from;
     const snippet = bodyText.substring(0, 200) + '...';
     await dbPool.execute(
       'INSERT INTO memos (subject, sender, snippet) VALUES (?, ?, ?)',
       [title, sender, snippet]
     );
     ```

3. **调用第三方待办/笔记服务（如 Todoist、Notion、企业微信待办等）**

   * 如果你想统一使用第三方待办工具（例如 Todoist），需要先申请 Todoist 的 API Token，然后在后端调用其 “添加任务” 接口。
   * 以 Todoist 为例（伪代码）：

     ```js
     const fetch = require('node-fetch');
     const TODOIST_TOKEN = '你的_todoist_api_token';

     if (needCreateMemo) {
       const res = await fetch('https://api.todoist.com/rest/v1/tasks', {
         method: 'POST',
         headers: {
           'Authorization': `Bearer ${TODOIST_TOKEN}`,
           'Content-Type': 'application/json'
         },
         body: JSON.stringify({
           content: `邮件待办：${subject}`,
           description: `发件人：${from}\n${bodyText.substring(0,200)}...`
         })
       });
       if (!res.ok) {
         console.warn('向 Todoist 创建任务失败：', await res.text());
       } else {
         console.log('已在 Todoist 创建任务');
       }
     }
     ```

### 5.3 轮询频率与配额控制

* Google 默认给 Gmail API 分配了每天数十万次的调用额度（如 1,000,000 个点/天），具体可在 [配额页面](https://console.cloud.google.com/apis/api/gmail.googleapis.com/quotas) 查看。
* 常见做法是：每隔 1 分钟做一次 `messages.list`。如果处理逻辑简单，且每次消息数不多，不会轻易耗尽配额。
* 但若你有大量用户（几百/几千账号）同时轮询，就需要：

  1. **增量拉取**：记录上次处理的 `historyId`，使用 Gmail 的 `history.list` 接口，通过 `startHistoryId` 参数只获取“历史变更”（新增邮件、标签变更等），从而减少重复调用 `list`/`get`。不过这会稍微更复杂一些；
  2. **减少轮询频率**：如改为每 5 分钟或 10 分钟一次，看业务需求是否能容忍延迟；
  3. **批量请求**：用 Google API 客户端库的批量请求功能（`batch`）一次性并发拉取多条 `messages.get`，减少 HTTP 连接开销；
  4. **使用 OAuth2 token 池**：对于多用户场景，尽量复用客户端实例，批量处理时并行但限流，以免瞬时并发过大。

本方案以“单账号”示例为主，若后续需要支持多用户，只需将 `token.json` 换成“用户 ID 对应 token 信息”的数据库存储，然后循环遍历所有已授权用户，依次调用各自的 `oAuth2Client.setCredentials(...)` 并执行同样的 `pollAndProcess()` 逻辑即可。

---

## 六、错误处理与优化要点

1. **Token 失效/刷新失败**

   * `access_token` 默认有效期 1 小时，后端在调用任何 Gmail API 时，`googleapis` 会自动检测过期并尝试使用 `refresh_token` 刷新。
   * 如果 `refresh_token` 失效（例如用户在 Google 帐号安全设置中撤销授权），后端会在 API 调用时抛出 401 错误。此时需捕获并记录日志，提醒用户“请重新授权”。
   * 推荐做法：在捕获到类似 `err.code === 401` 或 `err.message.includes('invalid_grant')` 时，让该账号进入“授权失效状态”，并发送邮件/日志告知管理员或用户，让其重新完成 OAuth 流程。

2. **API 调用频率限制（配额）**

   * 如果你发现日志中出现 “Quota exceeded” 相关错误，则需要：

     * 降低轮询频率（如从 1 分钟改为 5 分钟或更长）；
     * 使用 `history.list` 增量拉取代替全量 `messages.list`；
     * 对高峰期并发做限流/队列。

3. **邮件解析不完整**

   * 由于 Gmail API 的 payload 结构可能非常复杂，尤其含有附件、图片、富文本时，单纯调用 `extractPlainText` 有可能拿不到用户真正想看的正文。
   * 常见做法：

     * 先查找 `mimeType === 'text/plain'`；若不存在，再尝试解析 `text/html`，使用 `html-to-text` 之类的库把 HTML 转为纯文本。
     * 如果正文过大，仅取前几百字做关键词匹配/标记。

4. **标签命名冲突**

   * 当调用 `gmail.users.labels.create` 时，如果同名标签已存在，API 会返回 409；因此最安全的方式是先 `labels.list`，确认不存在后再创建。
   * 若想对已存在同名但大小写不同的标签做统一管理，可在项目初次运行时强制创建一次，比如把标签名都转为大写或小写，再在后续代码里统一使用它的 ID。

5. **日志与监控**

   * 建议在关键步骤（如获取邮件列表、处理单封邮件、打标签、归档、生成备忘录）都打上包含时间戳的日志，以便排查问题。
   * 生产环境可将日志输出到文件或第三方日志服务（如 ELK、Stackdriver Logging），方便查看。

6. **多账号支持**

   * 如果后期要支持多个用户同时使用，需要将 `token.json` 替换为“**多行储存**”或“**数据库存储**”：

     * 每个用户有一条记录，包含 `userId`（自定义）、`access_token`、`refresh_token`、`scope`、`expiry_date` 等；
     * 后端轮询时，遍历所有已授权用户的记录，为每个用户都创建一个 `oAuth2Client`，并执行 `pollAndProcess()`；
     * 注意并发时不要一次性同时拉取上千个账号，以免瞬时配额告急，应做并发限流、队列调度。

---

## 七、部署与运维注意事项

1. **部署方式**

   * **云服务器（如 VPS、阿里云 ECS、腾讯云 CVM）**：

     * 将项目代码上传，安装 Node.js，配置环境变量，直接 `npm install && npm start`。
     * 可用 `pm2`、`forever` 等工具守护进程，保证服务器重启后脚本自动启动。
   * **容器化部署（Docker + Kubernetes/Cloud Run/Heroku）**：

     * 编写 `Dockerfile`，将项目打包成镜像。
     * 部署到 Kubernetes/Google Cloud Run/Azure Container Instances/Heroku 等平台。
     * 环境变量（如 `POLLING_INTERVAL_MIN`、`PORT`）通过平台提供的方式注入。
   * **Serverless（如 AWS Lambda、GCP Cloud Run jobs 等）**：

     * 如果轮询任务并不需要常驻服务器，可考虑用定时触发器（如 GCP Cloud Scheduler + Cloud Run Job）每分钟触发一次。
     * 这种方式会在短时间内启动一个容器执行一次 `pollAndProcess()`，完成后自动退出，更节省资源。

2. **安全与凭证管理**

   * `credentials.json`、`token.json` 必须存放在受限目录，确保只有应用本身可以读取，不要直接把它们提交到公共仓库。
   * 如果用数据库存储多个用户的 Token，应对 `refresh_token` 等敏感信息加密存储或用云端 Secret Manager（如 GCP Secret Manager、AWS Secrets Manager）保管。
   * 定期检查并应对“Token 过期”或“Refresh Token 被撤销”的情况，必要时通过邮件或其他渠道提醒用户重新授权。

3. **监控与报警**

   * 建议在服务器上配置一些监控指标，比如：

     * 服务是否存活（Heartbeat）。
     * 轮询任务失败次数、最近一次失败信息。
     * Gmail API 调用配额剩余情况（可通过 Cloud Console 监控）。
   * 当侦测到“连续多次 500 错误”、“刷新 Token 失败”或“配额超限”时，应立刻报警（邮件、短信或钉钉/企业微信机器人推送）。

4. **日志轮转与存储**

   * 如果日志量较大，可用 `logrotate` 做日志轮转，限制单个日志文件大小和保存天数。
   * 也可配置将日志推送到外部日志平台（如 ELK、Graylog、Stackdriver Logging），以便留痕和归档。

5. **版本控制与持续集成**

   * 代码托管建议使用 Git，`credentials.json`、`token.json` 放在 `.gitignore` 中，避免误提交。
   * 若有多人协作，可搭建 CI/CD 流程（如 GitHub Actions、GitLab CI/CD），在推送到 `main` 分支时自动构建、测试并部署。

---

## 八、完整示例回顾

以下将上述各部分代码整合成一个完整的 `app.js` 模板，供参考与复制粘贴。生产环境时，请根据实际情况拆分模块、加上更多异常处理与日志记录。

```javascript
// app.js

/**
 * Gmail API 轮询示例（Node.js + Express）
 * 功能：
 *   1. OAuth2 授权并保存 token.json
 *   2. 每隔指定时间轮询未读邮件
 *   3. 根据邮件发件人/主题/正文执行：打标签、归档、生成备忘录（Google Tasks 示例）、标记已读
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const {google} = require('googleapis');

// 如果需要同时调用 Google Tasks API，请在此一并加入 tasks 范围
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/tasks'
];

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

let oAuth2Client = null;

// ------------------ 1. 初始化 OAuth2 客户端 ------------------

function loadCredentials() {
  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    const credentials = JSON.parse(content);
    const {client_id, client_secret, redirect_uris} = credentials.installed || credentials.web;

    oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );
  } catch (err) {
    console.error('读取 credentials.json 失败，请检查文件路径和格式。', err);
    process.exit(1);
  }
}

/**
 * 检查本地是否已有 token.json；
 *   - 如果已有，直接加载并调用 startPolling();
 *   - 否则生成授权 URL，提示用户去访问。
 */
function authorize() {
  if (fs.existsSync(TOKEN_PATH)) {
    // 已有 token.json，直接加载
    const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf8');
    oAuth2Client.setCredentials(JSON.parse(tokenContent));
    console.log('[OAuth] 已加载本地 token.json，OAuth2 客户端已授权。');
    startPolling();
  } else {
    // 没有 token.json，生成授权 URL
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log('请在浏览器中访问以下 URL 完成授权：');
    console.log(authUrl);
    console.log('\n授权后会跳转到： http://localhost:3000/oauth2callback?code=XXXX');
  }
}

// ------------------ 2. Express 处理 OAuth2 回调 ------------------

const app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    res.status(400).send('缺少授权码 (code)。');
    return;
  }
  try {
    const {tokens} = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    // 将 token 写入本地
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('[OAuth] 授权成功，已将 token 保存至 token.json。');
    res.send('授权成功！你可以关闭此页面。');
    // 立即启动轮询
    startPolling();
  } catch (err) {
    console.error('[OAuth] 通过 code 换取 token 时出错：', err.message);
    res.status(500).send('授权失败，请查看服务器日志。');
  }
});

// ------------------ 3. 轮询处理函数 ------------------

/**
 * 返回 Gmail 客户端实例
 */
function getGmailClient() {
  return google.gmail({version: 'v1', auth: oAuth2Client});
}

/**
 * 递归解析邮件纯文本正文（取第一个 text/plain 部分）
 */
function extractPlainText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  if (payload.parts && payload.parts.length) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  return '';
}

/**
 * 轮询并处理未读邮件
 */
async function pollAndProcess() {
  const gmail = getGmailClient();

  try {
    // 1. 拉取未读邮件列表
    const resList = await gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox is:unread',
      maxResults: 50
    });
    const messages = resList.data.messages || [];
    if (messages.length === 0) {
      console.log(`[${new Date().toISOString()}] 暂无未读邮件。`);
      return;
    }
    console.log(`[${new Date().toISOString()}] 检测到 ${messages.length} 封未读邮件，开始逐条处理。`);

    // 2. 遍历每封邮件
    for (const msgInfo of messages) {
      const msgId = msgInfo.id;

      try {
        // 2.1 获取邮件详情
        const resGet = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'full'
        });
        const msg = resGet.data;
        const headers = msg.payload.headers;
        const subject = (headers.find(h => h.name === 'Subject') || {}).value || '(无主题)';
        const from = (headers.find(h => h.name === 'From') || {}).value || '(未知发件人)';
        const dateStr = (headers.find(h => h.name === 'Date') || {}).value || '';
        const bodyText = extractPlainText(msg.payload);

        console.log(`-- 开始处理邮件 ID=${msgId}`);
        console.log(`   发件人：${from}`);
        console.log(`   主题：${subject}`);
        console.log(`   日期：${dateStr}`);

        // 3. 根据自定义规则判断
        let needArchive = false;
        let needLabelVIP = false;
        let needCreateMemo = false;

        // 举例：如果发件人是 boss@example.com，就打 VIP 并归档
        if (/boss@example\.com/i.test(from)) {
          needArchive = true;
          needLabelVIP = true;
        }
        // 举例：正文包含 “提醒” 字样，就生成备忘录
        if (/提醒/.test(bodyText)) {
          needCreateMemo = true;
        }

        // 4. 打标签逻辑
        let vipLabelId = null;
        if (needLabelVIP) {
          const labelRes = await gmail.users.labels.list({userId: 'me'});
          const allLabels = labelRes.data.labels || [];
          const existVIP = allLabels.find(l => l.name === 'VIP');
          if (existVIP) {
            vipLabelId = existVIP.id;
          } else {
            const createLabelRes = await gmail.users.labels.create({
              userId: 'me',
              requestBody: {
                name: 'VIP',
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show'
              }
            });
            vipLabelId = createLabelRes.data.id;
            console.log(`   [标签] 已创建 “VIP”，ID=${vipLabelId}`);
          }
          // 给邮件添加 VIP 标签
          await gmail.users.messages.modify({
            userId: 'me',
            id: msgId,
            requestBody: {
              addLabelIds: [vipLabelId]
            }
          });
          console.log(`   [标签] 已添加 “VIP”。`);
        }

        // 5. 归档操作（移除 INBOX 标签）
        if (needArchive) {
          await gmail.users.messages.modify({
            userId: 'me',
            id: msgId,
            requestBody: {
              removeLabelIds: ['INBOX']
            }
          });
          console.log(`   [归档] 已归档（移出收件箱）。`);
        }

        // 6. 生成备忘录（示例：写入 Google Tasks）
        if (needCreateMemo) {
          try {
            const tasks = google.tasks({version: 'v1', auth: oAuth2Client});
            const title = `邮件备忘：${subject}`;
            const notes = `发件人：${from}\n日期：${dateStr}\n\n正文预览：\n${bodyText.substring(0, 200)}...`;
            await tasks.tasks.insert({
              tasklist: '@default',
              requestBody: {
                title,
                notes,
                due: null
              }
            });
            console.log(`   [备忘] 已在 Google Tasks 中创建待办。`);
          } catch (tasksErr) {
            console.warn(`   [备忘] Google Tasks 创建失败：${tasksErr.message}`);
            // 如果不想用 Tasks，可改为写入数据库或调用其他第三方待办 API
          }
        }

        // 7. 标记为已读，避免重复处理
        await gmail.users.messages.modify({
          userId: 'me',
          id: msgId,
          requestBody: {
            removeLabelIds: ['UNREAD']
          }
        });
        console.log(`   [状态] 已标记为已读。`);
      } catch (msgErr) {
        console.error(`   [错误] 处理邮件 ID=${msgId} 时出错：${msgErr.message}`);
        // 即使出现错误，也不要中断对后续邮件的处理
      }
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [错误] 拉取未读邮件时失败：${err.message}`);
    // 如果因 Token 过期导致 401，可在此重新发出授权提醒
  }
}

/**
 * 启动轮询
 */
function startPolling() {
  const intervalMin = parseInt(process.env.POLLING_INTERVAL_MIN) || 1;
  const intervalMs = intervalMin * 60 * 1000;
  console.log(`[轮询] 每 ${intervalMin} 分钟检查一次未读邮件。`);
  // 立即执行一次
  pollAndProcess();
  // 之后定期执行
  setInterval(pollAndProcess, intervalMs);
}

// ------------------ 4. 启动服务器 & 授权 ------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 应用已启动，监听端口 ${PORT}`);
  loadCredentials();
  authorize();
});
```

**使用步骤：**

1. 在项目根目录放置从 GCP 下载的 `credentials.json`。
2. 运行命令：

   ```bash
   npm install
   node app.js
   ```
3. 如果 `token.json` 不存在，终端会打印一个授权 URL，复制并在浏览器打开，登录 Google 并同意授权。
4. 授权完成后，页面会提示“授权成功”，服务器端 `token.json` 会被自动生成，接着轮询任务启动，每隔 `POLLING_INTERVAL_MIN` 分钟（默认为 1）去拉取未读邮件并处理。
5. 处理逻辑包括：根据发件人匹配打“VIP”标签并归档、根据正文关键字生成 Google Tasks 备忘录、标记邮件为已读。你可以自行在 `pollAndProcess()` 中修改或扩展更多规则。

---

## 九、常见疑问与扩展思考

1. **为什么要先调用 `messages.list` 再逐条调用 `messages.get`？**

   * `messages.list` 只返回邮件 ID 及部分片段（snippet），不包含完整正文与所有 Header。
   * 如果直接调用 `messages.get`（需要提供 ID），就能拿到完整信息。因此两步结合可以先快速拉取“哪些邮件未读”，再依次拿到完整邮件详情。

2. **怎样避免重复处理同一封邮件？**

   * 核心做法：在处理完毕后，务必将邮件标记为“已读”（`removeLabelIds: ['UNREAD']`）。这样下次轮询时，`q='in:inbox is:unread'` 就不会再把它拉出来。
   * 如果还想更精细，例如“仅处理最近 24 小时内的新邮件”，可以在 `messages.list` 时加上时间筛选：

     ```js
     const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
     const q = `in:inbox is:unread after:${Math.floor(oneDayAgo.getTime() / 1000)}`;
     ```

     `after:timestamp` 中的 timestamp 单位是 Unix 秒。

3. **轮询频率如何设置更合理？**

   * 对于一般场景，1\~5 分钟一次即可。太频繁（如每 10 秒）会增加 Gmail API 调用次数，容易触发配额限制。
   * 如果对实时性要求不高，如只想在上午 9 点至下午 6 点间工作时间查看邮件，可结合当前系统时间判断是否执行轮询，非工作时间跳过。

     ```js
     function isWithinWorkingHours() {
       const hour = new Date().getHours();
       return hour >= 9 && hour < 18;
     }
     async function pollAndProcessWrapper() {
       if (isWithinWorkingHours()) {
         await pollAndProcess();
       } else {
         console.log('非工作时间，跳过本次轮询。');
       }
     }
     setInterval(pollAndProcessWrapper, intervalMs);
     ```

4. **多用户场景应该如何扩展？**

   * 将 `token.json` 换成数据库存储。每个用户一个记录，包含 `userId`（内部 ID）、`access_token`、`refresh_token`、`scope`、`expiry_date` 等。
   * 在轮询逻辑中，遍历所有已授权用户：

     ```js
     async function multiUserPolling() {
       const users = await getAllAuthorizedUsersFromDB(); // 自行实现 DB 查询
       for (const user of users) {
         const client = new google.auth.OAuth2(
           client_id, client_secret, redirect_uris[0]
         );
         client.setCredentials({
           access_token: user.accessToken,
           refresh_token: user.refreshToken,
           expiry_date: user.expiryDate
         });
         // 传入该用户专属的 oAuth2Client 去处理他的邮箱
         await pollAndProcessForClient(client, user.userId);
       }
     }
     ```
   * 需要为每个用户维护一个独立的 Gmail Label（如“VIP-<userId>”）或设计为“通用”标签。
   * 并发处理时要控制并发量，避免同时向 Gmail API 发起过多并发请求。可使用 `Promise.allSettled`，或更稳健的做法是在每次轮询时限制同时处理用户数，比如 `p-limit`、`async.queue` 等限流组件。

---

## 十、小结

* 本文示例了如何使用 **Gmail API + Node.js/Express 后端**，通过 **轮询（Polling）** 的方式定期拉取 Gmail 中“收件箱里所有未读邮件”，并根据自定义规则对邮件执行“打标签、归档、生成备忘录、标记已读”等操作。

* 方案重点：

  1. **OAuth2 授权**：首次需用户手动访问授权 URL，将 `access_token` 与 `refresh_token` 保存到本地或数据库，以便后续自动刷新。
  2. **轮询逻辑**：使用 `setInterval` 每隔（默认） 1 分钟执行一次 `messages.list` + `messages.get`，获取所有新邮件。
  3. **邮件处理**：根据发件人、主题、正文等信息匹配业务规则，调用 `messages.modify` 做标签与归档；调用 Google Tasks API 或自建数据库生成备忘录。
  4. **状态更新**：处理完毕后务必将邮件标记为已读，避免重复处理。
  5. **部署与运维**：可部署在云服务器、容器或 Serverless 环境，定期监控 Token 有效性、API 配额、轮询失败率等。

* 这种“轮询”方式实现相对简单、逻辑直观，但与“Push 通知”相比会有 1\~5 分钟左右的延迟。若业务对实时性要求不高，轮询是最易于实现且稳定成熟的方案。后续若有推送需求，可在此基础上改为 Gmail Push + Pub/Sub + Web Push / FCM 等机制；但仅针对轮询，本文已做完整覆盖。

希望此“完整方案”能让你快速上手，搭建出基于 Node.js 后端的 Gmail 自动化处理系统。如有更多细节疑问，欢迎随时交流！
