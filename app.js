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
const CryptoJS = require("crypto-js");

// IMPORTANT: Use environment variable in production for ENCRYPTION_KEY
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "your-super-secret-key-for-token-encryption";

// Add multer for file uploads
const multer = require('multer');

// 如果需要同时调用 Google Tasks API，请在此一并加入 tasks 范围
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/tasks'
];

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

let oAuth2Client = null;

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, __dirname); // Save in the root directory
  },
  filename: function (req, file, cb) {
    cb(null, 'credentials.json'); // Save as credentials.json
  }
});
const upload = multer({ storage: storage });

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
    try {
      const encryptedTokenContent = fs.readFileSync(TOKEN_PATH, 'utf8');
      const bytes = CryptoJS.AES.decrypt(encryptedTokenContent, ENCRYPTION_KEY);
      const decryptedTokenContent = bytes.toString(CryptoJS.enc.Utf8);

      if (!decryptedTokenContent) {
        // This can happen if the key is wrong or the content is not valid ciphertext
        throw new Error("Decryption resulted in empty content. Key might be wrong or data corrupted.");
      }

      oAuth2Client.setCredentials(JSON.parse(decryptedTokenContent));
      console.log('[OAuth] Loaded and decrypted token.json. OAuth2 client authorized.');
      startPolling();
    } catch (decErr) {
      console.error(`[OAuth] Error decrypting token.json: ${decErr.message}. Deleting potentially corrupted token. Please re-authorize.`);
      try {
        fs.unlinkSync(TOKEN_PATH); // Delete corrupted or non-decryptable token
      } catch (unlinkErr) {
        console.error(`[OAuth] Error deleting corrupted token.json: ${unlinkErr.message}`);
      }
      // Generate new auth URL as token is now gone/invalid
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
      });
      console.log('Please visit the following URL in your browser to re-authorize:');
      console.log(authUrl);
      console.log('\nAfter authorization, you will be redirected to: http://localhost:3000/oauth2callback?code=XXXX');
    }
  } else {
    // No token.json, generate auth URL
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

    try {
        const encryptedTokens = CryptoJS.AES.encrypt(JSON.stringify(tokens), ENCRYPTION_KEY).toString();
        fs.writeFileSync(TOKEN_PATH, encryptedTokens); // Save encrypted data
        console.log('[OAuth] 授权成功，已将 token 保存至 token.json (encrypted)。');
        res.send('授权成功！你可以关闭此页面。');
        // 立即启动轮询
        startPolling();
    } catch (encErr) {
        console.error('[OAuth] Error encrypting token:', encErr);
        res.status(500).send('授权失败，无法加密凭证，请查看服务器日志。');
        return;
    }

  } catch (err) {
    console.error('[OAuth] 通过 code 换取 token 时出错：', err.message);
    // Check if the error is related to the token request itself, not our encryption
    if (!res.headersSent) {
        res.status(500).send('授权失败，请查看服务器日志。');
    }
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

        // Load rules
        let rules = [];
        try {
            const rulesContent = fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8');
            rules = JSON.parse(rulesContent).rules;
        } catch (err) {
            console.error(`[Rules] Error reading rules.json: ${err.message}. Proceeding without external rules.`);
        }

        // Initialize action flags for each message
        let labelsToAdd = [];
        let labelsToRemove = []; // UNREAD will be added later if no other actions dictate it
        let shouldCreateMemo = false;
        // let shouldArchive = false; // This can be inferred from 'INBOX' in labelsToRemove

        // 3. Apply rules from rules.json
        for (const rule of rules) {
            let conditionMet = false;
            const ruleCondition = rule.condition;
            if (ruleCondition.from && from.toLowerCase().includes(ruleCondition.from.toLowerCase())) {
                conditionMet = true;
            }
            if (ruleCondition.subjectContains && subject.toLowerCase().includes(ruleCondition.subjectContains.toLowerCase())) {
                conditionMet = true;
            }
            if (ruleCondition.bodyContains && bodyText.toLowerCase().includes(ruleCondition.bodyContains.toLowerCase())) {
                conditionMet = true;
            }

            if (conditionMet) {
                console.log(`   [Rules] Email ID=${msgId} matched rule:`, ruleCondition);
                if (rule.actions.addLabelIds) {
                    labelsToAdd = [...new Set([...labelsToAdd, ...rule.actions.addLabelIds])];
                }
                if (rule.actions.removeLabelIds) {
                    labelsToRemove = [...new Set([...labelsToRemove, ...rule.actions.removeLabelIds])];
                }
                if (rule.actions.createMemo) {
                    shouldCreateMemo = true;
                }
            }
        }

        // 4. 生成备忘录 (if needed)
        if (shouldCreateMemo) {
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
            }
        }

        // 5. 统一执行邮件修改 (add labels, remove labels including UNREAD)
        let finalLabelIdsToAdd = [];
        if (labelsToAdd.length > 0) {
            const gmailClientForLabels = getGmailClient();
            const labelListRes = await gmailClientForLabels.users.labels.list({ userId: 'me' });
            const googleLabels = labelListRes.data.labels || [];
            for (const labelNameToAdd of labelsToAdd) {
                let foundLabel = googleLabels.find(l => l.name.toLowerCase() === labelNameToAdd.toLowerCase());
                if (foundLabel) {
                    finalLabelIdsToAdd.push(foundLabel.id);
                } else {
                    try {
                        console.log(`   [标签] Label "${labelNameToAdd}" not found, creating it.`);
                        const createdLabel = await gmailClientForLabels.users.labels.create({
                            userId: 'me',
                            requestBody: { name: labelNameToAdd, labelListVisibility: 'labelShow', messageListVisibility: 'show' }
                        });
                        finalLabelIdsToAdd.push(createdLabel.data.id);
                        console.log(`   [标签] Created new label "${labelNameToAdd}" with ID ${createdLabel.data.id}`);
                    } catch (createLabelError) {
                        console.error(`   [标签] Failed to create label "${labelNameToAdd}": ${createLabelError.message}`);
                    }
                }
            }
        }

        // Ensure 'UNREAD' is always in labelsToRemove unless other rules dictate otherwise
        // and it's not explicitly kept by some advanced rule (not implemented here)
        if (!labelsToRemove.includes('UNREAD')) {
             labelsToRemove.push('UNREAD');
        }

        // Deduplicate finalLabelIdsToAdd and labelsToRemove
        finalLabelIdsToAdd = [...new Set(finalLabelIdsToAdd)];
        labelsToRemove = [...new Set(labelsToRemove)];

        if (finalLabelIdsToAdd.length > 0 || labelsToRemove.length > 0) {
            console.log(`   [Modify] Applying actions to Email ID=${msgId}: AddLabels: [${labelsToAdd.join(', ')} (IDs: ${finalLabelIdsToAdd.join(',')})], RemoveLabels: [${labelsToRemove.join(', ')}]`);
            try {
                await gmail.users.messages.modify({
                    userId: 'me',
                    id: msgId,
                    requestBody: {
                        addLabelIds: finalLabelIdsToAdd,
                        removeLabelIds: labelsToRemove
                    }
                });
                if (labelsToRemove.includes('UNREAD')) console.log(`   [状态] 已标记为已读。`);
                if (labelsToRemove.includes('INBOX')) console.log(`   [归档] 已归档（移出收件箱）。`);
                if (finalLabelIdsToAdd.length > 0) console.log(`   [标签] 已应用标签: ${labelsToAdd.join(', ')}`);

            } catch (modifyErr) {
                console.error(`   [Modify] Error modifying email ID=${msgId}: ${modifyErr.message}`);
            }
        } else {
             // This case should ideally not be hit if UNREAD is always added to labelsToRemove
            console.log(`   [状态] No specific rule actions for Email ID=${msgId}, ensuring it's marked as read.`);
             await gmail.users.messages.modify({
                userId: 'me',
                id: msgId,
                requestBody: {
                    removeLabelIds: ['UNREAD'] // Default action: mark as read
                }
            });
            console.log(`   [状态] 已标记为已读。`);
        }
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

// Add the new endpoint for uploading credentials
app.post('/upload-credentials', upload.single('credentialsFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }
  // File is saved as credentials.json by multer
  console.log('[Upload] credentials.json uploaded successfully.');
  try {
    // Re-initialize OAuth2 client with new credentials
    if (oAuth2Client) {
        oAuth2Client = null; // Reset the client
    }
    loadCredentials(); // Load the new credentials

    // If a token already exists, it might be for the old credentials.
    // It's safer to remove the old token and re-authorize.
    if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
        console.log('[Upload] Removed existing token.json. Please re-authorize.');
    }

    authorize(); // Start authorization process (will generate new auth URL if no token)

    res.json({ message: 'Credentials uploaded successfully. Please check console for authorization URL if needed.' });
  } catch (error) {
    console.error('[Upload] Error processing new credentials:', error);
    res.status(500).json({ message: 'Error processing new credentials.' });
  }
});

// Add a simple GET endpoint for the HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  let gmailClientOk = false;
  if (oAuth2Client && oAuth2Client.credentials && oAuth2Client.credentials.access_token) {
    // Basic check: client exists and has an access token (doesn't verify token validity against Google)
    gmailClientOk = true;
  }

  const healthStatus = {
    status: "ok",
    timestamp: new Date().toISOString(),
    checks: {
      application: "running",
      gmailClientInitialized: oAuth2Client !== null,
      gmailClientAuthorized: gmailClientOk
    }
  };

  if (gmailClientOk) {
    res.status(200).json(healthStatus);
  } else if (oAuth2Client === null) {
    healthStatus.status = "error";
    healthStatus.checks.application = "partially_running";
    healthStatus.message = "Gmail client not loaded. Credentials might be missing.";
    res.status(503).json(healthStatus);
  }
  else {
     healthStatus.status = "error";
    healthStatus.checks.application = "partially_running";
    healthStatus.message = "Gmail client not authorized. Token might be missing or invalid. Please check logs or try re-authorizing.";
    res.status(503).json(healthStatus);
  }
});
