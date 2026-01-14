# 基础镜像：Node.js + Python
FROM node:20-slim

# 安装 Python 和依赖
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# 创建工作目录
WORKDIR /app

# 复制 package.json 并安装 Node 依赖
COPY package*.json ./
RUN npm install --production

# 复制机器人依赖并安装
COPY bot/requirements.txt ./bot/
RUN python3 -m pip install --break-system-packages -r bot/requirements.txt

# 复制所有代码
COPY . .

# 暴露端口
EXPOSE 8080

# 启动脚本
CMD ["node", "start.js"]

