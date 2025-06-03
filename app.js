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
