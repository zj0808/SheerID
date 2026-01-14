const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const CONFIG = {
  PROGRAM_ID: '67c8c14f5f17a83b745e3f82',
  SHEERID_BASE_URL: 'https://services.sheerid.com',
  MY_SHEERID_URL: 'https://my.sheerid.com',
  MAX_FILE_SIZE: 1 * 1024 * 1024, // 1MB
  PORT: 8787
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
    
    if (step2Response.status !== 200) {
      throw new Error(`步骤2失败: ${JSON.stringify(step2Response.data)}`);
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
      throw new Error(`步骤4失败: 状态码${step4Response.status}, 响应: ${JSON.stringify(step4Response.data)}`);
    }

    if (!step4Response.data.documents || !step4Response.data.documents[0]) {
      logs.push({ message: `步骤4响应结构异常: ${JSON.stringify(step4Response.data)}`, type: 'error' });
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SheerID 验证服务器</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; text-align: center; }
        .status { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .info { background: #e3f2fd; color: #0d47a1; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 5px; text-decoration: none; display: inline-block; }
        .btn:hover { background: #0056b3; }
        .endpoint { background: #f8f9fa; padding: 10px; border-left: 4px solid #007bff; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 SheerID 验证服务器</h1>

        <div class="status">
            ✅ 服务器运行正常<br>
            📍 地址: http://localhost:${CONFIG.PORT}<br>
            ⏰ 启动时间: ${new Date().toLocaleString('zh-CN')}
        </div>

        <div class="info">
            <h3>📋 使用说明</h3>
            <p>1. 打开验证页面：<a href="javascript:void(0)" onclick="openVerificationPage()" class="btn">🌐 打开验证页面</a></p>
            <p>2. 或者手动打开项目目录中的 <code>page-source/index.html</code> 文件</p>
            <p>3. 在验证页面中粘贴 SheerID 验证链接开始验证</p>
        </div>

        <div class="info">
            <h3>🔧 API 端点</h3>
            <div class="endpoint">
                <strong>GET /health</strong> - 健康检查<br>
                <a href="/health" class="btn">测试健康检查</a>
            </div>
            <div class="endpoint">
                <strong>GET /api/verify</strong> - API状态检查<br>
                <a href="/api/verify" class="btn">测试API状态</a>
            </div>
            <div class="endpoint">
                <strong>POST /api/verify</strong> - 验证接口<br>
                用于处理 SheerID 验证请求
            </div>
        </div>

        <div class="info">
            <h3>💡 提示</h3>
            <p>• 服务器正在监听端口 ${CONFIG.PORT}</p>
            <p>• 支持跨域请求 (CORS)</p>
            <p>• 按 Ctrl+C 停止服务器</p>
        </div>
    </div>

    <script>
        function openVerificationPage() {
            // 直接打开验证页面
            window.open('/page-source/index.html', '_blank');
        }
    </script>
</body>
</html>
    `);
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
