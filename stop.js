/**
 * 快速关闭占用指定端口的进程
 * 用法：node stop.js [端口号]
 * 默认端口：3000（可通过环境变量 PORT 或命令行参数指定）
 * 跨平台支持：Windows / macOS / Linux
 */
const { execSync } = require('child_process');

const PORT = process.argv[2] || process.env.PORT || 3000;

function killPort(port) {
  const isWin = process.platform === 'win32';
  let killed = 0;

  try {
    if (isWin) {
      // Windows: netstat 查找占用端口的 PID
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const pids = new Set();
      output.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        // parts: 协议 本地地址 外部地址 状态 PID
        if (parts.length >= 5) {
          const localAddr = parts[1];
          if (localAddr.endsWith(`:${port}`) || localAddr.includes(`:${port}`)) {
            const pid = parts[parts.length - 1];
            if (/^\d+$/.test(pid)) pids.add(pid);
          }
        }
      });
      pids.forEach(pid => {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          console.log(`  已关闭进程 PID: ${pid}`);
          killed++;
        } catch (e) {
          console.log(`  关闭进程 ${pid} 失败（可能需要管理员权限）`);
        }
      });
    } else {
      // macOS / Linux: lsof 查找占用端口的 PID
      try {
        const output = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim();
        if (output) {
          output.split('\n').forEach(pid => {
            if (pid.trim()) {
              try {
                execSync(`kill -9 ${pid.trim()}`, { stdio: 'ignore' });
                console.log(`  已关闭进程 PID: ${pid.trim()}`);
                killed++;
              } catch (e) {}
            }
          });
        }
      } catch (e) {
        // lsof 未找到进程，端口未被占用
      }
    }
  } catch (e) {
    // 命令执行失败，通常是端口未被占用
  }

  if (killed > 0) {
    console.log(`\n完成：已关闭 ${killed} 个占用端口 ${port} 的进程`);
  } else {
    console.log(`端口 ${port} 未被占用，无需关闭`);
  }
}

console.log(`正在查找占用端口 ${PORT} 的进程...`);
killPort(PORT);
