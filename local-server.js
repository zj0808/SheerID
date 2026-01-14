const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const CONFIG = {
  PROGRAM_ID: '67c8c14f5f17a83b745e3f82',
  SHEERID_BASE_URL: 'https://services.sheerid.com',
  MY_SHEERID_URL: 'https://my.sheerid.com',
  MAX_FILE_SIZE: 1 * 1024 * 1024, // 1MB
  PORT: process.env.PORT || 8787,
  // QQ邮箱配置
  EMAIL: {
    user: '2430873348@qq.com',
    password: 'eoowatzzmdpdebig',  // IMAP授权码
    host: 'imap.qq.com',
    port: 993,
    tls: true
  }
};

// CORS头 - 完全开放跨域访问
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
};

// 生成设备指纹
function generateDeviceFingerprint() {
  const chars = '0123456789abcdef';
  let fingerprint = '';
  for (let i = 0; i < 32; i++) {
    fingerprint += chars[Math.floor(Math.random() * chars.length)];
  }
  return fingerprint;
}

// 添加随机延迟
function randomDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// SheerID错误码映射
const ERROR_MESSAGES = {
  'noVerification': '验证ID不存在或已过期，请重新获取验证链接',
  'invalidVerificationToken': '验证令牌无效',
  'verificationExpired': '验证已过期，请重新开始',
  'invalidPersonalInfo': '个人信息无效',
  'docUploadFailed': '文档上传失败',
  'invalidDocument': '文档无效或无法识别',
  'underAge': '年龄不符合要求',
  'notStudent': '无法验证学生身份',
  'organizationNotFound': '学校未找到',
  'tooManyAttempts': '尝试次数过多，请稍后再试',
  'internalError': '服务器内部错误',
  'rejected': '验证被拒绝'
};

// 解析SheerID错误响应，返回简洁中文提示
function parseSheerIdError(data) {
  if (!data) return '未知错误';

  // 提取errorIds
  const errorIds = data.errorIds || [];
  const systemError = data.systemErrorMessage || '';

  // 优先使用错误码映射
  for (const errorId of errorIds) {
    if (ERROR_MESSAGES[errorId]) {
      return ERROR_MESSAGES[errorId];
    }
  }

  // 如果有系统错误信息，提取关键部分
  if (systemError) {
    if (systemError.includes('No verification found')) {
      return '验证ID不存在或已过期，请重新获取验证链接';
    }
    if (systemError.includes('expired')) {
      return '验证已过期';
    }
    return systemError.substring(0, 100); // 截取前100字符
  }

  // 返回错误码列表
  if (errorIds.length > 0) {
    return `错误: ${errorIds.join(', ')}`;
  }

  return '验证失败，请重试';
}

// 获取fetch函数（支持不同Node.js版本）
async function getFetch() {
  // Node.js 18+ 内置fetch
  if (typeof globalThis.fetch !== 'undefined') {
    return globalThis.fetch;
  }

  // 尝试使用node-fetch
  try {
    const fetch = require('node-fetch');
    return fetch;
  } catch (error) {
    // 如果没有node-fetch，尝试使用https模块
    const https = require('https');
    const http = require('http');

    return function(url, options = {}) {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const req = client.request({
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: options.method || 'GET',
          headers: options.headers || {}
        }, (res) => {
          let data = Buffer.alloc(0);
          res.on('data', chunk => {
            data = Buffer.concat([data, chunk]);
          });
          res.on('end', () => {
            const textData = data.toString();
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              text: () => Promise.resolve(textData),
              json: () => Promise.resolve(JSON.parse(textData))
            });
          });
        });

        req.on('error', reject);

        if (options.body) {
          if (Buffer.isBuffer(options.body)) {
            req.write(options.body);
          } else {
            req.write(options.body);
          }
        }

        req.end();
      });
    };
  }
}

// SheerID API请求
async function sheerIdRequest(method, url, body = null, headers = {}) {
  const fetch = await getFetch();

  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  try {
    return { data: JSON.parse(text), status: response.status };
  } catch {
    return { data: text, status: response.status };
  }
}

// 上传图片到S3
async function uploadToS3(uploadUrl, imageBuffer) {
  const fetch = await getFetch();

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png'
    },
    body: imageBuffer
  });

  return { success: response.ok, status: response.status };
}

// 处理验证请求
async function handleVerification(verificationId, firstName, lastName, email, birthDate, studentCardBuffer, logs) {
  const deviceFingerprintHash = generateDeviceFingerprint();
  
  logs.push({ message: `开始验证流程 - ${firstName} ${lastName}`, type: 'info' });
  logs.push({ message: `邮箱: ${email}`, type: 'debug' });
  logs.push({ message: `生日: ${birthDate}`, type: 'debug' });
  logs.push({ message: `验证ID: ${verificationId}`, type: 'debug' });
  logs.push({ message: `设备指纹: ${deviceFingerprintHash}`, type: 'debug' });
  
  try {
    // Step 2: 提交学生信息
    logs.push({ message: '步骤 2/7: 提交学生信息...', type: 'info' });
    
    const step2Body = {
      firstName,
      lastName,
      birthDate,
      email,
      phoneNumber: "",
      organization: {
        id: 331898,
        idExtended: "331898",
        name: "Logan University (Chesterfield, MO)"
      },
      deviceFingerprintHash,
      locale: "en-US",
      metadata: {
        marketConsentValue: false,
        refererUrl: `${CONFIG.SHEERID_BASE_URL}/verify/${CONFIG.PROGRAM_ID}/?verificationId=${verificationId}`,
        verificationId,
        flags: JSON.stringify({
          "collect-info-step-email-first": "default",
          "doc-upload-considerations": "default",
          "doc-upload-may24": "default",
          "doc-upload-redesign-use-legacy-message-keys": false,
          "docUpload-assertion-checklist": "default",
          "font-size": "default",
          "include-cvec-field-france-student": "not-labeled-optional"
        }),
        submissionOptIn: "By submitting the personal information above, I acknowledge that my personal information is being collected under the privacy policy of the business from which I am seeking a discount"
      }
    };
    
    const step2Response = await sheerIdRequest(
      'POST',
      `${CONFIG.SHEERID_BASE_URL}/rest/v2/verification/${verificationId}/step/collectStudentPersonalInfo`,
      step2Body
    );

    if (step2Response.status !== 200 || step2Response.data.currentStep === 'error') {
      const errorMsg = parseSheerIdError(step2Response.data);
      throw new Error(errorMsg);
    }

    logs.push({ message: `步骤2完成: ${step2Response.data.currentStep}`, type: 'success' });

    // 添加随机延迟
    await randomDelay(2000, 4000);

    // Step 3: 跳过SSO
    logs.push({ message: '步骤 3/7: 跳过SSO验证...', type: 'info' });
    
    const step3Response = await sheerIdRequest(
      'DELETE',
      `${CONFIG.SHEERID_BASE_URL}/rest/v2/verification/${verificationId}/step/sso`
    );
    
    logs.push({ message: `步骤3完成: ${step3Response.data.currentStep}`, type: 'success' });

    // 添加随机延迟
    await randomDelay(1500, 3000);

    // Step 4: 获取上传URL
    logs.push({ message: '步骤 4/7: 获取文档上传URL...', type: 'info' });
    
    const step4Body = {
      files: [{
        fileName: "student_card.png",
        mimeType: "image/png",
        fileSize: studentCardBuffer.length
      }]
    };
    
    const step4Response = await sheerIdRequest(
      'POST',
      `${CONFIG.SHEERID_BASE_URL}/rest/v2/verification/${verificationId}/step/docUpload`,
      step4Body
    );

    logs.push({ message: `步骤4响应状态: ${step4Response.status}`, type: 'debug' });
    logs.push({ message: `步骤4响应内容: ${JSON.stringify(step4Response.data)}`, type: 'debug' });

    // 添加更多调试信息
    logs.push({ message: `请求体: ${JSON.stringify(step4Body)}`, type: 'debug' });
    logs.push({ message: `文件大小: ${studentCardBuffer.length} bytes`, type: 'debug' });

    if (step4Response.status !== 200) {
      const errorMsg = parseSheerIdError(step4Response.data);
      throw new Error(`步骤4失败: ${errorMsg}`);
    }

    if (!step4Response.data.documents || !step4Response.data.documents[0]) {
      throw new Error('未获取到上传URL');
    }
    
    const uploadUrl = step4Response.data.documents[0].uploadUrl;
    logs.push({ message: '获取上传URL成功', type: 'success' });
    
    // Step 5: 上传图片到S3
    logs.push({ message: '步骤 5/7: 上传学生证到S3...', type: 'info' });
    
    const uploadResult = await uploadToS3(uploadUrl, studentCardBuffer);
    
    if (!uploadResult.success) {
      throw new Error(`上传失败，状态码: ${uploadResult.status}`);
    }
    
    logs.push({ message: '学生证上传成功', type: 'success' });
    
    // Step 6: 完成文档上传
    logs.push({ message: '步骤 6/7: 完成文档上传...', type: 'info' });
    
    const step6Response = await sheerIdRequest(
      'POST',
      `${CONFIG.SHEERID_BASE_URL}/rest/v2/verification/${verificationId}/step/completeDocUpload`
    );
    
    logs.push({ message: `步骤6完成: ${step6Response.data.currentStep}`, type: 'success' });
    
    // Step 7: 检查验证状态
    logs.push({ message: '步骤 7/7: 检查验证状态...', type: 'info' });
    
    let attempts = 0;
    let success = false;
    let finalStatus = null;
    
    while (attempts < 10 && !success) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒
      
      const statusResponse = await sheerIdRequest(
        'GET',
        `${CONFIG.MY_SHEERID_URL}/rest/v2/verification/${verificationId}`
      );
      
      finalStatus = statusResponse.data;
      attempts++;
      
      logs.push({ message: `状态检查 ${attempts}/10: ${finalStatus.currentStep}`, type: 'debug' });
      
      if (finalStatus.currentStep === 'success') {
        success = true;
        logs.push({ message: '✅ 验证成功！', type: 'success' });
        if (finalStatus.redirectUrl) {
          logs.push({ message: `重定向URL: ${finalStatus.redirectUrl}`, type: 'info' });
        }
        break;
      } else if (finalStatus.currentStep === 'rejected') {
        logs.push({ message: '❌ 验证被拒绝', type: 'error' });
        break;
      } else if (finalStatus.currentStep === 'error') {
        logs.push({ message: '❌ 验证出错', type: 'error' });
        break;
      }
    }
    
    if (!success && attempts >= 10) {
      logs.push({ message: '⏱️ 验证超时 - 达到最大尝试次数', type: 'warning' });
    }
    
    return {
      success,
      message: success ? '验证成功！' : 
               (finalStatus?.currentStep === 'rejected' ? '验证被拒绝' : 
                '验证超时或失败'),
      verificationId,
      redirectUrl: finalStatus?.redirectUrl,
      status: finalStatus
    };
    
  } catch (error) {
    logs.push({ message: `致命错误: ${error.message}`, type: 'error' });
    throw error;
  }
}

// 解析multipart/form-data
function parseMultipart(buffer, boundary) {
  const parts = {};
  const boundaryBuffer = Buffer.from('--' + boundary);
  
  let start = 0;
  while (true) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
    if (boundaryIndex === -1) break;
    
    const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
    if (nextBoundaryIndex === -1) break;
    
    const partBuffer = buffer.slice(boundaryIndex + boundaryBuffer.length, nextBoundaryIndex);
    const headerEndIndex = partBuffer.indexOf('\r\n\r\n');
    
    if (headerEndIndex !== -1) {
      const headerString = partBuffer.slice(0, headerEndIndex).toString();
      const nameMatch = headerString.match(/name="([^"]+)"/);
      
      if (nameMatch) {
        const name = nameMatch[1];
        const content = partBuffer.slice(headerEndIndex + 4);
        
        if (name === 'studentCard') {
          parts[name] = content;
        } else {
          parts[name] = content.toString().trim();
        }
      }
    }
    
    start = nextBoundaryIndex;
  }
  
  return parts;
}

// 检查SheerID验证邮件
function checkSheerIdEmail(sinceMinutes = 10) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: CONFIG.EMAIL.user,
      password: CONFIG.EMAIL.password,
      host: CONFIG.EMAIL.host,
      port: CONFIG.EMAIL.port,
      tls: CONFIG.EMAIL.tls,
      tlsOptions: { rejectUnauthorized: false }
    });

    const results = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // 搜索最近的邮件
        const sinceDate = new Date();
        sinceDate.setMinutes(sinceDate.getMinutes() - sinceMinutes);
        const dateStr = sinceDate.toISOString().split('T')[0];

        // 搜索来自SheerID的邮件
        imap.search([['SINCE', dateStr], ['OR', ['FROM', 'sheerid'], ['FROM', 'SheerID']]], (err, uids) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!uids || uids.length === 0) {
            imap.end();
            return resolve({ found: false, emails: [] });
          }

          const fetch = imap.fetch(uids, { bodies: '' });
          let pending = uids.length;

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
              stream.on('end', () => {
                simpleParser(buffer, (err, parsed) => {
                  if (!err && parsed) {
                    // 提取验证链接
                    const htmlContent = parsed.html || parsed.textAsHtml || '';
                    const textContent = parsed.text || '';

                    // 匹配SheerID验证链接
                    const linkRegex = /https:\/\/[^\s"'<>]*sheerid[^\s"'<>]*/gi;
                    const htmlLinks = htmlContent.match(linkRegex) || [];
                    const textLinks = textContent.match(linkRegex) || [];
                    const allLinks = [...new Set([...htmlLinks, ...textLinks])];

                    // 过滤出验证链接
                    const verifyLinks = allLinks.filter(link =>
                      link.includes('verify') || link.includes('confirmation') || link.includes('click')
                    );

                    results.push({
                      subject: parsed.subject,
                      from: parsed.from?.text,
                      date: parsed.date,
                      links: verifyLinks.length > 0 ? verifyLinks : allLinks.slice(0, 3)
                    });
                  }
                  pending--;
                  if (pending === 0) {
                    imap.end();
                    resolve({ found: results.length > 0, emails: results });
                  }
                });
              });
            });
          });

          fetch.once('error', (err) => {
            imap.end();
            reject(err);
          });

          fetch.once('end', () => {
            if (pending === 0) {
              imap.end();
              resolve({ found: results.length > 0, emails: results });
            }
          });
        });
      });
    });

    imap.once('error', (err) => {
      reject(err);
    });

    imap.connect();
  });
}

// 创建HTTP服务器
const server = http.createServer(async (req, res) => {
  // 设置CORS头
  Object.keys(corsHeaders).forEach(key => {
    res.setHeader(key, corsHeaders[key]);
  });
  
  // 处理OPTIONS请求
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 根路径 - 显示服务器信息
  if (req.method === 'GET' && req.url === '/') {
    // 直接返回验证页面
    const indexPath = path.join(__dirname, 'page-source', 'index.html');
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('无法加载验证页面');
    }
    return;
  }

  // 健康检查端点（支持查询参数）
  if (req.method === 'GET' && (req.url === '/health' || req.url.startsWith('/health?'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      message: 'SheerID 验证服务器运行中',
      timestamp: new Date().toISOString(),
      port: CONFIG.PORT
    }));
    return;
  }

  // API状态检查端点 (GET)
  if (req.method === 'GET' && req.url === '/api/verify') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ready',
      message: 'SheerID 验证API就绪',
      endpoint: '/api/verify',
      method: 'POST',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // 检查邮箱验证邮件端点
  if (req.method === 'GET' && (req.url === '/api/check-email' || req.url.startsWith('/api/check-email?'))) {
    try {
      const urlObj = new URL(req.url, `http://localhost:${CONFIG.PORT}`);
      const sinceMinutes = parseInt(urlObj.searchParams.get('since') || '10', 10);

      console.log(`📧 检查邮箱 (最近${sinceMinutes}分钟)...`);
      const result = await checkSheerIdEmail(sinceMinutes);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        ...result,
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.error('邮箱检查错误:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
    return;
  }

  // 静态文件服务
  if (req.method === 'GET' && req.url.startsWith('/page-source/')) {
    const filePath = path.join(__dirname, req.url);

    try {
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        let contentType = 'text/plain';

        switch (ext) {
          case '.html':
            contentType = 'text/html; charset=utf-8';
            break;
          case '.css':
            contentType = 'text/css';
            break;
          case '.js':
            contentType = 'application/javascript';
            break;
          case '.png':
            contentType = 'image/png';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
        }

        const fileContent = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fileContent);
        return;
      }
    } catch (error) {
      console.error('Static file error:', error);
    }

    res.writeHead(404);
    res.end('File not found');
    return;
  }

  // 处理API请求
  if (req.url === '/api/verify' && req.method === 'POST') {
    try {
      let body = Buffer.alloc(0);
      
      req.on('data', chunk => {
        body = Buffer.concat([body, chunk]);
      });
      
      req.on('end', async () => {
        try {
          const contentType = req.headers['content-type'] || '';
          const boundaryMatch = contentType.match(/boundary=(.+)/);
          
          if (!boundaryMatch) {
            throw new Error('Invalid content type');
          }
          
          const boundary = boundaryMatch[1];
          const formData = parseMultipart(body, boundary);
          
          const logs = [];
          
          const result = await handleVerification(
            formData.verificationId,
            formData.firstName,
            formData.lastName,
            formData.email,
            formData.birthDate,
            formData.studentCard,
            logs
          );
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ...result,
            logs
          }));
          
        } catch (error) {
          console.error('处理请求时出错:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            message: error.message,
            logs: [{ message: `服务器错误: ${error.message}`, type: 'error' }]
          }));
        }
      });
      
    } catch (error) {
      console.error('请求处理错误:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: error.message
      }));
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(CONFIG.PORT, async () => {
  console.log(`🚀 本地服务器启动成功！`);
  console.log(`📍 地址: http://localhost:${CONFIG.PORT}`);
  console.log(`🌐 现在可以打开 page-source/index.html 使用了`);

  // 检测fetch支持情况
  try {
    const fetch = await getFetch();
    if (typeof globalThis.fetch !== 'undefined') {
      console.log(`✅ 使用 Node.js 内置 fetch`);
    } else {
      try {
        require('node-fetch');
        console.log(`✅ 使用 node-fetch 模块`);
      } catch {
        console.log(`✅ 使用内置 https 模块`);
      }
    }
  } catch (error) {
    console.log(`⚠️  fetch 初始化警告: ${error.message}`);
  }

  console.log(`\n按 Ctrl+C 停止服务器`);
});
