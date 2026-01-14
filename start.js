/**
 * 统一启动脚本 - 同时启动 Web 服务和 Telegram 机器人
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 启动 SheerID 验证服务...\n');

// 启动 Web 服务器
const webServer = spawn('node', ['local-server.js'], {
    cwd: __dirname,
    stdio: 'inherit'
});

webServer.on('error', (err) => {
    console.error('❌ Web服务启动失败:', err.message);
});

// 启动 Telegram 机器人 (Python)
const botPath = path.join(__dirname, 'bot');
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

const bot = spawn(pythonCmd, ['bot.py'], {
    cwd: botPath,
    stdio: 'inherit',
    env: { ...process.env }
});

bot.on('error', (err) => {
    console.error('❌ 机器人启动失败:', err.message);
    console.log('💡 请确保已安装 Python 和依赖: pip install -r bot/requirements.txt');
});

bot.on('exit', (code) => {
    if (code !== 0) {
        console.log(`⚠️ 机器人退出，代码: ${code}`);
    }
});

// 处理进程退出
process.on('SIGINT', () => {
    console.log('\n🛑 正在停止所有服务...');
    webServer.kill();
    bot.kill();
    process.exit(0);
});

process.on('SIGTERM', () => {
    webServer.kill();
    bot.kill();
    process.exit(0);
});

