/**
 * 快速关闭 localtunnel 内网穿透进程
 * 用法：node stop-tunnel.js
 * 跨平台支持：Windows / macOS / Linux
 *
 * 原理：查找命令行中包含 "localtunnel" / "npx ... lt" 关键字的 node 进程并终止
 * Windows：优先 wmic（兼容旧版），失败回退 PowerShell Get-CimInstance
 * macOS/Linux：ps aux 联合 grep，所有命中 PID 经 Set 去重后统一终止
 */
const { execSync } = require('child_process');

/**
 * 终止一组 PID，返回实际关闭数量
 * 使用 Set 调用方保证已去重
 */
function killPids(pids, isWin) {
  let killed = 0;
  pids.forEach(pid => {
    if (!/^\d+$/.test(pid)) return;
    try {
      if (isWin) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      }
      console.log(`  已关闭 localtunnel 进程 PID: ${pid}`);
      killed++;
    } catch (e) {
      if (isWin) console.log(`  关闭进程 ${pid} 失败（可能需要管理员权限）`);
      // macOS/Linux 下进程已退出通常无需提示
    }
  });
  return killed;
}

/**
 * Windows: wmic 解析（问题2修复：完整收集每条记录字段后再过滤，消除字段顺序敏感）
 * 返回 Set<string> 命中的 PID
 */
function findPidsByWmic() {
  const pids = new Set();
  try {
    const raw = execSync(
      'wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:list',
      { encoding: 'utf8' }
    );
    // 每条 wmic list 记录之间以空行分隔，按 "\n\n" 切分更稳健
    const blocks = raw.split(/\r?\n\s*\r?\n/);
    for (const block of blocks) {
      const record = {};
      block.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line) return;
        const idx = line.indexOf('=');
        if (idx < 0) return;
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key === 'CommandLine') record.CommandLine = val;
        else if (key === 'ProcessId') record.ProcessId = val;
      });
      // 两个字段都齐全后才做匹配判断，不再依赖字段出现顺序；
      // 正则三分支：①含 localtunnel 关键字（npx localtunnel、node 路径含 localtunnel）
      //            ②npx 后接空白 + lt（localtunnel CLI 短名），限定 lt 后为空白/@/行尾 防误伤
      //            ③npx-cli.js 包装脚本后任意字符出现 空白+lt（npx 在 Node 包装下的真实命令行）
      const winPattern = /(localtunnel|npx\s+lt(\s|@|$)|npx-cli\.js.*\slt(\s|@|$))/i;
      if (record.CommandLine && record.ProcessId && winPattern.test(record.CommandLine)) {
        pids.add(record.ProcessId);
      }
    }
  } catch (e) {
    // 向上抛出，由调用方决定是否走 PowerShell 回退
    throw e;
  }
  return pids;
}

/**
 * Windows: PowerShell Get-CimInstance 回退方案（问题3修复：应对 wmic 弃用）
 */
function findPidsByPowerShell() {
  const pids = new Set();
  try {
    // 编码说明：先强制 [Console]::OutputEncoding 为 UTF-8 无 BOM，
    // 避免中文/非英文 Windows 默认 GBK/UTF-16 编码导致 Node 以 UTF-8 解码时出现乱码，
    // 进而造成 ConvertTo-Json 输出结构损坏或 /localtunnel 正则漏匹配。
    //
    // 其余采用 PowerShell 单引号字符串 + WQL 单引号值组合：整个 psCmd 中零个双引号，
    // 彻底规避 CMD 双引号嵌套转义风险。PowerShell 单引号字符串内 '' 表示字面单引号，
    // 最终 WQL filter 为 Name='node.exe'（WQL 与 SQL 一样支持单引号字符串，完全合法）
    // 编码设置与查询语句用分号分隔（赋值返回值为 null 不能进管道），
    // 查询内部三条 cmdlet 通过管道 | 流式连接：Get-CimInstance → Select → ConvertTo-Json
    const psCmd =
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) ; " +
      [
        "Get-CimInstance Win32_Process -Filter 'Name=''node.exe'''",
        "Select-Object ProcessId,CommandLine",
        "ConvertTo-Json -Compress"
      ].join(' | ');
    const raw = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8' });
    const list = JSON.parse(raw || '[]');
    const arr = Array.isArray(list) ? list : [list];
    // 与 wmic 分支复用同一正则语义，确保跨平台匹配行为一致（三分支同上）
    const winPattern = /(localtunnel|npx\s+lt(\s|@|$)|npx-cli\.js.*\slt(\s|@|$))/i;
    for (const proc of arr) {
      if (!proc) continue;
      const cmd = String(proc.CommandLine || '');
      const pid = String(proc.ProcessId || '');
      if (cmd && pid && winPattern.test(cmd)) pids.add(pid);
    }
  } catch (e) {
    // PowerShell 也失败就返回空集合，由上层判断
  }
  return pids;
}

function killTunnel() {
  const isWin = process.platform === 'win32';
  const pids = new Set(); // 全局去重集合（问题1修复：所有命中 PID 统一加入 Set）

  try {
    if (isWin) {
      // Windows：优先 wmic，失败回退 PowerShell（问题3修复）
      let winPids;
      try {
        winPids = findPidsByWmic();
      } catch (e) {
        console.log('  wmic 不可用，回退到 PowerShell Get-CimInstance...');
        winPids = findPidsByPowerShell();
      }
      winPids.forEach(pid => pids.add(pid));
    } else {
      // macOS / Linux: 两种 grep 模式，结果全部汇聚到同一个 Set，天然去重（问题1修复）
      // 模式 1：含 localtunnel 关键字（最可靠，npx localtunnel 或 node 直接运行）
      // 模式 2：扩展正则三分支命中：
      //   a) npx 后跟空白 + lt（localtunnel CLI 短名），限定 lt 后为空白 / @版本号 / 行尾 防误伤
      //   b) npx-cli.js 包装脚本后任意字符出现 空白+lt（npx 在 Node 包装下的真实命令行）
      //   c) node 启动 + 路径含 localtunnel
      const patterns = [
        "grep -i localtunnel",
        "grep -E 'npx[[:space:]]+lt([[:space:]]|@|$)|npx-cli\\.js.*[[:space:]]lt([[:space:]]|@|$)|node[[:space:]].*localtunnel'"
      ];
      for (const pattern of patterns) {
        try {
          const output = execSync(`ps aux | ${pattern} | grep -v grep`, { encoding: 'utf8' }).trim();
          if (!output) continue;
          output.split('\n').forEach(line => {
            const parts = line.trim().split(/\s+/);
            // ps aux 第 2 列通常是 PID
            if (parts.length >= 2 && /^\d+$/.test(parts[1])) pids.add(parts[1]);
          });
        } catch (e) {
          // grep 没找到匹配，正常情况
        }
      }
    }
  } catch (e) {
    // 最外层兜底，避免整个脚本崩溃
  }

  // 统一执行 kill，输出真实去重后的数量（修复问题1：原注释与代码矛盾）
  const killed = killPids(pids, isWin);
  if (killed > 0) {
    console.log(`\n完成：已关闭 ${killed} 个 localtunnel 内网穿透进程`);
  } else {
    console.log('未检测到正在运行的 localtunnel 内网穿透进程');
  }
}

console.log('正在查找 localtunnel 内网穿透进程...');
killTunnel();
